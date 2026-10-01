import {
  ImportQuantityUnit,
  Prisma,
} from '../../../generated/prisma/client.js';

export type Decimal = Prisma.Decimal;
export const Decimal = Prisma.Decimal;

export type DecimalInput = string | number | Prisma.Decimal | null | undefined;

/** Parse a user-supplied numeric value without going through JS floats. */
export function toDecimal(value: DecimalInput): Prisma.Decimal | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Prisma.Decimal) return value;
  const text = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return new Prisma.Decimal(text);
}

export function decimalString(
  value: Prisma.Decimal | null | undefined,
): string | null {
  return value === null || value === undefined ? null : value.toString();
}

const KG_PER_MT = new Prisma.Decimal(1000);

/** MT/KG are convertible; containers and OTHER units are not. */
export function toMetricTons(
  value: Prisma.Decimal | null,
  unit: ImportQuantityUnit,
): Prisma.Decimal | null {
  if (!value) return null;
  if (unit === ImportQuantityUnit.MT) return value;
  if (unit === ImportQuantityUnit.KG) return value.div(KG_PER_MT);
  return null;
}

/**
 * Compare two quantities, converting MT/KG. Returns null when the units are
 * not comparable (e.g. CONTAINER vs MT).
 */
export function comparableQuantities(
  a: Prisma.Decimal | null,
  aUnit: ImportQuantityUnit,
  b: Prisma.Decimal | null,
  bUnit: ImportQuantityUnit,
): [Prisma.Decimal, Prisma.Decimal] | null {
  if (!a || !b) return null;
  if (aUnit === bUnit) return [a, b];
  const am = toMetricTons(a, aUnit);
  const bm = toMetricTons(b, bUnit);
  return am && bm ? [am, bm] : null;
}

/** Price per MT from a price quoted per KG (and vice versa). */
export function pricePerMetricTon(
  price: Prisma.Decimal | null,
  unit: ImportQuantityUnit,
): Prisma.Decimal | null {
  if (!price) return null;
  if (unit === ImportQuantityUnit.MT) return price;
  if (unit === ImportQuantityUnit.KG) return price.mul(KG_PER_MT);
  return null;
}
