/**
 * Shared From / Reply-To helpers for Resend deliverability.
 * Never fall back to onboarding@resend.dev — that domain lands in spam.
 */

const RESEND_ONBOARDING = /onboarding@resend\.dev/i;

export const MAIL_DEFAULTS = {
  contact: 'contact@vybekart.co.in',
  support: 'support@vybekart.co.in',
  noreply: 'noreply@vybekart.co.in',
} as const;

/** Extract bare email from `Name <email>` or return trimmed input. */
export function extractEmailAddress(from: string): string {
  const m = from.trim().match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

/**
 * Build `Display Name <addr@domain>` for Resend.
 * Rejects empty / resend.dev values and uses fallbackAddress instead.
 */
export function formatMailFrom(
  raw: string | undefined | null,
  displayName: string,
  fallbackAddress: string,
): string {
  const fallbackEmail = extractEmailAddress(fallbackAddress);
  let value = (raw ?? '').trim();

  if (!value || RESEND_ONBOARDING.test(value)) {
    return `${displayName} <${fallbackEmail}>`;
  }

  const named = value.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (named) {
    const name = named[1].trim() || displayName;
    const email = named[2].trim();
    if (!email || RESEND_ONBOARDING.test(email)) {
      return `${displayName} <${fallbackEmail}>`;
    }
    return `${name} <${email}>`;
  }

  if (value.includes('@') && !RESEND_ONBOARDING.test(value)) {
    return `${displayName} <${value}>`;
  }

  return `${displayName} <${fallbackEmail}>`;
}

/**
 * Reply-To for support tickets: only real user addresses.
 * Omits noreply / resend.dev / empty (those hurt spam scoring).
 */
export function sanitizeReplyTo(
  email: string | undefined | null,
): string | undefined {
  const value = (email ?? '').trim();
  if (!value || !value.includes('@')) return undefined;
  if (RESEND_ONBOARDING.test(value)) return undefined;
  if (/^noreply@/i.test(value)) return undefined;
  return value;
}
