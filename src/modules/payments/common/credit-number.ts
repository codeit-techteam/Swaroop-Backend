import { randomInt, randomUUID } from 'node:crypto';

export function formatCreditRef(prefix: string, now = new Date()): string {
  const year = now.getFullYear();
  const seq = randomInt(0, 1_000_000).toString().padStart(6, '0');
  return `${prefix}-${year}-${seq}`;
}

/** Credit application numbers use `CR-YYYYMM-XXXXXX`. */
export function formatCreditApplicationNumber(now = new Date()): string {
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const seq = randomInt(0, 1_000_000).toString().padStart(6, '0');
  return `CR-${year}${month}-${seq}`;
}

export async function generateUniqueCreditApplicationNumber(
  exists: (candidate: string) => Promise<boolean>,
  maxAttempts = 12,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = formatCreditApplicationNumber();
    if (!(await exists(candidate))) return candidate;
  }
  const now = new Date();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  return `CR-${now.getFullYear()}${month}-${randomUUID().slice(0, 8)}`;
}

export async function generateUniqueCreditRef(
  exists: (candidate: string) => Promise<boolean>,
  prefix: string,
  maxAttempts = 12,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = formatCreditRef(prefix);
    if (!(await exists(candidate))) return candidate;
  }
  return `${prefix}-${new Date().getFullYear()}-${randomUUID().slice(0, 8)}`;
}

/**
 * True when a Prisma error is a unique-constraint violation on one of
 * `fields`. When the driver adapter omits the target, any P2002 counts.
 */
export function isUniqueViolationOn(error: unknown, fields: string[]): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== 'P2002') return false;
  const target = candidate.meta?.target;
  const matches = (value: unknown) =>
    fields.some((field) => String(value).includes(field));
  if (Array.isArray(target)) return target.some(matches);
  return typeof target === 'string' ? matches(target) : true;
}
