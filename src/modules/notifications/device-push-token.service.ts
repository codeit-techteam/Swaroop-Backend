import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import {
  isFcmRegistrationToken,
  isInstallationId,
  isRevocableDeviceToken,
} from './fcm-token.js';

const APP_ID = 'com.polystorex.app';

export type DeviceTokenRecord = {
  id: string;
  token: string;
};

export type RegisterDevicePushTokenInput = {
  token: string;
  platform: 'android';
  installationId: string;
  previousToken?: string;
};

@Injectable()
export class DevicePushTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async register(userId: string, input: RegisterDevicePushTokenInput) {
    if (!isFcmRegistrationToken(input.token)) {
      throw new BadRequestException('Expected an FCM device token');
    }
    if (input.platform !== 'android') {
      throw new BadRequestException('FCM registration is available for Android devices');
    }
    if (!isInstallationId(input.installationId)) {
      throw new BadRequestException('Expected an installation id');
    }

    const now = new Date();
    const previous =
      input.previousToken &&
      input.previousToken !== input.token &&
      isRevocableDeviceToken(input.previousToken)
        ? input.previousToken
        : null;

    return this.prisma.$transaction(async (tx) => {
      if (previous) {
        await tx.devicePushToken.updateMany({
          where: { userId, token: previous, revokedAt: null },
          data: { revokedAt: now },
        });
      }

      await tx.devicePushToken.updateMany({
        where: {
          installationId: input.installationId,
          revokedAt: null,
          token: { not: input.token },
        },
        data: { revokedAt: now },
      });

      return tx.devicePushToken.upsert({
        where: { token: input.token },
        create: {
          userId,
          token: input.token,
          platform: 'android',
          provider: 'fcm',
          appId: APP_ID,
          installationId: input.installationId,
          lastSeenAt: now,
        },
        update: {
          userId,
          platform: 'android',
          provider: 'fcm',
          appId: APP_ID,
          installationId: input.installationId,
          revokedAt: null,
          lastSeenAt: now,
        },
        select: { id: true, platform: true, appId: true },
      });
    });
  }

  async revoke(userId: string, token: string) {
    if (!isRevocableDeviceToken(token)) {
      throw new BadRequestException('Expected an FCM device token');
    }
    const result = await this.prisma.devicePushToken.updateMany({
      where: { userId, token, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: result.count };
  }

  /** Drops a token FCM has reported as unregistered, whichever user it belonged to. */
  async revokeUnregistered(token: string) {
    await this.prisma.devicePushToken.updateMany({
      where: { token, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  listActive(userId: string): Promise<DeviceTokenRecord[]> {
    return this.prisma.devicePushToken.findMany({
      where: { userId, revokedAt: null, provider: 'fcm' },
      select: { id: true, token: true },
    });
  }

  async excludeDelivered(
    notificationId: string,
    devices: DeviceTokenRecord[],
  ): Promise<DeviceTokenRecord[]> {
    if (devices.length === 0) return [];
    const sent = await this.prisma.pushDelivery.findMany({
      where: {
        notificationId,
        tokenId: { in: devices.map((device) => device.id) },
      },
      select: { tokenId: true },
    });
    const done = new Set(sent.map((row) => row.tokenId));
    return devices.filter((device) => !done.has(device.id));
  }

  async recordDelivered(notificationId: string, tokenIds: string[]): Promise<void> {
    if (tokenIds.length === 0) return;
    await this.prisma.pushDelivery.createMany({
      data: tokenIds.map((tokenId) => ({ notificationId, tokenId })),
      skipDuplicates: true,
    });
  }
}
