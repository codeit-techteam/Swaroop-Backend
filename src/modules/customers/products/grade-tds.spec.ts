import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../database/prisma.service.js';
import type { ProductDocumentsQueryService } from '../../documents/services/product-documents-query.service.js';
import type { GradeTdsService } from '../../tds/grade-tds.service.js';
import type { CustomerContextService } from '../common/customer-context.service.js';
import { ProductsService } from './products.service.js';

const gradePayload = {
  grade: { id: 'grade-1', code: 'G1', name: 'HDPE F46003', manufacturer: 'RIL' },
  available: true,
  message: null,
  canRequest: false,
  items: [
    {
      id: 'tds-1',
      type: 'TDS',
      title: 'PE F46003 – RIL',
      manufacturer: 'RIL',
      downloadRequiresAuth: true,
    },
  ],
};

function setup() {
  const prisma = {
    grade: { findFirst: vi.fn() },
    product: { findMany: vi.fn() },
    document: { findMany: vi.fn() },
  };
  const customerContext = {
    getOrCreateCustomer: vi.fn(async () => ({ customerProfileId: 'c1' })),
  };
  const productDocuments = {
    mapCustomerDoc: vi.fn(),
  };
  const gradeTds = {
    listForGrade: vi.fn(async () => gradePayload),
  };
  const service = new ProductsService(
    prisma as unknown as PrismaService,
    customerContext as unknown as CustomerContextService,
    productDocuments as unknown as ProductDocumentsQueryService,
    gradeTds as unknown as GradeTdsService,
  );
  return { service, prisma, gradeTds };
}

describe('listGradeTdsDocuments', () => {
  it('delegates to grade TDS library (independent of buyable offers)', async () => {
    const { service, prisma, gradeTds } = setup();
    const result = await service.listGradeTdsDocuments(null, 'grade-1');

    expect(gradeTds.listForGrade).toHaveBeenCalledWith('grade-1');
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(prisma.document.findMany).not.toHaveBeenCalled();
    expect(result.available).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.message).toBeNull();
  });

  it('returns unavailable + canRequest when library has no verified docs', async () => {
    const { service, gradeTds } = setup();
    gradeTds.listForGrade.mockResolvedValueOnce({
      grade: { id: 'grade-1', code: 'G1', name: 'PC 103', manufacturer: 'SABIC' },
      available: false,
      message: 'Technical Data Sheet is currently unavailable for this grade.',
      canRequest: true,
      items: [],
    });

    const result = await service.listGradeTdsDocuments(null, 'grade-1');
    expect(result.available).toBe(false);
    expect(result.canRequest).toBe(true);
    expect(result.message).toMatch(/unavailable/i);
  });

  it('propagates not found from grade library', async () => {
    const { service, gradeTds } = setup();
    gradeTds.listForGrade.mockRejectedValueOnce(
      new NotFoundException('Grade not found'),
    );
    await expect(
      service.listGradeTdsDocuments(null, 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
