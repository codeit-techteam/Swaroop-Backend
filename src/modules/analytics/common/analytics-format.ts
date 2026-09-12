import { Prisma } from '../../../generated/prisma/client.js';
import { toDecimal } from '../../payments/common/money.util.js';

/** Format money for API responses (2 dp string). Calculations stay on Decimal. */
export function moneyStr(
  value: Prisma.Decimal | number | string | null | undefined,
): string {
  return toDecimal(value).toFixed(2);
}

export function qtyStr(
  value: Prisma.Decimal | number | string | null | undefined,
): string {
  return toDecimal(value).toDecimalPlaces(3).toFixed(3);
}

/** Safe rate: numerator/denominator → 0..1 (or percent 0..100). Never NaN/Infinity. */
export function safeRate(
  numerator: number,
  denominator: number,
  asPercent = false,
): number {
  if (!denominator || denominator <= 0) return 0;
  const rate = numerator / denominator;
  if (!Number.isFinite(rate)) return 0;
  const scaled = asPercent ? rate * 100 : rate;
  return Math.round(scaled * 10000) / 10000;
}

export function avgSeconds(
  totalMs: number | null | undefined,
  count: number,
): number | null {
  if (count <= 0 || totalMs == null || !Number.isFinite(totalMs)) return null;
  return Math.round(totalMs / count / 1000);
}
