/**
 * Central Indian mobile normalization for OTP / MSG91.
 * Output is E.164 (`+91XXXXXXXXXX`) for app storage and auth.
 */

export function composeMobile(
  mobile?: string,
  countryCode?: string,
): string | undefined {
  if (!mobile?.trim()) return undefined;
  const digits = mobile.replace(/\D/g, '');
  if (!digits) return undefined;
  if (mobile.trim().startsWith('+')) return mobile.trim();
  const cc = (countryCode ?? '+91').trim().replace(/^\+/, '') || '91';
  return `+${cc}${digits}`;
}

/**
 * Normalize to E.164. Accepts +91…, 91…, or bare 10-digit Indian mobiles.
 * Throws if the value cannot be normalized safely.
 */
export function normalizePhoneE164(raw: string): string {
  const trimmed = raw.trim();
  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) {
    return trimmed;
  }
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    return `+91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+${digits}`;
  }
  // Guard against double country code: 9191XXXXXXXX
  if (digits.length === 14 && digits.startsWith('9191')) {
    const local = digits.slice(4);
    if (/^[6-9]\d{9}$/.test(local)) return `+91${local}`;
  }
  if (digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }
  throw new Error('phone must be a valid mobile number');
}

/** MSG91 expects digits with country code, no plus: 91XXXXXXXXXX */
export function toMsg91Mobile(e164OrRaw: string): string {
  const e164 = normalizePhoneE164(e164OrRaw);
  const digits = e164.replace(/\D/g, '');
  if (!digits) {
    throw new Error('Invalid mobile number for MSG91');
  }
  return digits;
}
