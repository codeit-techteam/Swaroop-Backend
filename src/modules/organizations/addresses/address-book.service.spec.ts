import { describe, expect, it, vi } from 'vitest';
import { AddressType, Prisma } from '../../../generated/prisma/client.js';
import type { PrismaService } from '../../../database/prisma.service.js';
import { buildAddressSnapshot } from './address-book.mapper.js';
import { AddressBookService } from './address-book.service.js';

const baseDto = {
  line1: '12 Park Street',
  city: 'Kolkata',
  state: 'West Bengal',
  postalCode: '700016',
};

function makePrisma(existing: unknown[] = []) {
  const tx = {
    address: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockImplementation(({ data }) => ({
        id: 'addr-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...data,
      })),
    },
  };
  const prisma = {
    address: {
      findMany: vi.fn().mockResolvedValue(existing),
      findFirst: vi.fn(),
    },
    $transaction: vi.fn().mockImplementation((fn) => fn(tx)),
  };
  return { prisma: prisma as unknown as PrismaService, tx };
}

describe('AddressBookService validation', () => {
  it('rejects half-specified coordinates', async () => {
    const { prisma } = makePrisma();
    const service = new AddressBookService(prisma);
    await expect(
      service.create('org-1', { ...baseDto, latitude: 22.5 }),
    ).rejects.toMatchObject({ code: 'INVALID_COORDINATES' });
  });

  it('rejects coordinates outside India for Indian addresses', async () => {
    const { prisma } = makePrisma();
    const service = new AddressBookService(prisma);
    await expect(
      service.create('org-1', { ...baseDto, latitude: 51.5, longitude: -0.12 }),
    ).rejects.toMatchObject({ code: 'COORDINATES_OUTSIDE_REGION' });
  });

  it('requires coordinates for geo-resolved sources', async () => {
    const { prisma } = makePrisma();
    const service = new AddressBookService(prisma);
    await expect(
      service.create('org-1', { ...baseDto, source: 'AUTOCOMPLETE' }),
    ).rejects.toMatchObject({ code: 'ADDRESS_INCOMPLETE' });
  });

  it('persists normalized geo fields and makes the first address default', async () => {
    const { prisma, tx } = makePrisma();
    const service = new AddressBookService(prisma);
    const created = await service.create('org-1', {
      ...baseDto,
      country: 'India',
      latitude: 22.55,
      longitude: 88.35,
      placeId: 'ChIJplace000001',
      formattedAddress: '12 Park St, Kolkata 700016',
      locality: 'Park Circus',
      district: 'Kolkata',
      accuracyMeters: 18,
      source: 'AUTOCOMPLETE',
    });
    const data = tx.address.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      organizationId: 'org-1',
      country: 'IN',
      placeId: 'ChIJplace000001',
      source: 'AUTOCOMPLETE',
      isDefault: true,
    });
    expect(created.placeId).toBe('ChIJplace000001');
    expect(created.latitude).toBe(22.55);
  });
});

describe('buildAddressSnapshot', () => {
  it('produces an immutable copy with a formatted fallback', () => {
    const snapshot = buildAddressSnapshot(
      {
        id: 'addr-1',
        organizationId: 'org-1',
        type: AddressType.SHIPPING,
        label: 'Warehouse',
        line1: 'Plot 4',
        line2: null,
        city: 'Howrah',
        state: 'West Bengal',
        country: 'IN',
        postalCode: '711101',
        landmark: 'Near GT Road',
        locality: null,
        district: null,
        latitude: new Prisma.Decimal('22.5958'),
        longitude: new Prisma.Decimal('88.2636'),
        placeId: null,
        formattedAddress: null,
        accuracyMeters: null,
        source: 'MANUAL',
        isDefault: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
      new Date('2026-09-28T00:00:00.000Z'),
    );
    expect(snapshot).toMatchObject({
      addressId: 'addr-1',
      latitude: 22.5958,
      formattedAddress: 'Plot 4, Near GT Road, Howrah, West Bengal, 711101',
      capturedAt: '2026-09-28T00:00:00.000Z',
    });
  });
});
