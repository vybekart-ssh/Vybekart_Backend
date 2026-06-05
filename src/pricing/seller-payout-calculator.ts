export interface SellerPayoutLineItem {
  key: string;
  label: string;
  amount: number;
  formulaNote?: string;
}

export interface SellerPayoutBreakdown {
  customerPrice: number;
  netSettlement: number;
  commissionWaiverActive: boolean;
  commissionRate: number;
  deductions: SellerPayoutLineItem[];
  taxes: SellerPayoutLineItem[];
  info: SellerPayoutLineItem[];
  disclaimers: string[];
}

export interface SellerPayoutCalculatorConfig {
  paymentGatewayRate?: number;
  serviceGstRate?: number;
  vybeKartCommissionRate?: number;
  logisticsBaseInr?: number;
  tdsRate?: number;
  tcsRate?: number;
}

export const DEFAULT_PAYOUT_CONFIG: Required<SellerPayoutCalculatorConfig> = {
  paymentGatewayRate: 0.02,
  serviceGstRate: 0.18,
  vybeKartCommissionRate: 0.05,
  logisticsBaseInr: 75,
  tdsRate: 0.001,
  tcsRate: 0.005,
};

/** Round to 2 decimal places (half-up). */
export function roundInr(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateSellerPayout(
  customerPrice: number,
  commissionWaiverActive: boolean,
  config: SellerPayoutCalculatorConfig = {},
): SellerPayoutBreakdown {
  const cfg = { ...DEFAULT_PAYOUT_CONFIG, ...config };
  const commissionRate = commissionWaiverActive
    ? 0
    : cfg.vybeKartCommissionRate;

  const gatewayBase = customerPrice * cfg.paymentGatewayRate;
  const gatewayGst = gatewayBase * cfg.serviceGstRate;
  const gatewayTotal = gatewayBase + gatewayGst;

  const logisticsBase = cfg.logisticsBaseInr;
  const logisticsGst = logisticsBase * cfg.serviceGstRate;
  const logisticsTotal = logisticsBase + logisticsGst;

  const commissionBase =
    (customerPrice - gatewayTotal - logisticsTotal) * commissionRate;
  const commissionGst = commissionBase * cfg.serviceGstRate;
  const commissionTotal = commissionBase + commissionGst;

  const netSettlement =
    customerPrice - gatewayTotal - logisticsTotal - commissionTotal;

  const taxableBase = netSettlement / 1.12;
  const tds = taxableBase * cfg.tdsRate;
  const tcs = taxableBase * cfg.tcsRate;

  const inputGstCredits = commissionGst + gatewayGst + logisticsGst + tcs;

  const deductions: SellerPayoutLineItem[] = [
    {
      key: 'gateway',
      label: 'Payment gateway fees',
      amount: -roundInr(gatewayTotal),
      formulaNote: '2% of customer price + 18% GST on fee',
    },
    {
      key: 'logistics',
      label: 'Logistics (estimated)',
      amount: -roundInr(logisticsTotal),
      formulaNote: `₹${logisticsBase} base + 18% GST`,
    },
    {
      key: 'commission',
      label: 'Vybekart commission',
      amount: commissionTotal <= 0 ? 0 : -roundInr(commissionTotal),
      formulaNote: commissionWaiverActive
        ? '0% commission waiver active'
        : '5% of (customer price − gateway − logistics) + 18% GST',
    },
  ];

  const taxes: SellerPayoutLineItem[] = [
    {
      key: 'gst_commission',
      label: 'GST on commission',
      amount: roundInr(commissionGst),
      formulaNote: '18% on commission base',
    },
    {
      key: 'gst_gateway',
      label: 'GST on payment gateway',
      amount: roundInr(gatewayGst),
      formulaNote: '18% on gateway fee',
    },
    {
      key: 'gst_logistics',
      label: 'GST on logistics',
      amount: roundInr(logisticsGst),
      formulaNote: '18% on logistics base',
    },
    {
      key: 'tds',
      label: 'TDS (income tax)',
      amount: roundInr(tds),
      formulaNote: '0.1% of taxable base (net settlement ÷ 1.12)',
    },
    {
      key: 'tcs',
      label: 'TCS (GST)',
      amount: roundInr(tcs),
      formulaNote: '0.5% of taxable base',
    },
  ];

  const info: SellerPayoutLineItem[] = [
    {
      key: 'input_gst_credits',
      label: 'Input GST credits (info)',
      amount: roundInr(inputGstCredits),
      formulaNote: 'Commission + gateway + logistics GST + TCS',
    },
  ];

  const disclaimers = [
    'Product price is what shoppers pay. Delivery is added separately at checkout.',
    `Logistics deduction is estimated (₹${logisticsBase} + GST). Actual shipping may differ.`,
    'TDS and TCS are statutory withholdings shown for transparency.',
  ];

  return {
    customerPrice: roundInr(customerPrice),
    netSettlement: roundInr(netSettlement),
    commissionWaiverActive,
    commissionRate,
    deductions,
    taxes,
    info,
    disclaimers,
  };
}
