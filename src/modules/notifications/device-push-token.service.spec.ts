import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DevicePushTokenService } from './device-push-token.service.js';

const TOKEN_A = 'a'.repeat(40);
const TOKEN_B = `${'b'.repeat(20)}:${'c'.repeat(20)}`;
const INSTALL_A = 'install-android-1';
const INSTALL_B = 'install-android-2';

const prismaFor = () => {
  const devicePushToken = {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    upsert: vi.fn().mockResolvedValue({
      id: 'row-1',
      platform: 'android',
      appId: 'com.polystorex.app',
    }),
    findMany: vi.fn().mockResolvedValue([]),
  };
  const pushDelivery = {
    findMany: vi.fn().mockResolvedValue([]),
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const prisma = {
    devicePushToken,
    pushDelivery,
    $transaction: vi.fn(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)),
  };
  return prisma;
};

describe('DevicePushTokenService', () => {
  it('registers an FCM token and revokes the previous token for this user only', async () => {
    const prisma = prismaFor();
    const service = new DevicePushTokenService(prisma as never);
    const row = await service.register('user-b', {
      token: TOKEN_B,
      platform: 'android',
      installationId: INSTALL_A,
      previousToken: TOKEN_A,
    });

    expect(prisma.devicePushToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-b', token: TOKEN_A }),
      }),
    );
    expect(prisma.devicePushToken.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { token: TOKEN_B },
        create: expect.objectContaining({
          userId: 'user-b',
          provider: 'fcm',
          installationId: INSTALL_A,
          appId: 'com.polystorex.app',
        }),
        update: expect.objectContaining({
          userId: 'user-b',
          revokedAt: null,
          provider: 'fcm',
        }),
      }),
    );
    expect(row.appId).toBe('com.polystorex.app');
  });

  it('keeps another installation active and reassigns this device token', async () => {
    const prisma = prismaFor();
    const service = new DevicePushTokenService(prisma as never);
    await service.register('user-b', {
      token: TOKEN_B,
      platform: 'android',
      installationId: INSTALL_B,
    });

    expect(prisma.devicePushToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          installationId: INSTALL_B,
          token: { not: TOKEN_B },
        }),
      }),
    );
    expect(prisma.devicePushToken.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ userId: 'user-b' }),
      }),
    );
  });

  it('rejects an Expo push token', async () => {
    const service = new DevicePushTokenService({} as never);
    await expect(
      service.register('user-a', {
        token: 'ExponentPushToken[deviceA]',
        platform: 'android',
        installationId: INSTALL_A,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('revokes only the signed-in user token', async () => {
    const prisma = prismaFor();
    const service = new DevicePushTokenService(prisma as never);
    await expect(service.revoke('user-a', TOKEN_A)).resolves.toEqual({
      revoked: 1,
    });
    expect(prisma.devicePushToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-a', token: TOKEN_A }),
      }),
    );
  });

  it('does not send a token that already has a delivery row', async () => {
    const prisma = prismaFor();
    prisma.pushDelivery.findMany.mockResolvedValue([{ tokenId: 'device-1' }]);
    const service = new DevicePushTokenService(prisma as never);
    const pending = await service.excludeDelivered('note-1', [
      { id: 'device-1', token: TOKEN_A },
      { id: 'device-2', token: TOKEN_B },
    ]);
    expect(pending).toEqual([{ id: 'device-2', token: TOKEN_B }]);
  });
});
