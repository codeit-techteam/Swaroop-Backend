import { Prisma } from '../../../generated/prisma/client.js';

/**
 * Confirmed public test SKUs (client report 14 Nov 2026).
 * Soft-deactivate via scripts/soft-deactivate-confirmed-test-products.mjs when
 * production DATABASE_URL is available. This filter is defense-in-depth so
 * marketplace / search / recommendations never surface them while ACTIVE.
 */
export const EXCLUDED_TEST_PRODUCTS = [
  {
    id: '97625de6-82b0-4b3a-97f3-f2410b500011',
    code: 'E2E-BULK-14198',
    name: 'E2E Bulk Pricing Test',
  },
  {
    id: '6facf910-95c3-4d83-abd9-48ad7f78ebea',
    code: 'HDPE_BLOW',
    name: 'HD Blow Test',
  },
] as const;

export const EXCLUDED_TEST_PRODUCT_IDS = EXCLUDED_TEST_PRODUCTS.map((p) => p.id);

/** Prisma NOT clause: hide confirmed test products from customer/public catalogue. */
export function excludedTestProductWhere(): Prisma.ProductWhereInput {
  return {
    NOT: {
      OR: [
        { id: { in: [...EXCLUDED_TEST_PRODUCT_IDS] } },
        {
          AND: [
            { code: 'E2E-BULK-14198' },
            { name: { equals: 'E2E Bulk Pricing Test', mode: 'insensitive' } },
          ],
        },
        {
          AND: [
            { code: 'HDPE_BLOW' },
            { name: { equals: 'HD Blow Test', mode: 'insensitive' } },
          ],
        },
      ],
    },
  };
}

export function isExcludedTestProduct(input: {
  id?: string | null;
  code?: string | null;
  name?: string | null;
}): boolean {
  const id = input.id?.trim();
  if (id && EXCLUDED_TEST_PRODUCT_IDS.includes(id as (typeof EXCLUDED_TEST_PRODUCT_IDS)[number])) {
    return true;
  }
  const code = (input.code ?? '').trim().toUpperCase();
  const name = (input.name ?? '').trim().toLowerCase();
  return EXCLUDED_TEST_PRODUCTS.some(
    (p) =>
      p.code.toUpperCase() === code && p.name.toLowerCase() === name,
  );
}
