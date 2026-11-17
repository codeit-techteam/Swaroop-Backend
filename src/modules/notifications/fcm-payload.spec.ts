import { describe, expect, it } from 'vitest';
import {
  FCM_GENERIC_BODY,
  buildFcmContent,
} from './fcm-payload.js';

describe('buildFcmContent', () => {
  it('keeps order, purchase request, dispatch and grade event ids', () => {
    const order = buildFcmContent({
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Order confirmed',
      body: 'PO-2026-000123 is confirmed',
      entityType: 'ORDER',
      entityId: '22222222-2222-4222-8222-222222222222',
      metadata: { eventKey: 'ORDER_CONFIRMED', route: '/(customer)/(tabs)/orders' },
    });
    expect(order.data).toMatchObject({
      notificationId: '11111111-1111-4111-8111-111111111111',
      entityType: 'ORDER',
      event: 'ORDER_CONFIRMED',
      route: '/(customer)/(tabs)/orders',
    });

    const request = buildFcmContent({
      id: 'n-pr',
      title: 'Purchase request received',
      body: 'A buyer sent a request',
      entityType: 'PURCHASE_REQUEST',
      entityId: 'pr-1',
      metadata: { eventKey: 'PURCHASE_REQUEST_RECEIVED' },
    });
    expect(request.data.entityType).toBe('PURCHASE_REQUEST');

    const payment = buildFcmContent({
      id: 'n-pay',
      title: 'Payment verified',
      body: 'Payment for PO-10 was verified',
      entityType: 'PAYMENT',
      entityId: 'pay-1',
      metadata: {
        eventKey: 'PAYMENT_VERIFIED',
        utr: 'UTR998877',
        amount: '150000',
      },
    });
    expect(payment.data).not.toHaveProperty('utr');
    expect(payment.data).not.toHaveProperty('amount');
    expect(payment.body).not.toMatch(/150000/);

    const shipment = buildFcmContent({
      id: 'n-ship',
      title: 'Shipment status changed',
      body: 'Truck is in transit',
      entityType: 'SHIPMENT',
      entityId: 'ship-1',
      metadata: { eventKey: 'SHIPMENT_STATUS_CHANGED' },
    });
    expect(shipment.data.event).toBe('SHIPMENT_STATUS_CHANGED');

    const grade = buildFcmContent({
      id: 'n-grade',
      title: 'Grade request approved',
      body: 'Request GR-9 was approved',
      entityType: 'NEW_GRADE_REQUEST',
      entityId: 'grade-1',
      metadata: { eventKey: 'GRADE_REQUEST_APPROVED' },
    });
    expect(grade.data.entityType).toBe('NEW_GRADE_REQUEST');
  });

  it('drops external routes and sensitive payment or KYC text', () => {
    const content = buildFcmContent({
      id: 'n-kyc',
      title: 'PAN ABCDE1234F verified',
      body: 'UTR 123456789012 for account 123456789012 and user@example.com',
      entityType: 'PAYMENT',
      entityId: 'pay-2',
      metadata: { route: 'https://evil.example/phish' },
    });
    expect(content.title).toBe('PolyStoreX');
    expect(content.body).toBe(FCM_GENERIC_BODY);
    expect(content.data.route).toBeUndefined();
    expect(JSON.stringify(content.data)).not.toMatch(/ABCDE1234F|example.com/);
  });
});
