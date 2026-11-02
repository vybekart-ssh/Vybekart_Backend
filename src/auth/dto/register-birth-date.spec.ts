import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterBuyerDto, RegisterSellerDto } from './auth.dto';

const buyerBase = {
  email: 'buyer@example.com',
  password: 'secret123',
  firstName: 'Asha',
  lastName: 'Rao',
  gender: 'FEMALE',
  phone: '+919876543210',
};

const sellerBase = {
  ...buyerBase,
  businessName: 'Asha Textiles',
  categoryIds: ['3f1c2b4a-8d9e-4f10-9a2b-1c3d4e5f6a7b'],
  pickupAddress: { line1: '12 MG Road', city: 'Pune', state: 'Maharashtra', zip: '411001' },
  bankName: 'HDFC Bank',
  accountHolderName: 'Asha Rao',
  accountType: 'SAVINGS',
  bankAccount: '123456789012',
  ifscCode: 'HDFC0001234',
};

async function birthDateErrors(cls: new () => object, body: Record<string, unknown>) {
  const errors = await validate(plainToInstance(cls, body) as object);
  const field = errors.find((e) => e.property === 'birthDate');
  return field ? Object.values(field.constraints ?? {}) : [];
}

describe('Registration birthDate', () => {
  it.each([
    ['buyer', RegisterBuyerDto, buyerBase],
    ['seller', RegisterSellerDto, sellerBase],
  ] as const)('%s: missing or blank birthDate is rejected with one clear message', async (_, cls, base) => {
    expect(await birthDateErrors(cls, { ...base })).toEqual(['Date of birth is required']);
    expect(await birthDateErrors(cls, { ...base, birthDate: '' })).toEqual(['Date of birth is required']);
    expect(await birthDateErrors(cls, { ...base, birthDate: null })).toEqual(['Date of birth is required']);
  });

  it.each([
    ['buyer', RegisterBuyerDto, buyerBase],
    ['seller', RegisterSellerDto, sellerBase],
  ] as const)('%s: wrong format is rejected, YYYY-MM-DD passes', async (_, cls, base) => {
    expect(await birthDateErrors(cls, { ...base, birthDate: '12/03/1998' })).toEqual([
      'birthDate must be a date in YYYY-MM-DD format',
    ]);
    expect(await birthDateErrors(cls, { ...base, birthDate: '1998-03-12' })).toEqual([]);
  });
});
