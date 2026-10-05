import { createHash } from 'node:crypto';
import type { PanHolderInput } from './kyc-verification.types.js';

export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const GSTIN_CHECKSUM_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function normalizeIdentifier(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

export function isValidPan(value: string): boolean {
  return PAN_PATTERN.test(value);
}

/** GSTN check digit (Luhn mod 36 over the first 14 characters). */
export function gstinChecksumValid(gstin: string): boolean {
  if (!GSTIN_PATTERN.test(gstin)) return false;
  const mod = GSTIN_CHECKSUM_ALPHABET.length;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const code = GSTIN_CHECKSUM_ALPHABET.indexOf(gstin[i]);
    const product = code * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / mod) + (product % mod);
  }
  const check = (mod - (sum % mod)) % mod;
  return GSTIN_CHECKSUM_ALPHABET[check] === gstin[14];
}

export function isValidGstin(value: string): boolean {
  return gstinChecksumValid(value);
}

const PAN_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 .&'()/,-]*$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function normalizePanHolder(
  fullName: string,
  dob: string,
): PanHolderInput {
  return { fullName: fullName.trim().replace(/\s+/g, ' '), dob: dob.trim() };
}

/** A user-facing problem with the PAN holder details, or null when they are usable. */
export function panHolderProblem(
  holder: PanHolderInput,
  today: Date = new Date(),
): string | null {
  if (
    holder.fullName.length < 2 ||
    holder.fullName.length > 150 ||
    !PAN_NAME_PATTERN.test(holder.fullName)
  ) {
    return 'Enter the name exactly as printed on the PAN.';
  }
  const match = ISO_DATE_PATTERN.exec(holder.dob);
  const date = match
    ? new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]))
    : null;
  if (
    !match ||
    !date ||
    date.getUTCFullYear() !== +match[1] ||
    date.getUTCMonth() !== +match[2] - 1 ||
    date.getUTCDate() !== +match[3] ||
    +match[1] < 1850 ||
    date.getTime() > today.getTime()
  ) {
    return 'Enter a valid date of birth or incorporation (YYYY-MM-DD).';
  }
  return null;
}

/** Characters 3–12 of a GSTIN are the holder's PAN. */
export function panFromGstin(gstin: string): string {
  return gstin.slice(2, 12);
}

export function maskPan(pan: string): string {
  if (pan.length !== 10) return '••••••••••';
  return `${pan.slice(0, 2)}•••••${pan.slice(7)}`;
}

export function maskGstin(gstin: string): string {
  if (gstin.length !== 15) return '•••••••••••••••';
  return `${gstin.slice(0, 4)}•••••••${gstin.slice(11)}`;
}

/** Stable, non-reversible key used to dedupe verification attempts. */
export function hashIdentifier(type: 'PAN' | 'GST', value: string): string {
  return createHash('sha256')
    .update(`${type}:${normalizeIdentifier(value)}`)
    .digest('hex');
}
