import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setFcmRuntimeStatus } from './fcm-status.js';

vi.mock('firebase-admin/app', () => ({
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(() => ({ name: 'test-app' })),
  cert: vi.fn((value: unknown) => value),
}));

vi.mock('firebase-admin/messaging', () => ({
  getMessaging: vi.fn(() => ({
    sendEach: vi.fn().mockResolvedValue({ responses: [] }),
  })),
}));

import { cert, initializeApp } from 'firebase-admin/app';
import { FirebaseMessagingService } from './firebase-messaging.service.js';

const configFor = (values: Record<string, unknown>) => ({
  get: (key: string) => values[key],
});

describe('FirebaseMessagingService', () => {
  afterEach(() => {
    setFcmRuntimeStatus('disabled');
    vi.clearAllMocks();
  });

  it('stays disabled when the project id or credential is missing', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = new FirebaseMessagingService(
      configFor({
        'fcm.enabled': true,
        'fcm.projectId': '',
        'fcm.serviceAccountJson': '',
        'fcm.credentialsPath': '',
      }) as never,
    );
    service.onModuleInit();
    expect(service.isReady()).toBe(false);
    expect(initializeApp).not.toHaveBeenCalled();
    expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).toMatch(/In-app/);
  });

  it('rejects a service account from another project and does not log the key', () => {
    const secret = '-----BEGIN PRIVATE KEY-----\nDO_NOT_LOG\n-----END PRIVATE KEY-----\n';
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = new FirebaseMessagingService(
      configFor({
        'fcm.enabled': true,
        'fcm.projectId': 'polystorex-7b42a',
        'fcm.credentialsPath': '',
        'fcm.serviceAccountJson': JSON.stringify({
          project_id: 'other-project',
          client_email: 'fcm@example.com',
          private_key: secret,
        }),
      }) as never,
    );
    service.onModuleInit();
    expect(service.isReady()).toBe(false);
    expect(initializeApp).not.toHaveBeenCalled();
    const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).not.toContain('DO_NOT_LOG');
    expect(logged).not.toContain('PRIVATE KEY');
    expect(logged).toMatch(/different Firebase project/);
  });

  it('initializes messaging for the PolyStoreX project', () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const service = new FirebaseMessagingService(
      configFor({
        'fcm.enabled': true,
        'fcm.projectId': 'polystorex-7b42a',
        'fcm.credentialsPath': '',
        'fcm.serviceAccountJson': JSON.stringify({
          project_id: 'polystorex-7b42a',
          client_email: 'fcm@polystorex-7b42a.iam.gserviceaccount.com',
          private_key: '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n',
        }),
      }) as never,
    );
    service.onModuleInit();
    expect(service.isReady()).toBe(true);
    expect(cert).toHaveBeenCalledOnce();
    expect(initializeApp).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'polystorex-7b42a' }),
      'polystorex-fcm',
    );
  });
});
