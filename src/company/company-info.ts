import { ConfigService } from '@nestjs/config';

/**
 * Legal entity for Vybekart — matches https://vybekart.co.in/legal
 * (GST Registration Certificate Form GST REG-06).
 */
export const VYBEKART_COMPANY_INFO = {
  tradeName: 'LIVORA RETAIL',
  legalName: 'BHAVANA KAMLESH PRAJAPATI',
  platformBrand: 'Vybekart',
  gstin: '27BPYPP3775D1Z6',
  pan: 'BPYPP3775D',
  constitution: 'Proprietorship',
  registrationType: 'Regular',
  certificateForm: 'GST REG-06',
  dateOfIssue: '02/05/2026',
  address: {
    flatNo: 'B/1A/702',
    premises: 'NEPTUNE SWARAJYA',
    road: 'NEPTUNE SWARAJYA',
    locality: 'Ambivli',
    city: 'Kalyan',
    district: 'Thane',
    state: 'Maharashtra',
    pinCode: '421102',
    country: 'India',
  },
  proprietor: {
    name: 'BHAVANA KAMLESH PRAJAPATI',
    designation: 'Proprietor',
    state: 'Maharashtra',
  },
  contactEmail: 'contact@vybekart.co.in',
  website: 'https://vybekart.co.in',
} as const;

export type VybeKartCompanyInfo = {
  tradeName: string;
  legalName: string;
  platformBrand: string;
  gstin: string;
  pan: string;
  constitution: string;
  registrationType: string;
  certificateForm: string;
  dateOfIssue: string;
  addressLines: string[];
  proprietorLine: string;
  contactEmail: string;
  website: string;
  operatorSummary: string;
};

export function formatCompanyAddressLines(): string[] {
  const { address } = VYBEKART_COMPANY_INFO;
  return [
    `${address.flatNo}, ${address.premises}`,
    `${address.road}, ${address.locality}`,
    `${address.city}, ${address.district}`,
    `${address.state} — ${address.pinCode}, ${address.country}`,
  ];
}

export function getVybeKartCompanyInfo(
  config?: ConfigService,
): VybeKartCompanyInfo {
  const base = VYBEKART_COMPANY_INFO;
  const tradeName =
    config?.get<string>('VYBEKART_TRADE_NAME')?.trim() || base.tradeName;
  const legalName =
    config?.get<string>('VYBEKART_LEGAL_NAME')?.trim() || base.legalName;
  const platformBrand =
    config?.get<string>('VYBEKART_PLATFORM_BRAND')?.trim() ||
    base.platformBrand;
  const gstin =
    config?.get<string>('VYBEKART_PLATFORM_GSTIN')?.trim() || base.gstin;
  const pan = config?.get<string>('VYBEKART_PAN')?.trim() || base.pan;
  const contactEmail =
    config?.get<string>('SUPPORT_EMAIL')?.trim() ||
    config?.get<string>('VYBEKART_CONTACT_EMAIL')?.trim() ||
    base.contactEmail;
  const website =
    config?.get<string>('ALPHA_WEBSITE_URL')?.trim() || base.website;

  const registeredOffice =
    config?.get<string>('VYBEKART_REGISTERED_OFFICE')?.trim();
  const addressLines = registeredOffice
    ? registeredOffice.split('\n').map((l) => l.trim()).filter(Boolean)
    : formatCompanyAddressLines();

  const proprietorLine = `${base.proprietor.name} (${base.proprietor.designation})`;
  const operatorSummary = `${platformBrand} is operated by ${tradeName} (proprietorship of ${legalName}).`;

  return {
    tradeName,
    legalName,
    platformBrand,
    gstin,
    pan,
    constitution: base.constitution,
    registrationType: base.registrationType,
    certificateForm: base.certificateForm,
    dateOfIssue: base.dateOfIssue,
    addressLines,
    proprietorLine,
    contactEmail,
    website,
    operatorSummary,
  };
}
