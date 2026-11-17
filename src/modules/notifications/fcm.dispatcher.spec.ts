import { describe, expect, it, vi } from 'vitest';
import { FcmDispatcher } from './fcm.dispatcher.js';

const TOKEN = 'f'.repeat(80);

describe('FcmDispatcher', () => {
  const source = {
    id: 'note-1',
    userId: 'user-a',
    title: 'Order created',
    body: 'PO-1 was created',
    entityType: 'ORDER',
    entityId: 'order-1',
    metadata: { eventKey: 'ORDER_CREATED' },
  };

  it('keeps going when Firebase Admin is not ready', async () => {
    const tokens = { listActive: vi.fn() };
    const messaging = { isReady: () => false, sendEach: vi.fn() };
    const dispatcher = new FcmDispatcher(tokens as never, messaging as never);
    await dispatcher.dispatch(source);
    expect(tokens.listActive).not.toHaveBeenCalled();
    expect(messaging.sendEach).not.toHaveBeenCalled();
  });

  it('sends once per device and revokes an unregistered token', async () => {
    const tokens = {
      listActive: vi.fn().mockResolvedValue([
        { id: 'device-1', token: TOKEN },
        { id: 'device-2', token: `${'a'.repeat(40)}:${'b'.repeat(40)}` },
      ]),
      excludeDelivered: vi.fn(async (_id: string, devices: { id: string }[]) => devices),
      recordDelivered: vi.fn().mockResolvedValue(undefined),
      revokeUnregistered: vi.fn().mockResolvedValue(undefined),
    };
    const messaging = {
      isReady: () => true,
      sendEach: vi.fn().mockResolvedValue([
        { success: false, errorCode: 'messaging/registration-token-not-registered' },
        { success: true },
      ]),
    };
    const dispatcher = new FcmDispatcher(tokens as never, messaging as never);
    await dispatcher.dispatch(source);

    expect(messaging.sendEach).toHaveBeenCalledOnce();
    const sent = messaging.sendEach.mock.calls[0]?.[0] as Array<{ token: string; data: Record<string, string> }>;
    expect(sent).toHaveLength(2);
    expect(sent[0]?.data.event).toBe('ORDER_CREATED');
    expect(JSON.stringify(sent)).not.toContain('PRIVATE KEY');
    expect(tokens.revokeUnregistered).toHaveBeenCalledWith(TOKEN);
    expect(tokens.recordDelivered).toHaveBeenCalledWith('note-1', ['device-2']);
  });

  it('does not send a device that already received this notification', async () => {
    const tokens = {
      listActive: vi.fn().mockResolvedValue([{ id: 'device-1', token: TOKEN }]),
      excludeDelivered: vi.fn().mockResolvedValue([]),
      recordDelivered: vi.fn(),
      revokeUnregistered: vi.fn(),
    };
    const messaging = { isReady: () => true, sendEach: vi.fn() };
    const dispatcher = new FcmDispatcher(tokens as never, messaging as never);
    await dispatcher.dispatch(source);
    expect(messaging.sendEach).not.toHaveBeenCalled();
  });
});
