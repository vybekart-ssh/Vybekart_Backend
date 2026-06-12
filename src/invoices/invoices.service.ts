import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AddressType, OrderStatus, ReplacementStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildInvoiceBranding } from './invoice-branding.util';
import { parseShippingAddressSnapshot } from '../mail/templates/shipping-address.util';
import {
  InvoiceAddressBlock,
  InvoiceDocumentPayload,
  InvoiceLineItem,
  InvoicePagePayload,
  InvoiceParty,
} from './invoice.types';
import {
  amountInWordsInr,
  extractPanFromGstin,
  extractPinFromText,
  roundInr,
  shippingGstPercent,
  splitGstInclusive,
  stateCodeFromGstin,
  stateCodeFromPin,
  stateNameFromCode,
} from './invoice-tax.util';
import { buildInvoicePdf } from './invoice-pdf.builder';
import { buildSampleInvoiceDocument } from './invoice-sample.util';

type OrderItemRow = {
  id: string;
  quantity: number;
  price: number;
  variantLabel: string | null;
  product: {
    id: string;
    name: string;
    hsnCode: string | null;
    gstPercent: number | null;
    sellerId: string;
    seller: {
      id: string;
      businessName: string;
      businessAddress: string | null;
      gstNumber: string | null;
      userId: string;
    };
  };
};

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async generateSampleInvoicePdf() {
    const doc = buildSampleInvoiceDocument();
    const buffer = await buildInvoicePdf(doc);
    return { buffer, filename: doc.filename };
  }

  async generateOrderInvoicePdf(orderId: string, userId: string) {
    const buyer = await this.prisma.buyer.findUnique({ where: { userId } });
    if (!buyer) throw new ForbiddenException('Buyer not found');

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, buyerId: buyer.id },
      include: {
        items: {
          include: {
            product: {
              include: { seller: true },
            },
          },
        },
        buyer: { include: { user: { select: { name: true } } } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== OrderStatus.DELIVERED) {
      throw new BadRequestException(
        'Invoice is available after your order is delivered',
      );
    }

    const invoiceNumber =
      order.invoiceNumber ??
      (await this.assignOrderInvoiceNumber(order.id, order.deliveredAt ?? order.createdAt));

    const grouped = this.groupItemsBySeller(order.items as OrderItemRow[]);
    const pages: InvoicePagePayload[] = [];
    let pageNo = 0;

    for (const [sellerId, items] of grouped) {
      pageNo += 1;
      const seller = items[0].product.seller;
      const sellerAddress = await this.resolveSellerAddress(seller);
      this.assertSellerInvoiceReady(seller.businessName, sellerAddress);

      const deliveryShare =
        grouped.size === 1
          ? order.deliveryFee
          : roundInr(
              (order.deliveryFee * items.reduce((s, i) => s + i.price * i.quantity, 0)) /
                Math.max(
                  order.items.reduce((s, i) => s + i.price * i.quantity, 0),
                  1,
                ),
            );

      pages.push(
        this.buildOrderPage({
          order,
          items,
          seller,
          sellerAddress,
          buyerName: order.buyer?.user?.name ?? 'Customer',
          invoiceNumber: `${invoiceNumber}-${pageNo}`,
          invoiceDetails: `${invoiceNumber}-S${sellerId.slice(0, 4).toUpperCase()}`,
          deliveryFee: deliveryShare,
          pageNo,
          pageTotal: grouped.size,
          paymentId: order.razorpayPaymentId,
          paymentAt: order.deliveredAt ?? order.createdAt,
        }),
      );
    }

  if (pages.length === 0) {
      throw new UnprocessableEntityException('No invoice line items');
    }
    pages.forEach((p) => {
      p.pageTotal = pages.length;
    });

    const doc: InvoiceDocumentPayload = {
      filename: this.orderFilename(order.id, order.deliveredAt ?? order.createdAt),
      pages,
    };
    const buffer = await buildInvoicePdf(doc);
    return { buffer, filename: doc.filename };
  }

  async generateReplacementInvoicePdf(replacementId: string, userId: string) {
    const buyer = await this.prisma.buyer.findUnique({ where: { userId } });
    if (!buyer) throw new ForbiddenException('Buyer not found');

    const repl = await this.prisma.replacementRequest.findFirst({
      where: { id: replacementId, buyerId: buyer.id },
      include: {
        order: true,
        seller: true,
        buyer: { include: { user: { select: { name: true } } } },
      },
    });
    if (!repl) throw new NotFoundException('Replacement not found');
    if (repl.status !== ReplacementStatus.DELIVERED) {
      throw new BadRequestException(
        'Invoice is available after your replacement is delivered',
      );
    }

    const line = await this.prisma.orderItem.findFirst({
      where: { id: repl.orderItemId ?? undefined, orderId: repl.orderId },
      include: { product: true },
    });
    if (!line?.product) {
      throw new UnprocessableEntityException('Replacement line item not found');
    }

    const sellerAddress = await this.resolveSellerAddress(repl.seller);
    this.assertSellerInvoiceReady(repl.seller.businessName, sellerAddress);

    const invoiceNumber =
      repl.invoiceNumber ??
      (await this.assignReplacementInvoiceNumber(
        repl.id,
        repl.deliveredAt ?? repl.createdAt,
      ));

    const unitPrice = repl.replacementUnitPrice || line.price;
    const paymentId = repl.razorpayPaymentId ?? repl.order.razorpayPaymentId;

    const page = this.buildReplacementPage({
      repl,
      order: repl.order,
      buyerName: repl.buyer?.user?.name ?? 'Customer',
      product: line.product,
      seller: repl.seller,
      sellerAddress,
      invoiceNumber,
      invoiceDetails: `${invoiceNumber}-RPL`,
      unitPrice,
      paymentId,
      paymentAt: repl.deliveredAt ?? repl.createdAt,
    });

    const doc: InvoiceDocumentPayload = {
      filename: this.replacementFilename(repl.id, repl.deliveredAt ?? repl.createdAt),
      pages: [page],
    };
    const buffer = await buildInvoicePdf(doc);
    return { buffer, filename: doc.filename };
  }

  private groupItemsBySeller(
    items: OrderItemRow[],
  ): Map<string, OrderItemRow[]> {
    const map = new Map<string, OrderItemRow[]>();
    for (const item of items) {
      const sid = item.product.sellerId;
      const list = map.get(sid) ?? [];
      list.push(item);
      map.set(sid, list);
    }
    return map;
  }

  private async resolveSellerAddress(seller: {
    businessAddress: string | null;
    userId: string;
  }): Promise<string> {
    if (seller.businessAddress?.trim()) return seller.businessAddress.trim();
    const pickup = await this.prisma.address.findFirst({
      where: { userId: seller.userId, type: AddressType.PICKUP },
      orderBy: { createdAt: 'desc' },
    });
    if (!pickup) return '';
    return [
      pickup.line1,
      pickup.line2,
      `${pickup.city}, ${pickup.state} ${pickup.zip}`,
      pickup.country,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private assertSellerInvoiceReady(name: string, address: string) {
    if (!name?.trim() || !address?.trim()) {
      throw new UnprocessableEntityException(
        'Seller business details are incomplete for tax invoice. Please contact support.',
      );
    }
  }

  private buildBranding() {
    return buildInvoiceBranding(this.config);
  }

  private buildAddressBlocks(
    shippingRaw: string | null,
    buyerName: string,
  ): { billing: InvoiceAddressBlock; shipping: InvoiceAddressBlock; buyerStateCode: string | null; buyerStateName: string | null } {
    const parsed = parseShippingAddressSnapshot(shippingRaw);
    const name = parsed.shippingContactName ?? buyerName;
    const lines = parsed.shippingAddressLine.split(',').map((s) => s.trim()).filter(Boolean);
    const pin = extractPinFromText(parsed.shippingAddressLine);
    const stateCode = stateCodeFromPin(pin);
    const stateName = stateNameFromCode(stateCode);
    const block: InvoiceAddressBlock = {
      name,
      lines,
      stateCode,
      stateName,
    };
    return {
      billing: block,
      shipping: { ...block, name },
      buyerStateCode: stateCode,
      buyerStateName: stateName,
    };
  }

  private buildSoldByParty(
    seller: { businessName: string; gstNumber: string | null },
    address: string,
  ): InvoiceParty {
    const gstin = seller.gstNumber?.trim() ?? null;
    const stateCode = stateCodeFromGstin(gstin);
    return {
      name: seller.businessName,
      lines: address.split('\n').map((l) => l.trim()).filter(Boolean),
      pan: extractPanFromGstin(gstin),
      gstin,
      stateCode,
      stateName: stateNameFromCode(stateCode),
    };
  }

  private buildOrderPage(params: {
    order: {
      id: string;
      shippingAddress: string | null;
      createdAt: Date;
      deliveredAt: Date | null;
      razorpayPaymentId: string | null;
    };
    items: OrderItemRow[];
    seller: OrderItemRow['product']['seller'];
    sellerAddress: string;
    buyerName: string;
    invoiceNumber: string;
    invoiceDetails: string;
    deliveryFee: number;
    pageNo: number;
    pageTotal: number;
    paymentId: string | null;
    paymentAt: Date;
    isReplacement?: boolean;
    originalOrderRef?: string;
  }): InvoicePagePayload {
    const soldBy = this.buildSoldByParty(params.seller, params.sellerAddress);
    const { billing, shipping, buyerStateCode, buyerStateName } =
      this.buildAddressBlocks(params.order.shippingAddress, params.buyerName);

    const lineItems: InvoiceLineItem[] = [];
    let sl = 0;
    let totalTax = 0;
    let grandTotal = 0;

    for (const item of params.items) {
      sl += 1;
      const lineIncl = roundInr(item.price * item.quantity);
      const split = splitGstInclusive(
        lineIncl,
        item.product.gstPercent,
        soldBy.stateCode,
        buyerStateCode,
      );
      const taxSum = split.taxes.reduce((s, t) => s + t.amount, 0);
      totalTax += taxSum;
      grandTotal += lineIncl;
      const desc = item.variantLabel
        ? `${item.product.name} (${item.variantLabel})`
        : item.product.name;
      lineItems.push({
        slNo: sl,
        description: desc,
        hsnCode: item.product.hsnCode,
        unitPriceIncl: item.price,
        discount: 0,
        quantity: item.quantity,
        netAmount: split.net,
        taxes: split.taxes,
        totalAmount: lineIncl,
      });
    }

    if (params.deliveryFee > 0) {
      sl += 1;
      const shipSplit = splitGstInclusive(
        params.deliveryFee,
        shippingGstPercent(),
        soldBy.stateCode,
        buyerStateCode,
      );
      const taxSum = shipSplit.taxes.reduce((s, t) => s + t.amount, 0);
      totalTax += taxSum;
      grandTotal += params.deliveryFee;
      lineItems.push({
        slNo: sl,
        description: 'Shipping Charges',
        hsnCode: '996812',
        unitPriceIncl: params.deliveryFee,
        discount: 0,
        quantity: 1,
        netAmount: shipSplit.net,
        taxes: shipSplit.taxes,
        totalAmount: params.deliveryFee,
      });
    }

    return {
      pageNo: params.pageNo,
      pageTotal: params.pageTotal,
      orderNumber: params.order.id,
      invoiceNumber: params.invoiceNumber,
      orderDate: params.order.createdAt,
      invoiceDate: params.order.deliveredAt ?? params.order.createdAt,
      invoiceDetails: params.invoiceDetails,
      soldBy,
      billing,
      shipping,
      placeOfSupply: buyerStateName ?? 'INDIA',
      placeOfDelivery: buyerStateName ?? 'INDIA',
      lineItems,
      totalTax: roundInr(totalTax),
      grandTotal: roundInr(grandTotal),
      amountInWords: amountInWordsInr(grandTotal),
      paymentTransactionId: params.paymentId,
      paymentDateTime: params.paymentAt,
      paymentMode: params.paymentId ? 'Razorpay' : 'Online',
      branding: this.buildBranding(),
      isReplacement: params.isReplacement,
      originalOrderRef: params.originalOrderRef,
    };
  }

  private buildReplacementPage(params: {
    repl: {
      id: string;
      orderId: string;
      replacementVariantLabel: string | null;
      deliveredAt: Date | null;
      createdAt: Date;
    };
    order: { shippingAddress: string | null; createdAt: Date };
    buyerName: string;
    product: { name: string; hsnCode: string | null; gstPercent: number | null };
    seller: { businessName: string; gstNumber: string | null };
    sellerAddress: string;
    invoiceNumber: string;
    invoiceDetails: string;
    unitPrice: number;
    paymentId: string | null;
    paymentAt: Date;
  }): InvoicePagePayload {
    const soldBy = this.buildSoldByParty(params.seller, params.sellerAddress);
    const { billing, shipping, buyerStateCode, buyerStateName } =
      this.buildAddressBlocks(params.order.shippingAddress, params.buyerName);

    const lineIncl = roundInr(params.unitPrice);
    const split = splitGstInclusive(
      lineIncl,
      params.product.gstPercent,
      soldBy.stateCode,
      buyerStateCode,
    );
    const taxSum = split.taxes.reduce((s, t) => s + t.amount, 0);
    const desc = params.repl.replacementVariantLabel
      ? `${params.product.name} (${params.repl.replacementVariantLabel}) — Replacement`
      : `${params.product.name} — Replacement`;

    const lineItems: InvoiceLineItem[] = [
      {
        slNo: 1,
        description: desc,
        hsnCode: params.product.hsnCode,
        unitPriceIncl: params.unitPrice,
        discount: 0,
        quantity: 1,
        netAmount: split.net,
        taxes: split.taxes,
        totalAmount: lineIncl,
      },
    ];

    return {
      pageNo: 1,
      pageTotal: 1,
      orderNumber: params.repl.id,
      invoiceNumber: params.invoiceNumber,
      orderDate: params.order.createdAt,
      invoiceDate: params.repl.deliveredAt ?? params.repl.createdAt,
      invoiceDetails: params.invoiceDetails,
      soldBy,
      billing,
      shipping,
      placeOfSupply: buyerStateName ?? 'INDIA',
      placeOfDelivery: buyerStateName ?? 'INDIA',
      lineItems,
      totalTax: roundInr(taxSum),
      grandTotal: lineIncl,
      amountInWords: amountInWordsInr(lineIncl),
      paymentTransactionId: params.paymentId,
      paymentDateTime: params.paymentAt,
      paymentMode: params.paymentId ? 'Razorpay' : 'Online',
      branding: this.buildBranding(),
      isReplacement: true,
      originalOrderRef: params.repl.orderId,
    };
  }

  private async assignOrderInvoiceNumber(
    orderId: string,
    date: Date,
  ): Promise<string> {
    const num = `VK-ORD-${orderId.replace(/-/g, '').slice(0, 8).toUpperCase()}-${this.yymmdd(date)}`;
    await this.prisma.order.update({
      where: { id: orderId },
      data: { invoiceNumber: num },
    });
    return num;
  }

  private async assignReplacementInvoiceNumber(
    replId: string,
    date: Date,
  ): Promise<string> {
    const num = `VK-RPL-${replId.replace(/-/g, '').slice(0, 8).toUpperCase()}-${this.yymmdd(date)}`;
    await this.prisma.replacementRequest.update({
      where: { id: replId },
      data: { invoiceNumber: num },
    });
    return num;
  }

  private yymmdd(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }

  private orderFilename(orderId: string, date: Date): string {
    return `Vybekart_Tax_Invoice_Order_${orderId.slice(-8)}_${this.yymmdd(date)}.pdf`;
  }

  private replacementFilename(replId: string, date: Date): string {
    return `Vybekart_Tax_Invoice_Replacement_${replId.slice(-8)}_${this.yymmdd(date)}.pdf`;
  }
}
