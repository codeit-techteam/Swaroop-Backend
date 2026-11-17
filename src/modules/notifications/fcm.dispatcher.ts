import { Injectable, Logger } from '@nestjs/common';
import { DevicePushTokenService } from './device-push-token.service.js';
import { buildFcmContent } from './fcm-payload.js';
import {
  FirebaseMessagingService,
  type FcmOutbound,
} from './firebase-messaging.service.js';

export type PushNotificationSource = {
  id: string;
  userId: string | null;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
};

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

const safeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : 'FCM request failed';
  return message.replace(/[A-Za-z0-9_:-]{20,}/g, '[redacted]').slice(0, 240);
};

@Injectable()
export class FcmDispatcher {
  private readonly logger = new Logger(FcmDispatcher.name);
  private warnedUnavailable = false;

  constructor(
    private readonly tokens: DevicePushTokenService,
    private readonly messaging: FirebaseMessagingService,
  ) {}

  async dispatch(row: PushNotificationSource): Promise<void> {
    if (!row.userId) return;
    if (!this.messaging.isReady()) {
      if (!this.warnedUnavailable) {
        this.warnedUnavailable = true;
        this.logger.warn(
          'FCM skipped: Firebase Admin is not ready. In-app notifications remain available.',
        );
      }
      return;
    }

    const devices = await this.tokens.listActive(row.userId);
    const pending = await this.tokens.excludeDelivered(row.id, devices);
    if (pending.length === 0) return;

    const content = buildFcmContent(row);
    const messages: FcmOutbound[] = pending.map((device) => ({
      token: device.token,
      title: content.title,
      body: content.body,
      data: content.data,
      collapseKey: content.collapseKey,
    }));

    try {
      const results = await this.messaging.sendEach(messages);
      const delivered: string[] = [];
      await Promise.all(
        results.map(async (result, index) => {
          const device = pending[index];
          if (!device) return;
          if (result.success) {
            delivered.push(device.id);
            return;
          }
          if (result.errorCode && INVALID_TOKEN_CODES.has(result.errorCode)) {
            await this.tokens.revokeUnregistered(device.token);
            this.logger.warn(
              `Revoked unregistered FCM token for user ${row.userId}`,
            );
          }
        }),
      );
      await this.tokens.recordDelivered(row.id, delivered);
    } catch (error) {
      this.logger.warn(
        `FCM send failed for notification ${row.id}: ${safeError(error)}`,
      );
    }
  }
}
