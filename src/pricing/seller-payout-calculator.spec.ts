import {
  calculateSellerPayout,
  isSellerGstRegistered,
} from './seller-payout-calculator';

describe('SellerPayoutCalculator', () => {
  it('detects GST registration from non-empty GSTIN', () => {
    expect(isSellerGstRegistered('27AAAAA0000A1Z5')).toBe(true);
    expect(isSellerGstRegistered('  ')).toBe(false);
    expect(isSellerGstRegistered(null)).toBe(false);
    expect(isSellerGstRegistered(undefined)).toBe(false);
  });

  it('matches sheet golden values for GST-registered seller at ₹2,100', () => {
    const result = calculateSellerPayout(2100, false, { gstRegistered: true });

    expect(result.customerPrice).toBe(2100);
    expect(result.gstRegistered).toBe(true);
    expect(result.taxableSupply).toBe(1779.66);
    expect(result.netSettlement).toBe(1835.51);

    const gateway = result.deductions.find((d) => d.key === 'gateway');
    const logistics = result.deductions.find((d) => d.key === 'logistics');
    const commission = result.deductions.find((d) => d.key === 'commission');
    const tds = result.deductions.find((d) => d.key === 'tds');
    const tcs = result.deductions.find((d) => d.key === 'tcs');

    expect(gateway?.amount).toBe(-49.56);
    expect(logistics?.amount).toBe(-88.5);
    expect(commission?.amount).toBe(-115.75);
    expect(tds?.amount).toBe(-1.78);
    expect(tcs?.amount).toBe(-8.9);

    const gstCommission = result.taxes.find((t) => t.key === 'gst_commission');
    const gstGateway = result.taxes.find((t) => t.key === 'gst_gateway');
    const gstLogistics = result.taxes.find((t) => t.key === 'gst_logistics');

    expect(gstCommission?.amount).toBe(17.66);
    expect(gstGateway?.amount).toBe(7.56);
    expect(gstLogistics?.amount).toBe(13.5);

    const productGst = result.info.find((i) => i.key === 'product_gst');
    expect(productGst?.amount).toBe(320.34);

    const inputGst = result.info.find((i) => i.key === 'input_gst_credits');
    expect(inputGst?.amount).toBe(47.62);
  });

  it('matches sheet golden values for GST-unregistered seller at ₹1,780', () => {
    const result = calculateSellerPayout(1780, false, { gstRegistered: false });

    expect(result.customerPrice).toBe(1780);
    expect(result.gstRegistered).toBe(false);
    expect(result.taxableSupply).toBe(1780);
    expect(result.netSettlement).toBe(1541.49);

    const gateway = result.deductions.find((d) => d.key === 'gateway');
    const logistics = result.deductions.find((d) => d.key === 'logistics');
    const commission = result.deductions.find((d) => d.key === 'commission');
    const tds = result.deductions.find((d) => d.key === 'tds');
    const tcs = result.deductions.find((d) => d.key === 'tcs');

    expect(gateway?.amount).toBe(-42.01);
    expect(logistics?.amount).toBe(-88.5);
    expect(commission?.amount).toBe(-97.32);
    expect(tds?.amount).toBe(-1.78);
    expect(tcs?.amount).toBe(-8.9);

    expect(result.info.find((i) => i.key === 'product_gst')).toBeUndefined();
  });

  it('waives commission when commissionWaiverActive is true', () => {
    const withCommission = calculateSellerPayout(2100, false, {
      gstRegistered: true,
    });
    const result = calculateSellerPayout(2100, true, { gstRegistered: true });
    const commission = result.deductions.find((d) => d.key === 'commission');
    expect(commission?.amount).toBe(0);
    expect(result.commissionRate).toBe(0);
    expect(result.netSettlement).toBeGreaterThan(withCommission.netSettlement);
  });
});
