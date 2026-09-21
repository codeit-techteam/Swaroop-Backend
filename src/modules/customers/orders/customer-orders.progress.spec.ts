import { describe, expect, it } from 'vitest';
import {
  DispatchStatus,
  PaymentMethod,
  PaymentStatus,
  PurchaseOrderStatus,
  ShipmentStatus,
} from '../../../generated/prisma/client.js';
import {
  getOrderProgress,
  paymentOptionLabel,
} from './customer-orders.progress.js';

describe('getOrderProgress', () => {
  it('maps confirmed PO to procurement stage', () => {
    const result = getOrderProgress({
      poStatus: PurchaseOrderStatus.CONFIRMED,
      procurementStatus: 'CONVERTED_TO_PO',
    });
    expect(result.stage).toBe('PROCUREMENT');
    expect(result.percentage).toBe(25);
    expect(result.presentationBucket).toBe('ACTIVE');
    expect(result.customerStatus).toBe('PROCUREMENT');
  });

  it('maps verified payment to payment stage', () => {
    const result = getOrderProgress({
      poStatus: PurchaseOrderStatus.CONFIRMED,
      paymentStatus: PaymentStatus.VERIFIED,
      paymentMethod: PaymentMethod.ADVANCE,
    });
    expect(result.stage).toBe('PAYMENT');
    expect(result.percentage).toBe(60);
  });

  it('maps ready-for-dispatch to dispatch stage when payment cleared', () => {
    const result = getOrderProgress({
      poStatus: PurchaseOrderStatus.READY_FOR_DISPATCH,
      paymentStatus: PaymentStatus.VERIFIED,
      paymentMethod: PaymentMethod.ON_LOADING,
      dispatchStatus: DispatchStatus.READY_FOR_DISPATCH,
    });
    expect(result.stage).toBe('DISPATCH');
    expect(result.percentage).toBe(75);
    expect(result.customerStatus).toBe('READY_FOR_DISPATCH');
  });

  it('treats PetroTrade credit approval as clearance without marking paid', () => {
    const result = getOrderProgress({
      poStatus: PurchaseOrderStatus.CONFIRMED,
      paymentMethod: PaymentMethod.CREDIT_15,
      creditStatus: 'CREDIT_APPROVED',
      paymentStatus: PaymentStatus.PENDING,
    });
    expect(result.stage).toBe('PAYMENT');
    expect(result.percentage).toBe(60);
  });

  it('maps delivered PO to 100% delivery', () => {
    const result = getOrderProgress({
      poStatus: PurchaseOrderStatus.DELIVERED,
      shipmentStatus: ShipmentStatus.DELIVERED,
    });
    expect(result.stage).toBe('DELIVERY');
    expect(result.percentage).toBe(100);
    expect(result.presentationBucket).toBe('COMPLETED');
  });

  it('maps cancelled PO to cancelled bucket', () => {
    const result = getOrderProgress({
      poStatus: PurchaseOrderStatus.CANCELLED,
    });
    expect(result.presentationBucket).toBe('CANCELLED');
    expect(result.percentage).toBe(0);
  });
});

describe('paymentOptionLabel', () => {
  it('labels ON_LOADING for customer UI', () => {
    expect(paymentOptionLabel(PaymentMethod.ON_LOADING)).toBe(
      'ON LOADING PAYMENT',
    );
  });

  it('labels CREDIT as PetroTrade credit', () => {
    expect(paymentOptionLabel(PaymentMethod.CREDIT)).toBe('PETROTRADE CREDIT');
  });
});
