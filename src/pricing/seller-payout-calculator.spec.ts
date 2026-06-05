import { calculateSellerPayout } from './seller-payout-calculator';

describe('SellerPayoutCalculator', () => {
  it('matches PDF golden values for customer price ₹2,100', () => {
    const result = calculateSellerPayout(2100, false);

    expect(result.customerPrice).toBe(2100);
    expect(result.netSettlement).toBe(1846.19);

    const gateway = result.deductions.find((d) => d.key === 'gateway');
    const logistics = result.deductions.find((d) => d.key === 'logistics');
    const commission = result.deductions.find((d) => d.key === 'commission');

    expect(gateway?.amount).toBe(-49.56);
    expect(logistics?.amount).toBe(-88.5);
    expect(commission?.amount).toBe(-115.75);

    const gstCommission = result.taxes.find((t) => t.key === 'gst_commission');
    const gstGateway = result.taxes.find((t) => t.key === 'gst_gateway');
    const gstLogistics = result.taxes.find((t) => t.key === 'gst_logistics');
    const tds = result.taxes.find((t) => t.key === 'tds');
    const tcs = result.taxes.find((t) => t.key === 'tcs');

    expect(gstCommission?.amount).toBe(17.66);
    expect(gstGateway?.amount).toBe(7.56);
    expect(gstLogistics?.amount).toBe(13.5);
    expect(tds?.amount).toBe(1.65);
    expect(tcs?.amount).toBe(8.24);

    const inputGst = result.info.find((i) => i.key === 'input_gst_credits');
    expect(inputGst?.amount).toBe(46.96);
  });

  it('waives commission when commissionWaiverActive is true', () => {
    const result = calculateSellerPayout(2100, true);
    const commission = result.deductions.find((d) => d.key === 'commission');
    expect(commission?.amount).toBe(0);
    expect(result.commissionRate).toBe(0);
    expect(result.netSettlement).toBeGreaterThan(1846.19);
  });
});
