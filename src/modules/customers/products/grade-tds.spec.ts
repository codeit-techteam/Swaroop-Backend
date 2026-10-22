import { NotFoundException } from '@nestjs/common';
import {
  DocumentCategory,
  DocumentStatus,
  EntityOwnerType,
} from '../../../generated/prisma/client.js';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../database/prisma.service.js';
import type { ProductDocumentsQueryService } from '../../documents/services/product-documents-query.service.js';
import type { CustomerContextService } from '../common/customer-context.service.js';
import { ProductsService } from './products.service.js';

const grade = {
  id: 'grade-1',
  code: 'G1',
  name: 'F46003',
  displayName: 'HDPE F46003',
};

function setup(opts: {
  grade?: typeof grade | null;
  products?: Array<Record<string, unknown>>;
  docs?: Array<Record<string, unknown>>;
} = {}) {
  const products = opts.products ?? [];
  const docs = opts.docs ?? [];
  const prisma = {
    grade: {
      findFirst: vi.fn(async () =>
        opts.grade === undefined ? grade : opts.grade,
      ),
    },
    product: {
      findMany: vi.fn(async () => products),
    },
    document: {
      findMany: vi.fn(async () => docs),
    },
  };
  const customerContext = {
    getOrCreateCustomer: vi.fn(async () => ({ customerProfileId: 'c1' })),
  };
  const productDocuments = {
    mapCustomerDoc: vi.fn((doc: { id: string; category: string }) => ({
      id: doc.id,
      type: doc.category,
      title: 'Technical Data Sheet',
      available: true,
    })),
  };
  const service = new ProductsService(
    prisma as unknown as PrismaService,
    customerContext as unknown as CustomerContextService,
    productDocuments as unknown as ProductDocumentsQueryService,
  );
  return { service, prisma, productDocuments };
}

describe('listGradeTdsDocuments', () => {
  it('returns available:false when grade has no buyable products', async () => {
    const { service, prisma } = setup({ products: [] });
    const result = await service.listGradeTdsDocuments(null, 'grade-1');

    expect(result.available).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.message).toMatch(/no buyable products/i);
    expect(prisma.document.findMany).not.toHaveBeenCalled();
  });

  it('queries documents only for product ids under the grade', async () => {
    const { service, prisma } = setup({
      products: [
        {
          id: 'prod-a',
          code: 'PA',
          name: 'Product A',
          brand: 'Brand',
          manufacturer: 'RIL',
        },
        {
          id: 'prod-b',
          code: 'PB',
          name: 'Product B',
          brand: null,
          manufacturer: null,
        },
      ],
      docs: [
        {
          id: 'doc-a',
          ownerId: 'prod-a',
          category: DocumentCategory.TDS,
          mimeType: 'application/pdf',
          fileSizeBytes: BigInt(100),
          status: DocumentStatus.VERIFIED,
          version: 1,
          metadata: {},
        },
      ],
    });

    const result = await service.listGradeTdsDocuments(null, 'grade-1');

    const [docQuery] = prisma.document.findMany.mock.calls[0] as unknown as [
      { where: Record<string, unknown> },
    ];
    expect(docQuery.where).toMatchObject({
      deletedAt: null,
      ownerType: EntityOwnerType.PRODUCT,
      ownerId: { in: ['prod-a', 'prod-b'] },
      category: {
        in: [DocumentCategory.TDS, DocumentCategory.PRODUCT_TDS],
      },
    });
    // Wrong-grade docs never appear because findMany is scoped to grade product ids.
    expect(result.available).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].productId).toBe('prod-a');
    expect(result.items[0].downloadRequiresAuth).toBe(true);
  });

  it('throws when grade is not customer-visible', async () => {
    const { service } = setup({ grade: null });
    await expect(
      service.listGradeTdsDocuments(null, 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
