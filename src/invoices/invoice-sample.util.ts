import { buildInvoiceBranding } from './invoice-branding.util';
import { InvoiceDocumentPayload, InvoicePagePayload } from './invoice.types';
import { amountInWordsInr, roundInr } from './invoice-tax.util';

export function buildSampleInvoiceDocument(): InvoiceDocumentPayload {
  const now = new Date();
  const lineNet = roundInr(847.46);
  const cgst = roundInr(76.27);
  const sgst = roundInr(76.27);
  const grandTotal = roundInr(999);
  const branding = buildInvoiceBranding();

  const page: InvoicePagePayload = {
    pageNo: 1,
    pageTotal: 1,
    orderNumber: 'SAMPLE-ORDER-001',
    invoiceNumber: 'VK-ORD-SAMPLE01-20260526',
    orderDate: now,
    invoiceDate: now,
    invoiceDetails: 'VK-ORD-SAMPLE01-20260526-DEMO',
    soldBy: {
      name: 'Demo Seller — Fashion Hub',
      lines: [
        'Shop 12, Phoenix Market City',
        'LBS Marg, Kurla West',
        'Mumbai, Maharashtra 400070',
        'India',
      ],
      pan: 'AABCD1234E',
      gstin: '27AABCD1234E1Z5',
      stateCode: '27',
      stateName: 'MAHARASHTRA',
    },
    billing: {
      name: 'Sample Buyer',
      lines: ['42 Residency Road', 'Kalyan, Maharashtra 421102'],
      stateCode: '27',
      stateName: 'MAHARASHTRA',
    },
    shipping: {
      name: 'Sample Buyer',
      lines: ['42 Residency Road', 'Kalyan, Maharashtra 421102'],
      stateCode: '27',
      stateName: 'MAHARASHTRA',
    },
    placeOfSupply: 'MAHARASHTRA',
    placeOfDelivery: 'MAHARASHTRA',
    lineItems: [
      {
        slNo: 1,
        description: 'VybeKart Demo T-Shirt (Blue / M)',
        hsnCode: '6109',
        unitPriceIncl: 999,
        discount: 0,
        quantity: 1,
        netAmount: lineNet,
        taxes: [
          { ratePercent: 9, type: 'CGST', amount: cgst },
          { ratePercent: 9, type: 'SGST', amount: sgst },
        ],
        totalAmount: grandTotal,
      },
    ],
    totalTax: roundInr(cgst + sgst),
    grandTotal,
    amountInWords: amountInWordsInr(grandTotal),
    paymentTransactionId: 'pay_SAMPLE123456',
    paymentDateTime: now,
    paymentMode: 'Razorpay',
    branding,
  };

  return {
    filename: 'Vybekart_Sample_Tax_Invoice.pdf',
    pages: [page],
  };
}
