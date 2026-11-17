import { readFileSync } from 'node:fs';

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging, type Message } from 'firebase-admin/messaging';

import { setFcmRuntimeStatus } from './fcm-status.js';

export const FCM_PROJECT_ID = 'polystorex-7b42a';

export type FcmOutbound = {
  token: string;
  title: string;
  body: string;
  data: Record<string, string>;
  collapseKey: string;
};

export type FcmSendResult = {
  success: boolean;
  errorCode?: string;
};

const APP_NAME = 'polystorex-fcm';

type ServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

const safeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : 'FCM request failed';
  return message.replace(/[A-Za-z0-9_:-]{20,}/g, '[redacted]').slice(0, 240);
};

const asServiceAccount = (raw: string): ServiceAccount | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const row = parsed as Record<string, unknown>;
  const projectId = typeof row.project_id === 'string' ? row.project_id.trim() : '';
  const clientEmail = typeof row.client_email === 'string' ? row.client_email.trim() : '';
  const privateKey = typeof row.private_key === 'string' ? row.private_key : '';
  if (!projectId || !clientEmail || !privateKey.includes('PRIVATE KEY')) return null;
  return {
    projectId,
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, '\n'),
  };
};

@Injectable()
export class FirebaseMessagingService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseMessagingService.name);
  private app: App | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    setFcmRuntimeStatus('disabled');
    this.app = null;
    if (this.config.get<boolean>('fcm.enabled') === false) {
      this.logger.warn(
        'FCM disabled by FCM_ENABLED. In-app notifications remain available.',
      );
      return;
    }

    const projectId = this.config.get<string>('fcm.projectId')?.trim() ?? '';
    if (projectId !== FCM_PROJECT_ID) {
      this.logger.warn(
        'FCM disabled: FIREBASE_PROJECT_ID must be polystorex-7b42a. In-app notifications remain available.',
      );
      return;
    }

    const account = this.loadAccount();
    if (!account) return;
    if (account.projectId !== FCM_PROJECT_ID) {
      this.logger.warn(
        'FCM disabled: service account belongs to a different Firebase project. In-app notifications remain available.',
      );
      return;
    }

    try {
      const existing = getApps().find((app) => app.name === APP_NAME);
      this.app =
        existing ??
        initializeApp(
          {
            credential: cert({
              projectId: account.projectId,
              clientEmail: account.clientEmail,
              privateKey: account.privateKey,
            }),
            projectId: FCM_PROJECT_ID,
          },
          APP_NAME,
        );
      getMessaging(this.app);
      setFcmRuntimeStatus('ready');
      this.logger.log('FCM ready for project polystorex-7b42a');
    } catch (error) {
      this.app = null;
      setFcmRuntimeStatus('disabled');
      this.logger.warn(`FCM disabled: Firebase Admin could not start (${safeError(error)})`);
    }
  }

  isReady(): boolean {
    return this.app !== null;
  }

  async sendEach(messages: FcmOutbound[]): Promise<FcmSendResult[]> {
    if (!this.app || messages.length === 0) return [];
    const messaging = getMessaging(this.app);
    const results: FcmSendResult[] = [];
    for (let offset = 0; offset < messages.length; offset += 500) {
      const chunk = messages.slice(offset, offset + 500).map(
        (message): Message => ({
          token: message.token,
          notification: { title: message.title, body: message.body },
          data: message.data,
          android: {
            priority: 'high',
            collapseKey: message.collapseKey || undefined,
            ttl: 3_600_000,
            notification: {
              channelId: 'default',
              sound: 'default',
              priority: 'high',
              defaultSound: true,
            },
          },
        }),
      );
      const response = await messaging.sendEach(chunk);
      results.push(
        ...response.responses.map((row) => ({
          success: row.success,
          errorCode: row.success ? undefined : row.error?.code,
        })),
      );
    }
    return results;
  }

  private loadAccount(): ServiceAccount | null {
    const json = this.config.get<string>('fcm.serviceAccountJson')?.trim() ?? '';
    if (json) {
      const account = asServiceAccount(json);
      if (!account) {
        this.logger.warn(
          'FCM disabled: FIREBASE_SERVICE_ACCOUNT_JSON could not be read. In-app notifications remain available.',
        );
      }
      return account;
    }

    const path = this.config.get<string>('fcm.credentialsPath')?.trim() ?? '';
    if (!path) {
      this.logger.warn(
        'FCM disabled: set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON to a rotated polystorex-7b42a key. In-app notifications remain available.',
      );
      return null;
    }
    try {
      return asServiceAccount(readFileSync(path, 'utf8'));
    } catch {
      this.logger.warn(
        'FCM disabled: Firebase credential file could not be read. In-app notifications remain available.',
      );
      return null;
    }
  }
}
