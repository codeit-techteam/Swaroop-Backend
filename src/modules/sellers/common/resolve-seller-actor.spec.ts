import { describe, expect, it, vi } from 'vitest';
import { resolveSellerActor } from './resolve-seller-actor.js';

describe('resolveSellerActor', () => {
  const sellerA = {
    id: 'seller-a',
    userId: 'owner-a',
    deletedAt: null,
    organizationId: 'org-a',
    organization: { name: 'ABC Petrochemicals' },
  };

  it('uses the owned seller profile and ignores any other seller', async () => {
    const prisma = {
      sellerProfile: {
        findFirst: vi.fn().mockResolvedValue(sellerA),
      },
      sellerManagerAssignment: { findFirst: vi.fn() },
    };
    const resolved = await resolveSellerActor(prisma as never, 'owner-a');
    expect(resolved?.kind).toBe('OWNER');
    expect(resolved?.profile.id).toBe('seller-a');
    expect(prisma.sellerManagerAssignment.findFirst).not.toHaveBeenCalled();
  });

  it('derives the assigned seller for a manager', async () => {
    const prisma = {
      sellerProfile: { findFirst: vi.fn().mockResolvedValue(null) },
      sellerManagerAssignment: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'asg-1',
          status: 'ACTIVE',
          sellerProfile: sellerA,
        }),
      },
    };
    const resolved = await resolveSellerActor(prisma as never, 'manager-1');
    expect(resolved?.kind).toBe('MANAGER');
    expect(resolved?.profile.id).toBe('seller-a');
    expect(prisma.sellerManagerAssignment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'manager-1', status: 'ACTIVE' },
      }),
    );
  });

  it('does not grant access from an inactive assignment', async () => {
    const prisma = {
      sellerProfile: { findFirst: vi.fn().mockResolvedValue(null) },
      sellerManagerAssignment: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    await expect(
      resolveSellerActor(prisma as never, 'manager-1'),
    ).resolves.toBeNull();
  });
});
