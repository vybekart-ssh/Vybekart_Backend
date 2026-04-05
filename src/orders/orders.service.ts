import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { ShipOrderDto } from './dto/ship-order.dto';
import { OrderStatus, Prisma } from '@prisma/client';
import { RedisService } from '../redis/redis.service';
import { CartItemDto } from './dto/cart-item.dto';
import { CheckoutOrderDto } from './dto/checkout-order.dto';
import { ConfigService } from '@nestjs/config';
import {
  PaginationQueryDto,
  PaginatedResult,
} from '../common/dto/pagination-query.dto';
import { SellerOrdersQueryDto } from './dto/seller-orders-query.dto';
import { BuyerOrdersQueryDto } from './dto/buyer-orders-query.dto';
import { MockDeliveryService } from './mock-delivery.service';
import { resolvePublicBaseUrl } from '../common/utils/public-base-url';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  applyVariantStockDelta,
  findVariantItem,
  productHasVariantItems,
} from '../products/product-variants.util';

type CartState = { items: CartItemDto[]; streamId?: string };

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private config: ConfigService,
    private mockDelivery: MockDeliveryService,
  ) {}

  private async assertStreamAndProducts(streamId: string, productIds: string[]) {
    const stream = await this.prisma.stream.findUnique({
      where: { id: streamId },
      include: { streamProducts: true },
    });
    if (!stream) {
      throw new BadRequestException('Invalid stream');
    }
    if (!stream.startedAt) {
      throw new BadRequestException('This stream has not started yet');
    }
    const allowed = new Set(stream.streamProducts.map((sp) => sp.productId));
    for (const pid of productIds) {
      if (!allowed.has(pid)) {
        throw new BadRequestException(
          `Product is not part of this live stream listing`,
        );
      }
    }
  }

  private cartKey(userId: string): string {
    return `orders:cart:${userId}`;
  }

  private async loadCartState(userId: string): Promise<CartState> {
    const raw = await this.redis.get(this.cartKey(userId));
    if (!raw) return { items: [] };
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return { items: parsed as CartItemDto[] };
      }
      const o = parsed as { items?: CartItemDto[]; streamId?: string };
      return { items: o.items ?? [], streamId: o.streamId };
    } catch {
      return { items: [] };
    }
  }

  private async saveCartState(userId: string, state: CartState) {
    await this.redis.set(this.cartKey(userId), JSON.stringify(state));
  }

  async getCart(userId: string) {
    const { items, streamId } = await this.loadCartState(userId);
    if (!items.length) {
      return { items: [], subtotal: 0, shipping: 0, total: 0, streamId: null };
    }

    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, price: true, images: true, variants: true },
    });
    const map = new Map(products.map((p) => [p.id, p]));

    const normalized = items
      .map((item) => {
        const product = map.get(item.productId);
        if (!product) return null;
        const hasVariants = productHasVariantItems(product.variants);
        let unitPrice = product.price;
        if (hasVariants) {
          if (!item.variantId) return null;
          const v = findVariantItem(product.variants, item.variantId);
          if (!v) return null;
          unitPrice = v.sellingPrice;
        }
        return {
          ...item,
          product: {
            id: product.id,
            name: product.name,
            price: unitPrice,
            images: product.images,
          },
          unitPrice,
          amount: unitPrice * item.quantity,
        };
      })
      .filter(Boolean) as Array<
      CartItemDto & {
        product: { id: string; name: string; price: number; images: string[] };
        unitPrice: number;
        amount: number;
      }
    >;

    const subtotal = normalized.reduce((sum, i) => sum + i.amount, 0);
    const shipping = subtotal > 0 ? 90 : 0;
    const total = subtotal + shipping;

    return { items: normalized, subtotal, shipping, total, streamId: streamId ?? null };
  }

  async addCartItem(userId: string, dto: CartItemDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: { id: true, stock: true, variants: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    const hasVariants = productHasVariantItems(product.variants);
    if (hasVariants) {
      if (!dto.variantId?.trim()) {
        throw new BadRequestException('variantId is required for this product');
      }
      const v = findVariantItem(product.variants, dto.variantId);
      if (!v) throw new BadRequestException('Invalid variant');
      if (dto.quantity > v.stock) {
        throw new BadRequestException('Requested quantity exceeds available stock');
      }
    } else if (dto.quantity > product.stock) {
      throw new BadRequestException('Requested quantity exceeds available stock');
    }

    const state = await this.loadCartState(userId);
    if (state.items.length === 0 && !dto.streamId) {
      throw new BadRequestException(
        'streamId is required — add products from a live stream.',
      );
    }
    if (
      state.streamId &&
      dto.streamId &&
      dto.streamId !== state.streamId
    ) {
      throw new BadRequestException(
        'Cart is tied to a different live stream. Clear the cart first.',
      );
    }

    const items = [...state.items];
    const streamId = state.streamId ?? dto.streamId;
    const vKey = dto.variantId?.trim() ?? '';
    const idx = items.findIndex(
      (i) => i.productId === dto.productId && (i.variantId?.trim() ?? '') === vKey,
    );
    if (idx >= 0) {
      items[idx].quantity = dto.quantity;
      items[idx].size = dto.size;
      items[idx].color = dto.color;
      items[idx].variantId = dto.variantId?.trim();
      items[idx].variantLabel = dto.variantLabel?.trim();
    } else {
      items.push({
        productId: dto.productId,
        quantity: dto.quantity,
        size: dto.size,
        color: dto.color,
        variantId: dto.variantId?.trim(),
        variantLabel: dto.variantLabel?.trim(),
      });
    }
    await this.saveCartState(userId, { items, streamId });
    return this.getCart(userId);
  }

  async updateCartItem(
    userId: string,
    productId: string,
    quantity: number,
    variantId?: string,
  ) {
    const state = await this.loadCartState(userId);
    const items = [...state.items];
    const vKey = variantId?.trim() ?? '';
    const idx = items.findIndex(
      (i) =>
        i.productId === productId && (i.variantId?.trim() ?? '') === vKey,
    );
    if (idx < 0) throw new NotFoundException('Item not found in cart');
    items[idx].quantity = quantity;
    await this.saveCartState(userId, { items, streamId: state.streamId });
    return this.getCart(userId);
  }

  async removeCartItem(userId: string, productId: string, variantId?: string) {
    const state = await this.loadCartState(userId);
    const vKey = variantId?.trim() ?? '';
    const next = state.items.filter(
      (i) =>
        !(
          i.productId === productId && (i.variantId?.trim() ?? '') === vKey
        ),
    );
    await this.saveCartState(
      userId,
      next.length ? { items: next, streamId: state.streamId } : { items: [] },
    );
    return this.getCart(userId);
  }

  async checkoutFromCart(userId: string, dto: CheckoutOrderDto) {
    const cart = await this.getCart(userId);
    if (!cart.items.length) {
      throw new BadRequestException('Cart is empty');
    }
    const streamId = (cart as { streamId?: string | null }).streamId;
    if (!streamId) {
      throw new BadRequestException(
        'Checkout requires a live stream context. Add items from a live.',
      );
    }
    const createDto: CreateOrderDto = {
      items: cart.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        variantId: i.variantId,
        variantLabel: i.variantLabel,
      })),
      shippingAddress: dto.shippingAddress,
      streamId,
    };

    const order = await this.create(createDto, userId);
    await this.redis.del(this.cartKey(userId));

    return {
      orderId: order?.id,
      status: order?.status ?? 'PENDING',
      totalAmount: order?.totalAmount ?? cart.total,
      estimatedDelivery: 'October 20, 2024',
      shippingAddress: dto.shippingAddress,
      paymentMethod: dto.paymentMethod ?? 'CARD',
    };
  }

  async create(dto: CreateOrderDto, userId: string) {
    const buyer = await this.prisma.buyer.findUnique({
      where: { userId },
    });
    if (!buyer) {
      throw new ForbiddenException('User is not a registered buyer');
    }
    if (!dto.items?.length) {
      throw new BadRequestException('Order must have at least one item');
    }
    if (!dto.streamId) {
      throw new BadRequestException(
        'Orders are only allowed from a live stream (streamId is required).',
      );
    }
    await this.assertStreamAndProducts(
      dto.streamId,
      dto.items.map((i) => i.productId),
    );

    const productIds = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { seller: true },
    });
    if (products.length !== productIds.length) {
      throw new BadRequestException('One or more products not found');
    }

    const productMap = new Map(products.map((p) => [p.id, p]));
    let totalAmount = 0;
    const orderItemsData: {
      productId: string;
      quantity: number;
      price: number;
      variantId: string | null;
      variantLabel: string | null;
    }[] = [];

    for (const item of dto.items) {
      const product = productMap.get(item.productId);
      if (!product)
        throw new BadRequestException(`Product ${item.productId} not found`);
      const hasVariants = productHasVariantItems(product.variants);
      let linePrice = product.price;
      let variantId: string | null = item.variantId?.trim() ?? null;
      let variantLabel: string | null = item.variantLabel?.trim() ?? null;
      if (hasVariants) {
        if (!item.variantId?.trim()) {
          throw new BadRequestException(
            `variantId is required for product ${product.name}`,
          );
        }
        const v = findVariantItem(product.variants, item.variantId);
        if (!v) {
          throw new BadRequestException('Invalid variant on order line');
        }
        linePrice = v.sellingPrice;
        variantLabel = v.label;
        if (v.stock < item.quantity) {
          throw new BadRequestException(
            `Insufficient stock for ${product.name} (${v.label}). Available: ${v.stock}`,
          );
        }
      } else if (product.stock < item.quantity) {
        throw new BadRequestException(
          `Insufficient stock for product ${product.name}. Available: ${product.stock}`,
        );
      }
      totalAmount += linePrice * item.quantity;
      orderItemsData.push({
        productId: product.id,
        quantity: item.quantity,
        price: linePrice,
        variantId,
        variantLabel,
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          buyerId: buyer.id,
          streamId: dto.streamId,
          shippingAddress: dto.shippingAddress ?? null,
          status: OrderStatus.PENDING,
          totalAmount,
          items: {
            create: orderItemsData.map((r) => ({
              productId: r.productId,
              quantity: r.quantity,
              price: r.price,
              variantId: r.variantId,
              variantLabel: r.variantLabel,
            })),
          },
        },
      });
      for (const row of orderItemsData) {
        const p = await tx.product.findUnique({ where: { id: row.productId } });
        if (!p) continue;
        if (row.variantId && productHasVariantItems(p.variants)) {
          const { variants, totalStock } = applyVariantStockDelta(
            p.variants,
            row.variantId,
            -row.quantity,
          );
          await tx.product.update({
            where: { id: row.productId },
            data: { variants, stock: totalStock },
          });
        } else {
          await tx.product.update({
            where: { id: row.productId },
            data: { stock: { decrement: row.quantity } },
          });
        }
      }
      return newOrder;
    });

    return this.prisma.order.findUnique({
      where: { id: created.id },
      include: {
        items: { include: { product: true } },
        buyer: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
  }

  async findMyOrders(
    userId: string,
    query: BuyerOrdersQueryDto,
  ): Promise<PaginatedResult<unknown>> {
    const buyer = await this.prisma.buyer.findUnique({
      where: { userId },
    });
    if (!buyer) throw new ForbiddenException('User is not a registered buyer');

    const { page = 1, limit = 20, status, search } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.OrderWhereInput = {
      buyerId: buyer.id,
      ...(status ? { status: status as OrderStatus } : {}),
      ...(search
        ? {
            OR: [
              { id: { contains: search, mode: 'insensitive' } },
              {
                items: {
                  some: {
                    product: { name: { contains: search, mode: 'insensitive' } },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: { items: { include: { product: true } } },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.count({ where }),
    ]);
    const totalPages = Math.ceil(total / limit);
    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  async getOrderHelp(orderId: string, userId: string) {
    const buyer = await this.prisma.buyer.findUnique({
      where: { userId },
      include: { user: true },
    });
    if (!buyer) throw new ForbiddenException('User is not a registered buyer');

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true, images: true } },
          },
        },
      },
    });
    if (!order || order.buyerId !== buyer.id) {
      throw new NotFoundException('Order not found');
    }

    return {
      order: {
        id: order.id,
        status: order.status,
        createdAt: order.createdAt,
        totalAmount: order.totalAmount,
        shippingAddress: order.shippingAddress,
        items: order.items,
      },
      customer: {
        name: buyer.user.name,
        email: buyer.user.email,
        phone: buyer.user.phone,
      },
      support: {
        chatAvailable: true,
        phone:
          this.config.get<string>('SUPPORT_ACCOUNT_MANAGER_PHONE') ??
          '+91 98765 43210',
        suggestedQueries: [
          'Issue with this item',
          'Did not get the item',
          'Return or exchange the item',
          'Other issue',
        ],
      },
    };
  }

  async findOne(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: { include: { seller: true } } } },
        buyer: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    const isBuyer = order.buyerId && order.buyer?.userId === userId;
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    const isSeller =
      seller && order.items.some((item) => item.product.sellerId === seller.id);
    if (!isBuyer && !isSeller) {
      throw new ForbiddenException('You can only view your own orders');
    }
    return order;
  }

  /** Seller: list orders that contain at least one of the seller's products */
  async findSellerOrders(
    userId: string,
    query: PaginationQueryDto,
    filter: SellerOrdersQueryDto,
  ): Promise<PaginatedResult<unknown>> {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller)
      throw new ForbiddenException('User is not a registered seller');

    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;
    const baseWhere: Prisma.OrderWhereInput = {
      streamId: { not: null },
      items: { some: { product: { sellerId: seller.id } } },
    };
    let statusClause: Prisma.OrderWhereInput = {};
    if (filter?.status?.includes(',')) {
      const parts = filter.status
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean) as OrderStatus[];
      statusClause = { status: { in: parts } };
    } else if (filter?.status) {
      statusClause = { status: filter.status as OrderStatus };
    }
    let where: Prisma.OrderWhereInput = { ...baseWhere, ...statusClause };
    if (filter?.date === 'today') {
      const now = new Date();
      const todayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );
      const todayEnd = new Date(
        todayStart.getTime() + 24 * 60 * 60 * 1000,
      );
      where = {
        ...where,
        createdAt: { gte: todayStart, lt: todayEnd },
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          items: { include: { product: { include: { seller: true } } } },
          buyer: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.count({ where }),
    ]);
    const totalPages = Math.ceil(total / limit);
    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  /** Seller: get order counts by status for tab badges */
  async getSellerOrderCounts(userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller)
      throw new ForbiddenException('User is not a registered seller');

    const baseWhere: Prisma.OrderWhereInput = {
      streamId: { not: null },
      items: { some: { product: { sellerId: seller.id } } },
    };
    const [all, pending, processing, packed, shipped] = await Promise.all([
      this.prisma.order.count({ where: baseWhere }),
      this.prisma.order.count({
        where: { ...baseWhere, status: OrderStatus.PENDING },
      }),
      this.prisma.order.count({
        where: { ...baseWhere, status: OrderStatus.PAID },
      }),
      this.prisma.order.count({
        where: { ...baseWhere, status: OrderStatus.PACKED },
      }),
      this.prisma.order.count({
        where: {
          ...baseWhere,
          status: { in: [OrderStatus.SHIPPED, OrderStatus.DELIVERED] },
        },
      }),
    ]);
    return {
      all,
      pending,
      processing,
      packed,
      shipped,
    };
  }

  /** Seller: accept order (PENDING -> PAID) */
  async acceptOrder(orderId: string, userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller)
      throw new ForbiddenException('User is not a registered seller');

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    const hasSellerProduct = order.items.some(
      (item) => item.product.sellerId === seller.id,
    );
    if (!hasSellerProduct) {
      throw new ForbiddenException('This order does not contain your products');
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException(
        'Only pending orders can be accepted. Current status: ' + order.status,
      );
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.PAID },
      include: {
        items: { include: { product: true } },
        buyer: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
  }

  /** Seller: mark order as shipped (add tracking). Order must contain seller's products and be PAID. */
  async shipOrder(orderId: string, userId: string, dto: ShipOrderDto) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller)
      throw new ForbiddenException('User is not a registered seller');

    const existingOrder = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } },
    });
    if (!existingOrder) throw new NotFoundException('Order not found');
    const hasSellerProduct = existingOrder.items.some(
      (item) => item.product.sellerId === seller.id,
    );
    if (!hasSellerProduct) {
      throw new ForbiddenException('This order does not contain your products');
    }
    if (existingOrder.streamId) {
      throw new BadRequestException(
        'Live-originated orders use packing video and “Request delivery” instead of manual shipping.',
      );
    }
    if (existingOrder.status !== OrderStatus.PAID) {
      throw new BadRequestException(
        'Only paid orders can be marked as shipped. Current status: ' +
          existingOrder.status,
      );
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.SHIPPED,
        trackingId: dto.trackingId,
        carrierName: dto.carrierName,
        shippedAt: new Date(),
      },
      include: {
        items: { include: { product: true } },
        buyer: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
  }

  /** Seller: mark order as delivered. Order must contain seller's products and be SHIPPED. */
  async deliverOrder(orderId: string, userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller)
      throw new ForbiddenException('User is not a registered seller');

    const existingOrder = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } },
    });
    if (!existingOrder) throw new NotFoundException('Order not found');
    const hasSellerProduct = existingOrder.items.some(
      (item) => item.product.sellerId === seller.id,
    );
    if (!hasSellerProduct) {
      throw new ForbiddenException('This order does not contain your products');
    }
    if (existingOrder.status !== OrderStatus.SHIPPED) {
      throw new BadRequestException(
        'Only shipped orders can be marked as delivered. Current status: ' +
          existingOrder.status,
      );
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.DELIVERED,
        deliveredAt: new Date(),
      },
      include: {
        items: { include: { product: true } },
        buyer: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
  }

  /** Buyer: cancel own order. Only PENDING or PAID orders can be cancelled. Restores stock. */
  async cancelOrder(orderId: string, userId: string) {
    const buyer = await this.prisma.buyer.findUnique({
      where: { userId },
    });
    if (!buyer) {
      throw new ForbiddenException('User is not a registered buyer');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.buyerId !== buyer.id) {
      throw new ForbiddenException('You can only cancel your own orders');
    }
    if (
      order.status !== OrderStatus.PENDING &&
      order.status !== OrderStatus.PAID &&
      order.status !== OrderStatus.PACKED
    ) {
      throw new BadRequestException(
        'Only pending, paid, or packed orders can be cancelled. Current status: ' +
          order.status,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        const p = await tx.product.findUnique({ where: { id: item.productId } });
        if (!p) continue;
        if (item.variantId && productHasVariantItems(p.variants)) {
          const { variants, totalStock } = applyVariantStockDelta(
            p.variants,
            item.variantId,
            item.quantity,
          );
          await tx.product.update({
            where: { id: item.productId },
            data: { variants, stock: totalStock },
          });
        } else {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
        }
      }
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED },
      });
    });

    return this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: true } },
        buyer: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
  }

  /** Buyer: request return on delivered order. */
  async returnOrder(orderId: string, userId: string) {
    const buyer = await this.prisma.buyer.findUnique({
      where: { userId },
    });
    if (!buyer) {
      throw new ForbiddenException('User is not a registered buyer');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: true } },
        buyer: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.buyerId !== buyer.id) {
      throw new ForbiddenException('You can only return your own orders');
    }
    if (order.status !== OrderStatus.DELIVERED) {
      throw new BadRequestException(
        'Only delivered orders can be returned. Current status: ' +
          order.status,
      );
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.RETURNED },
      include: {
        items: { include: { product: true } },
        buyer: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
  }

  async uploadPackingVideo(
    orderId: string,
    userId: string,
    file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Video file is required');
    }
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller) {
      throw new ForbiddenException('User is not a registered seller');
    }
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (!order.streamId) {
      throw new BadRequestException('Packing video applies to live stream orders only');
    }
    const hasSellerProduct = order.items.some(
      (item) => item.product.sellerId === seller.id,
    );
    if (!hasSellerProduct) {
      throw new ForbiddenException('This order does not contain your products');
    }
    if (order.status !== OrderStatus.PAID) {
      throw new BadRequestException(
        'Order must be accepted (paid) before packing. Status: ' + order.status,
      );
    }
    const dir = path.join(process.cwd(), 'uploads', 'packing');
    await fs.mkdir(dir, { recursive: true });
    const ext = path.extname(file.originalname) || '.mp4';
    const fname = `${orderId}${ext}`;
    const dest = path.join(dir, fname);
    await fs.writeFile(dest, file.buffer);
    const base = resolvePublicBaseUrl(this.config);
    const packingVideoUrl = `${base}/uploads/packing/${fname}`;
    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        packingVideoUrl,
        packedAt: new Date(),
        status: OrderStatus.PACKED,
      },
      include: {
        items: { include: { product: true } },
        buyer: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
  }

  async requestDeliveryFromPartner(orderId: string, userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller) {
      throw new ForbiddenException('User is not a registered seller');
    }
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (!order.streamId) {
      throw new BadRequestException('Only live-originated orders use this action');
    }
    const hasSellerProduct = order.items.some(
      (item) => item.product.sellerId === seller.id,
    );
    if (!hasSellerProduct) {
      throw new ForbiddenException('This order does not contain your products');
    }
    if (order.status !== OrderStatus.PACKED) {
      throw new BadRequestException(
        'Order must be packed first. Current status: ' + order.status,
      );
    }
    const mock = this.mockDelivery.requestPickup(orderId);
    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.SHIPPED,
        trackingId: mock.trackingId,
        carrierName: mock.carrierName,
        shippedAt: new Date(),
        deliveryMockShipmentId: mock.externalId,
        deliveryStatus: 'REQUESTED',
      },
      include: {
        items: { include: { product: true } },
        buyer: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
  }

  async getOrderDeliveryStatus(orderId: string, userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller) {
      throw new ForbiddenException('User is not a registered seller');
    }
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    const hasSellerProduct = order.items.some(
      (item) => item.product.sellerId === seller.id,
    );
    if (!hasSellerProduct) {
      throw new ForbiddenException('This order does not contain your products');
    }
    this.mockDelivery.touchPoll(orderId);
    const live = this.mockDelivery.getDeliveryStatus(orderId);
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { deliveryStatus: live },
    });
    return {
      deliveryStatus: updated.deliveryStatus,
      trackingId: updated.trackingId,
      carrierName: updated.carrierName,
      orderStatus: updated.status,
    };
  }
}
