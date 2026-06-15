import * as crypto from 'crypto';

export type SellerInterestPayload = {
  email: string;
  store: string;
  contact: string;
};

function canonicalPayload(p: SellerInterestPayload): string {
  return [
    p.email.trim().toLowerCase(),
    p.store.trim(),
    p.contact.trim(),
  ].join('|');
}

export function signSellerInterest(
  payload: SellerInterestPayload,
  secret: string,
): string {
  return crypto
    .createHmac('sha256', secret)
    .update(canonicalPayload(payload))
    .digest('base64url');
}

export function verifySellerInterest(
  payload: SellerInterestPayload,
  sig: string,
  secret: string,
): boolean {
  if (!secret || !sig?.trim()) return false;
  const expected = signSellerInterest(payload, secret);
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(sig.trim());
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function buildSellerInterestUrl(
  apiBaseUrl: string,
  payload: SellerInterestPayload,
  secret: string,
): string {
  const base = apiBaseUrl.replace(/\/$/, '');
  const sig = signSellerInterest(payload, secret);
  const q = new URLSearchParams({
    email: payload.email.trim().toLowerCase(),
    store: payload.store.trim(),
    contact: payload.contact.trim(),
    sig,
  });
  return `${base}/public/seller-outreach/interested?${q.toString()}`;
}
