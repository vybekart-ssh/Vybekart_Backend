import { InvoiceTaxLine } from './invoice.types';

const DEFAULT_GST_PERCENT = 18;
const SHIPPING_GST_PERCENT = 18;

const STATE_NAMES: Record<string, string> = {
  '01': 'JAMMU AND KASHMIR',
  '02': 'HIMACHAL PRADESH',
  '03': 'PUNJAB',
  '04': 'CHANDIGARH',
  '05': 'UTTARAKHAND',
  '06': 'HARYANA',
  '07': 'DELHI',
  '08': 'RAJASTHAN',
  '09': 'UTTAR PRADESH',
  '10': 'BIHAR',
  '11': 'SIKKIM',
  '12': 'ARUNACHAL PRADESH',
  '13': 'NAGALAND',
  '14': 'MANIPUR',
  '15': 'MIZORAM',
  '16': 'TRIPURA',
  '17': 'MEGHALAYA',
  '18': 'ASSAM',
  '19': 'WEST BENGAL',
  '20': 'JHARKHAND',
  '21': 'ODISHA',
  '22': 'CHHATTISGARH',
  '23': 'MADHYA PRADESH',
  '24': 'GUJARAT',
  '27': 'MAHARASHTRA',
  '29': 'KARNATAKA',
  '30': 'GOA',
  '32': 'KERALA',
  '33': 'TAMIL NADU',
  '34': 'PUDUCHERRY',
  '36': 'TELANGANA',
  '37': 'ANDHRA PRADESH',
};

export function roundInr(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatInrPdf(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function extractPanFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin || gstin.length < 12) return null;
  const pan = gstin.substring(2, 12).toUpperCase();
  return /^[A-Z]{5}\d{4}[A-Z]$/.test(pan) ? pan : null;
}

export function stateCodeFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin || gstin.length < 2) return null;
  const code = gstin.substring(0, 2);
  return /^\d{2}$/.test(code) ? code : null;
}

export function stateCodeFromPin(pin: string | null | undefined): string | null {
  if (!pin) return null;
  const m = pin.match(/\b(\d{6})\b/);
  if (!m) return null;
  const first = m[1].charAt(0);
  const map: Record<string, string> = {
    '1': '11',
    '2': '20',
    '3': '24',
    '4': '27',
    '5': '29',
    '6': '33',
    '7': '36',
    '8': '19',
  };
  return map[first] ?? null;
}

export function stateNameFromCode(code: string | null | undefined): string | null {
  if (!code) return null;
  return STATE_NAMES[code] ?? null;
}

export function extractPinFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/\b(\d{6})\b/);
  return m?.[1] ?? null;
}

export function splitGstInclusive(
  amountIncl: number,
  gstPercent: number | null | undefined,
  sellerStateCode: string | null,
  buyerStateCode: string | null,
): { net: number; taxes: InvoiceTaxLine[] } {
  const rate = gstPercent ?? DEFAULT_GST_PERCENT;
  const net = roundInr(amountIncl / (1 + rate / 100));
  const taxTotal = roundInr(amountIncl - net);
  const intra =
    sellerStateCode && buyerStateCode && sellerStateCode === buyerStateCode;

  if (intra) {
    const half = roundInr(taxTotal / 2);
    const other = roundInr(taxTotal - half);
    return {
      net,
      taxes: [
        { ratePercent: rate / 2, type: 'CGST', amount: half },
        { ratePercent: rate / 2, type: 'SGST', amount: other },
      ],
    };
  }

  return {
    net,
    taxes: [{ ratePercent: rate, type: 'IGST', amount: taxTotal }],
  };
}

export function shippingGstPercent(): number {
  return SHIPPING_GST_PERCENT;
}

const ones = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const tens = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

function twoDigits(n: number): string {
  if (n < 20) return ones[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return `${tens[t]}${o ? ` ${ones[o]}` : ''}`.trim();
}

function threeDigits(n: number): string {
  if (n < 100) return twoDigits(n);
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return `${ones[h]} Hundred${rest ? ` ${twoDigits(rest)}` : ''}`;
}

/** Indian numbering: amount in words for rupees (paise ignored per sample). */
export function amountInWordsInr(amount: number): string {
  const rupees = Math.floor(Math.round(amount));
  if (rupees === 0) return 'Zero only';

  const parts: string[] = [];
  let n = rupees;

  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = n;

  if (crore) parts.push(`${twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(threeDigits(hundred));

  return `${parts.join(' ').trim()} only`;
}

export function formatInvoiceDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

export function formatPaymentDateTime(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const sec = String(d.getSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy}, ${hh}:${min}:${sec} hrs`;
}
