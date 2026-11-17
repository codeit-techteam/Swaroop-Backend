import { describe, expect, it, vi } from 'vitest';
import { NotificationService, resolveDisplayReference } from './notification.service.js';

describe('resolveDisplayReference', () => {
  it('returns human-readable business references', () => {
    expect(
      resolveDisplayReference({ referenceNumber: 'PO-2026-000123' }),
    ).toBe('PO-2026-000123');
    expect(resolveDisplayReference({ ticketNumber: 'TKT-42' })).toBe('TKT-42');
    expect(
      resolveDisplayReference({ applicationNumber: 'CR-APP-9' }),
    ).toBe('CR-APP-9');
  });

  it('never returns raw UUIDs', () => {
    expect(
      resolveDisplayReference({
        reference: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
      }),
    ).toBeNull();
    expect(
      resolveDisplayReference({
        entityId: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
      }),
    ).toBeNull();
  });

  it('lists notifications only for the requested user', async () => {
    const prisma = {
      notification: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    };
    const service = new NotificationService(prisma as never);
    await service.listForUser('user-a', { page: 1, limit: 20 });
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-a' }),
      }),
    );
    expect(prisma.notification.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-a' }),
      }),
    );
  });

  it('still stores the in-app row when push dispatch throws', async () => {
    const created = {
      id: 'n1',
      userId: 'user-a',
      title: 'Order update',
      body: 'PO-1',
      entityType: 'PURCHASE_REQUEST',
      entityId: 'entity-1',
      metadata: {},
    };
    const prisma = {
      notification: {
        create: vi.fn().mockResolvedValue(created),
      },
    };
    const push = {
      dispatch: vi.fn().mockRejectedValue(new Error('fcm down')),
    };
    const service = new NotificationService(prisma as never, push as never);
    await expect(
      service.create({
        userId: 'user-a',
        title: 'Order update',
        body: 'PO-1',
      }),
    ).resolves.toEqual(created);
    expect(push.dispatch).toHaveBeenCalledOnce();
  });

  it('prefers displayReference over other keys', () => {
    expect(
      resolveDisplayReference({
        displayReference: 'INV-100',
        referenceNumber: 'PO-200',
      }),
    ).toBe('INV-100');
  });
});
