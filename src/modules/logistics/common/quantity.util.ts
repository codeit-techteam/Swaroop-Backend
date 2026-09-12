import { Prisma } from '../../../generated/prisma/client.js';

export type Qty = Prisma.Decimal;

export function toQty(
  value: Prisma.Decimal | number | string | null | undefined,
): Qty {
  if (value == null) return new Prisma.Decimal(0);
  if (value instanceof Prisma.Decimal) return value;
  return new Prisma.Decimal(value);
}

export function round3(value: Prisma.Decimal | number | string): Qty {
  return toQty(value).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
}

export function addQty(
  a: Prisma.Decimal | number | string,
  b: Prisma.Decimal | number | string,
): Qty {
  return round3(toQty(a).plus(toQty(b)));
}

export function subQty(
  a: Prisma.Decimal | number | string,
  b: Prisma.Decimal | number | string,
): Qty {
  return round3(toQty(a).minus(toQty(b)));
}

export function cmpQty(
  a: Prisma.Decimal | number | string,
  b: Prisma.Decimal | number | string,
): number {
  return toQty(a).comparedTo(toQty(b));
}

export function isPositiveQty(
  value: Prisma.Decimal | number | string,
): boolean {
  return cmpQty(value, 0) > 0;
}
