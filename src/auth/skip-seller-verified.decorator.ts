import { SetMetadata } from '@nestjs/common';

export const SKIP_SELLER_VERIFIED_KEY = 'skipSellerVerified';

/** Use on seller-only routes that must work before VybeKart verifies the account (e.g. profile read, onboarding logo upload). */
export const SkipSellerVerified = () => SetMetadata(SKIP_SELLER_VERIFIED_KEY, true);
