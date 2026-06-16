export type SellerEmailKind = 'email1' | 'email2';

/** Email 1 = visibility intro. Email 2 = partner invitation + interest button. */
export const SELLER_EMAIL_LABELS: Record<SellerEmailKind, string> = {
  email1: 'Email 1 — Visibility intro',
  email2: 'Email 2 — Partner invitation',
};

export interface SellerEmailRecipient {
  email: string;
  storeName: string;
  contactName: string;
  phone?: string;
  city?: string;
}

export interface BuiltSellerEmail {
  subject: string;
  html: string;
  text: string;
  attachments: ResendInlineAttachment[];
}

export interface ResendInlineAttachment {
  filename: string;
  content: string;
  content_id: string;
  content_type: string;
}

export interface SellerEmailSendResult {
  email: string;
  storeName: string;
  ok: boolean;
  resendId?: string;
  error?: string;
}
