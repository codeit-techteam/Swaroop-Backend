import { Prisma } from '../../../generated/prisma/client.js';

export type Money = Prisma.Decimal;

export function toDecimal(
  value: Prisma.Decimal | number | string | null | undefined,
): Money {
  if (value == null) return new Prisma.Decimal(0);
  if (value instanceof Prisma.Decimal) return value;
  return new Prisma.Decimal(value);
}

/** Round to 2 decimal places (banker's half-up via Decimal.toDecimalPlaces). */
export function round2(value: Prisma.Decimal | number | string): Money {
  return toDecimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function add(
  a: Prisma.Decimal | number | string,
  b: Prisma.Decimal | number | string,
): Money {
  return round2(toDecimal(a).plus(toDecimal(b)));
}

export function sub(
  a: Prisma.Decimal | number | string,
  b: Prisma.Decimal | number | string,
): Money {
  return round2(toDecimal(a).minus(toDecimal(b)));
}

export function mul(
  a: Prisma.Decimal | number | string,
  b: Prisma.Decimal | number | string,
): Money {
  return toDecimal(a).times(toDecimal(b));
}

export function cmp(
  a: Prisma.Decimal | number | string,
  b: Prisma.Decimal | number | string,
): number {
  return toDecimal(a).comparedTo(toDecimal(b));
}

export function isPositive(value: Prisma.Decimal | number | string): boolean {
  return cmp(value, 0) > 0;
}

export function isZero(value: Prisma.Decimal | number | string): boolean {
  return cmp(value, 0) === 0;
}

/**
 * Split `total` across percentage lines; last line absorbs rounding remainder
 * so amounts sum exactly to `total`.
 */
export function splitByPercentages(
  total: Prisma.Decimal | number | string,
  percentages: number[],
): Money[] {
  const totalDec = round2(total);
  if (percentages.length === 0) return [];

  const amounts: Money[] = [];
  let allocated = new Prisma.Decimal(0);

  for (let i = 0; i < percentages.length; i++) {
    if (i === percentages.length - 1) {
      amounts.push(round2(totalDec.minus(allocated)));
    } else {
      const part = round2(totalDec.times(percentages[i]).dividedBy(100));
      amounts.push(part);
      allocated = allocated.plus(part);
    }
  }

  return amounts;
}
