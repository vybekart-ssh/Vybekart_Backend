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
  /** True when seller profile has a non-empty GSTIN. */
  gstRegistered: boolean;
  /** Taxable supply used for TDS/TCS (and product GST split when registered). */
  taxableSupply: number;
  deductions: SellerPayoutLineItem[];
  taxes: SellerPayoutLineItem[];
  info: SellerPayoutLineItem[];
  disclaimers: string[];
}

export interface SellerPayoutCalculatorConfig {
  paymentGatewayRate?: number;
  serviceGstRate?: number;
  /** Product GST rate used to back out taxable supply for GST-registered sellers (sheet: 18%). */
  productGstRate?: number;
  vybeKartCommissionRate?: number;
  logisticsBaseInr?: number;
  tdsRate?: number;
  tcsRate?: number;
  /** When true, taxable supply = customerPrice / (1 + productGst). When false, taxable = customerPrice. */
  gstRegistered?: boolean;
  /** Overrides the logistics deduction label. */
  logisticsLabel?: string;
  /** Overrides the logistics formula note. */
  logisticsNote?: string;
}

type ResolvedPayoutConfig = Required<
  Omit<SellerPayoutCalculatorConfig, 'logisticsLabel' | 'logisticsNote'>
> &
  Pick<SellerPayoutCalculatorConfig, 'logisticsLabel' | 'logisticsNote'>;

export const DEFAULT_PAYOUT_CONFIG: ResolvedPayoutConfig = {
  paymentGatewayRate: 0.02,
  serviceGstRate: 0.18,
  productGstRate: 0.18,
  vybeKartCommissionRate: 0.05,
  logisticsBaseInr: 75,
  tdsRate: 0.001,
  tcsRate: 0.005,
  gstRegistered: false,
};

/** Round to 2 decimal places (half-up). */
export function roundInr(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Non-empty GSTIN ⇒ GST-registered partner. */
export function isSellerGstRegistered(gstNumber: string | null | undefined): boolean {
  return Boolean(gstNumber?.trim());
}

export function calculateSellerPayout(
  customerPrice: number,
  commissionWaiverActive: boolean,
  config: SellerPayoutCalculatorConfig = {},
): SellerPayoutBreakdown {
  const cfg: ResolvedPayoutConfig = { ...DEFAULT_PAYOUT_CONFIG, ...config };
  const gstRegistered = cfg.gstRegistered;
  const gstDivisor = (1 + cfg.productGstRate).toFixed(2);
  const productGstPct = roundInr(cfg.productGstRate * 100);
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

  // GST registered: taxable = price × 100/118 (sheet). Unregistered: taxable = customer price.
  const taxableSupply = gstRegistered
    ? customerPrice / (1 + cfg.productGstRate)
    : customerPrice;
  const productGstAmount = gstRegistered
    ? customerPrice - taxableSupply
    : 0;

  const tds = taxableSupply * cfg.tdsRate;
  const tcs = taxableSupply * cfg.tcsRate;

  const netSettlement =
    customerPrice -
    gatewayTotal -
    logisticsTotal -
    commissionTotal -
    tds -
    tcs;

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
      label: cfg.logisticsLabel ?? 'Logistics',
      amount: logisticsTotal <= 0 ? 0 : -roundInr(logisticsTotal),
      formulaNote: cfg.logisticsNote ?? `₹${logisticsBase} flat per order + 18% GST`,
    },
    {
      key: 'commission',
      label: 'Vybekart commission',
      amount: commissionTotal <= 0 ? 0 : -roundInr(commissionTotal),
      formulaNote: commissionWaiverActive
        ? '0% commission waiver active'
        : '5% of (customer price − gateway − logistics) + 18% GST',
    },
    {
      key: 'tds',
      label: 'TDS (income tax)',
      amount: -roundInr(tds),
      formulaNote: gstRegistered
        ? `0.1% of taxable supply (customer price ÷ ${gstDivisor})`
        : '0.1% of customer price (taxable supply)',
    },
    {
      key: 'tcs',
      label: 'TCS (GST)',
      amount: -roundInr(tcs),
      formulaNote: gstRegistered
        ? `0.5% of taxable supply (customer price ÷ ${gstDivisor})`
        : '0.5% of customer price (taxable supply)',
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
  ];

  const info: SellerPayoutLineItem[] = [
    {
      key: 'taxable_supply',
      label: 'Taxable supply',
      amount: roundInr(taxableSupply),
      formulaNote: gstRegistered
        ? `Customer price excluding product GST (÷ ${gstDivisor})`
        : 'Customer price (GST-unregistered partner)',
    },
    ...(gstRegistered
      ? [
          {
            key: 'product_gst',
            label: 'Product GST (in customer price)',
            amount: roundInr(productGstAmount),
            formulaNote: `${productGstPct}% GST included in customer price`,
          } satisfies SellerPayoutLineItem,
        ]
      : []),
    {
      key: 'input_gst_credits',
      label: 'Input GST credits (info)',
      amount: roundInr(inputGstCredits),
      formulaNote: 'Commission + gateway + logistics GST + TCS',
    },
  ];

  const disclaimers = [
    'Product price is what shoppers pay for your product.',
    `Logistics is a flat ₹${logisticsBase} + 18% GST (₹${roundInr(logisticsTotal).toFixed(2)}) deducted on every order, whoever pays for delivery.`,
    gstRegistered
      ? `GST-registered partner: TDS and TCS are withheld from settlement on taxable supply (customer price ÷ ${gstDivisor}).`
      : 'GST-unregistered partner: TDS and TCS are withheld from settlement on the full customer price.',
  ];

  return {
    customerPrice: roundInr(customerPrice),
    netSettlement: roundInr(netSettlement),
    commissionWaiverActive,
    commissionRate,
    gstRegistered,
    taxableSupply: roundInr(taxableSupply),
    deductions,
    taxes,
    info,
    disclaimers,
  };
}
