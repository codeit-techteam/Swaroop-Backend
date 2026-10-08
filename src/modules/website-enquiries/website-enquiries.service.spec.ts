import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mapApplicationDetails } from '../admin/credit/admin-credit.mapper.js';
import type { CreateWebsiteEnquiryDto } from './website-enquiries.dto.js';
import {
  ENQUIRIES_PER_IP_PER_HOUR,
  WebsiteEnquiriesService,
} from './website-enquiries.service.js';

const dto: CreateWebsiteEnquiryDto = {
  name: 'Asha Rao',
  company: 'Rao Polymers',
  email: 'Asha@Example.com',
  phone: '+919876543210',
  topic: 'BUY_MATERIALS',
  message: 'Looking for 20 MT of HDPE blow moulding grade monthly.',
  pagePath: '/contact',
};

function setup(recentCount = 0) {
  const create = vi.fn().mockImplementation(({ data }) =>
    Promise.resolve({
      ...data,
      id: 'enq-1',
      createdAt: new Date('2026-10-08T10:00:00Z'),
    }),
  );
  const prisma = {
    websiteEnquiry: {
      count: vi.fn().mockResolvedValue(recentCount),
      create,
    },
    userRole: {
      findMany: vi.fn().mockResolvedValue([{ userId: 'admin-1' }]),
    },
  };
  const notifications = { create: vi.fn().mockResolvedValue({}) };
  const audit = { log: vi.fn() };
  const service = new WebsiteEnquiriesService(
    prisma as never,
    notifications as never,
    audit as never,
  );
  return { service, prisma, notifications, create };
}

describe('WebsiteEnquiriesService.create', () => {
  it('stores the enquiry, notifies the team and returns only the reference', async () => {
    const { service, create, notifications } = setup();
    const result = await service.create(dto, { ipAddress: '203.0.113.5' });

    expect(result.referenceNumber).toMatch(/^ENQ-\d{4}-\d{6}$/);
    expect(Object.keys(result).sort()).toEqual([
      'createdAt',
      'referenceNumber',
    ]);
    expect(create.mock.calls[0][0].data).toMatchObject({
      email: 'asha@example.com',
      topic: 'BUY_MATERIALS',
      pagePath: '/contact',
      ipAddress: '203.0.113.5',
    });
    expect(notifications.create).toHaveBeenCalledOnce();
  });

  it('silently drops honeypot submissions', async () => {
    const { service, create, notifications } = setup();
    const result = await service.create(
      { ...dto, website: 'spam.example' },
      {},
    );
    expect(result.referenceNumber).toMatch(/^ENQ-/);
    expect(create).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('rate-limits repeated submissions from one IP', async () => {
    const { service, create } = setup(ENQUIRIES_PER_IP_PER_HOUR);
    await expect(
      service.create(dto, { ipAddress: '203.0.113.5' }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(create).not.toHaveBeenCalled();
  });

  it('still succeeds when admin notification fails', async () => {
    const { service, notifications } = setup();
    notifications.create.mockRejectedValue(new Error('down'));
    await expect(service.create(dto, {})).resolves.toHaveProperty(
      'referenceNumber',
    );
  });
});

describe('mapApplicationDetails', () => {
  it('returns null for metadata without applicant details', () => {
    expect(mapApplicationDetails(null)).toBeNull();
    expect(mapApplicationDetails({ monthlyPurchase: 1 })).toBeNull();
  });

  it('keeps only whitelisted applicant fields', () => {
    const details = mapApplicationDetails({
      source: 'WEBSITE',
      applicant: {
        companyName: 'Rao Polymers',
        pan: 'ABCDE1234F',
        city: 'Pune',
      },
      requirement: {
        monthlyProcurement: 500000,
        existingCreditFacility: false,
      },
      declarations: { accepted: true, acceptedAt: '2026-10-08T10:00:00Z' },
      internal: { secret: 'x' },
    });
    // Source comes from the server-resolved column, never client metadata.
    expect(details).not.toHaveProperty('source');
    expect(details?.applicant).not.toHaveProperty('pan');
    expect(details?.applicant?.companyName).toBe('Rao Polymers');
    expect(details?.requirement?.monthlyProcurement).toBe(500000);
    expect(details?.declarations?.accepted).toBe(true);
    expect(details).not.toHaveProperty('internal');
  });
});
