import type { InvoiceBranding } from './invoice-branding.types';

export type InvoiceTaxLine = {
  ratePercent: number;
  type: 'CGST' | 'SGST' | 'IGST';
  amount: number;
};

export type InvoiceLineItem = {
  slNo: number;
  description: string;
  hsnCode: string | null;
  unitPriceIncl: number;
  discount: number;
  quantity: number;
  netAmount: number;
  taxes: InvoiceTaxLine[];
  totalAmount: number;
};

export type InvoiceParty = {
  name: string;
  lines: string[];
  pan: string | null;
  gstin: string | null;
  stateCode: string | null;
  stateName: string | null;
};

export type InvoiceAddressBlock = {
  name: string;
  lines: string[];
  stateCode: string | null;
  stateName: string | null;
};

export type InvoicePagePayload = {
  pageNo: number;
  pageTotal: number;
  orderNumber: string;
  invoiceNumber: string;
  orderDate: Date;
  invoiceDate: Date;
  invoiceDetails: string;
  soldBy: InvoiceParty;
  billing: InvoiceAddressBlock;
  shipping: InvoiceAddressBlock;
  placeOfSupply: string;
  placeOfDelivery: string;
  lineItems: InvoiceLineItem[];
  totalTax: number;
  grandTotal: number;
  amountInWords: string;
  paymentTransactionId: string | null;
  paymentDateTime: Date | null;
  paymentMode: string;
  branding: InvoiceBranding;
  isReplacement?: boolean;
  originalOrderRef?: string;
};

export type InvoiceDocumentPayload = {
  filename: string;
  pages: InvoicePagePayload[];
};
