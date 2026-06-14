import { ConfigService } from '@nestjs/config';
import { getVybeKartCompanyInfo } from '../company/company-info';
import type { InvoiceBranding } from './invoice-branding.types';

export function buildInvoiceBranding(config?: ConfigService): InvoiceBranding {
  const c = getVybeKartCompanyInfo(config);
  return {
    platformBrand: c.platformBrand,
    tradeName: c.tradeName,
    gstin: c.gstin,
  };
}
