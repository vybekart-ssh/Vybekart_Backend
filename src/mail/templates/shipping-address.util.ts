/** Split order shipping snapshot (name / phone / street lines). */
export function parseShippingAddressSnapshot(raw: string | null | undefined): {
  shippingContactName: string | null;
  shippingPhone: string | null;
  shippingAddressLine: string;
} {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || trimmed === '—') {
    return {
      shippingContactName: null,
      shippingPhone: null,
      shippingAddressLine: '—',
    };
  }

  const lines = trimmed
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  if (lines.length === 1) {
    if (looksLikePhone(lines[0])) {
      return {
        shippingContactName: null,
        shippingPhone: lines[0],
        shippingAddressLine: '—',
      };
    }
    return {
      shippingContactName: null,
      shippingPhone: null,
      shippingAddressLine: lines[0],
    };
  }

  let name: string | null = null;
  let phone: string | null = null;
  let restStart = 0;

  if (!looksLikePhone(lines[0])) {
    name = lines[0];
    restStart = 1;
  }
  if (lines.length > restStart && looksLikePhone(lines[restStart])) {
    phone = lines[restStart];
    restStart += 1;
  }

  const addressLine = lines.slice(restStart).join(', ') || '—';
  return {
    shippingContactName: name,
    shippingPhone: phone,
    shippingAddressLine: addressLine,
  };
}

function looksLikePhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}
