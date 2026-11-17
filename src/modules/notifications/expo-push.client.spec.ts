import { describe, expect, it, vi } from 'vitest';
import {
  fetchExpoPushReceipts,
  isExpoPushToken,
  sendExpoPush,
  tokensForUnregisteredReceipts,
} from './expo-push.client.js';

describe('isExpoPushToken', () => {
  it('accepts Expo push tokens only', () => {
    expect(isExpoPushToken('ExponentPushToken[abc_DEF-123]')).toBe(true);
    expect(isExpoPushToken('ExpoPushToken[abc]')).toBe(true);
    expect(isExpoPushToken('fcm-device-token')).toBe(false);
    expect(isExpoPushToken('')).toBe(false);
  });
});

describe('sendExpoPush', () => {
  it('posts Expo tokens and returns tickets', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ status: 'ok', id: 'ticket-1' }],
      }),
    });

    const tickets = await sendExpoPush(
      [
        {
          to: 'ExponentPushToken[abc]',
          title: 'Order update',
          body: 'PO-1 is confirmed',
          data: { notificationId: 'n1', entityType: 'PURCHASE_REQUEST' },
          sound: 'default',
          priority: 'high',
          channelId: 'default',
        },
      ],
      { accessToken: 'expo-token', fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(tickets).toEqual([{ status: 'ok', id: 'ticket-1' }]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer expo-token',
    });
    const body = JSON.parse(String(init.body)) as Array<{ to: string }>;
    expect(body[0]?.to).toBe('ExponentPushToken[abc]');
  });

  it('revokes only tokens whose receipt says the device is gone', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          'ticket-1': {
            status: 'error',
            details: { error: 'DeviceNotRegistered' },
          },
          'ticket-2': { status: 'ok' },
        },
      }),
    });
    const receipts = await fetchExpoPushReceipts(['ticket-1', 'ticket-2'], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const tokens = tokensForUnregisteredReceipts(
      receipts,
      new Map([
        ['ticket-1', 'ExponentPushToken[gone]'],
        ['ticket-2', 'ExponentPushToken[ok]'],
      ]),
    );
    expect(tokens).toEqual(['ExponentPushToken[gone]']);
  });

  it('does not call Expo when there is nothing to send', async () => {
    const fetchImpl = vi.fn();
    await expect(
      sendExpoPush([], { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
