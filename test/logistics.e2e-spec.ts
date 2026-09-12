import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';

async function login(app: INestApplication, email: string) {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password: 'Test@12345' });
  expect(response.status).toBe(200);
  return response.body.data.accessToken as string;
}

describe('Logistics Phase 9 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customerToken: string;
  let sellerToken: string;
  let adminToken: string;
  let offerId: string;
  let warehouseId: string;
  let poOnDeliveryId: string;
  let dispatchId: string;
  let vehicleId: string;
  let shipmentId: string;
  let deliveryId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    customerToken = await login(app, 'customer@test.local');
    sellerToken = await login(app, 'seller@test.local');
    adminToken = await login(app, 'admin@test.local');

    const offers = await request(app.getHttpServer())
      .get('/api/v1/customer/offers')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(offers.status).toBe(200);
    expect(offers.body.data.length).toBeGreaterThan(0);
    offerId = offers.body.data[0].id;

    let warehouse = await prisma.warehouse.findFirst({
      where: { code: 'WH-MUM-HUB', deletedAt: null },
    });
    if (!warehouse) {
      warehouse = await prisma.warehouse.create({
        data: {
          code: `WH-E2E-${Date.now()}`,
          name: 'E2E Logistics Warehouse',
          city: 'Mumbai',
          state: 'Maharashtra',
          country: 'IN',
          isPlatformHub: true,
          isActive: true,
        },
      });
    }
    warehouseId = warehouse.id;
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  async function createPrAndAccept(paymentMethod: string, note: string) {
    await request(app.getHttpServer())
      .delete('/api/v1/customer/cart')
      .set('Authorization', `Bearer ${customerToken}`);

    const add = await request(app.getHttpServer())
      .post('/api/v1/customer/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ offerId, quantity: 20, paymentMethod });
    expect([200, 201]).toContain(add.status);

    const create = await request(app.getHttpServer())
      .post('/api/v1/customer/purchase-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        destinationRegion: 'West India',
        notes: note,
        idempotencyKey: `phase9-${note}-${Date.now()}`,
      });
    expect([200, 201]).toContain(create.status);
    const payload = create.body.data;
    const pr =
      payload.purchaseRequests?.[0] ??
      (Array.isArray(payload) ? payload[0] : payload);
    expect(pr?.id).toBeTruthy();

    const accept = await request(app.getHttpServer())
      .post(`/api/v1/seller/purchase-requests/${pr.id}/accept`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ message: `Accepted ${note}` });
    if (accept.status !== 200) {
      console.error('seller accept failed', accept.status, accept.body);
    }
    expect(accept.status).toBe(200);
    const poId = accept.body.data.purchaseOrder?.id as string;
    expect(poId).toBeTruthy();
    return { prId: pr.id as string, poId };
  }

  it('1) ON_DELIVERY PR→PO→PI; create partial dispatch', async () => {
    const { poId } = await createPrAndAccept(
      'ON_DELIVERY',
      'logistics-on-delivery',
    );
    poOnDeliveryId = poId;

    const piRes = await request(app.getHttpServer())
      .get(`/api/v1/customer/purchase-orders/${poId}/proforma-invoice`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(piRes.status).toBe(200);
    expect(piRes.body.data.piNumber).toMatch(/^PI-\d{4}-\d{6}$/);

    const createDispatch = await request(app.getHttpServer())
      .post('/api/v1/seller/dispatches')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        purchaseOrderId: poId,
        quantity: 8,
        plannedDispatchDate: new Date().toISOString(),
        originWarehouseId: warehouseId,
        destinationRegion: 'West India',
        idempotencyKey: `dsp-od-${Date.now()}`,
      });
    expect([200, 201]).toContain(createDispatch.status);
    expect(createDispatch.body.data.dispatchNumber).toMatch(
      /^DSP-\d{4}-\d{6}$/,
    );
    expect(createDispatch.body.data.status).toBe('AWAITING_VEHICLE');
    expect(createDispatch.body.data.buyer.displayName).toBe('ANONYMOUS BUYER');
    expect(createDispatch.body.data).not.toHaveProperty('customerOrgId');
    dispatchId = createDispatch.body.data.id;
  });

  it('2) BEFORE_DISPATCH without payment → PAYMENT_NOT_CLEARED', async () => {
    const { poId } = await createPrAndAccept(
      'BEFORE_DISPATCH',
      'logistics-before-dispatch-block',
    );

    const blocked = await request(app.getHttpServer())
      .post('/api/v1/seller/dispatches')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        purchaseOrderId: poId,
        quantity: 5,
        idempotencyKey: `dsp-block-${Date.now()}`,
      });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('PAYMENT_NOT_CLEARED');
  });

  it('3) create vehicle, assign, eway, load, dispatch → shipment', async () => {
    const plate = `MH12E2E${Date.now().toString().slice(-4)}`;
    const vehicleRes = await request(app.getHttpServer())
      .post('/api/v1/seller/vehicles')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        type: 'TRUCK',
        numberPlate: plate,
        capacityMt: 25,
        transporterName: 'E2E Transport',
      });
    expect([200, 201]).toContain(vehicleRes.status);
    vehicleId = vehicleRes.body.data.id;

    const assign = await request(app.getHttpServer())
      .post(`/api/v1/seller/dispatches/${dispatchId}/assign-vehicle`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ vehicleId });
    expect(assign.status).toBe(200);
    expect(assign.body.data.status).toBe('AWAITING_EWAY_BILL');

    const until = new Date();
    until.setDate(until.getDate() + 7);
    const eway = await request(app.getHttpServer())
      .post(`/api/v1/seller/dispatches/${dispatchId}/eway-bill`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        ewayBillNumber: `EWB${Date.now()}`,
        validFrom: new Date().toISOString(),
        validUntil: until.toISOString(),
      });
    expect(eway.status).toBe(200);
    expect(eway.body.data.status).toBe('VALID');

    const readyCheck = await request(app.getHttpServer())
      .get(`/api/v1/seller/dispatches/${dispatchId}`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(readyCheck.body.data.status).toBe('READY_FOR_DISPATCH');

    const startLoad = await request(app.getHttpServer())
      .post(`/api/v1/seller/dispatches/${dispatchId}/start-loading`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(startLoad.status).toBe(200);
    expect(startLoad.body.data.status).toBe('LOADING');

    const completeLoad = await request(app.getHttpServer())
      .post(`/api/v1/seller/dispatches/${dispatchId}/complete-loading`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(completeLoad.status).toBe(200);
    expect(completeLoad.body.data.status).toBe('LOADED');

    const execute = await request(app.getHttpServer())
      .post(`/api/v1/seller/dispatches/${dispatchId}/dispatch`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(execute.status).toBe(200);
    expect(execute.body.data.dispatch.status).toBe('DISPATCHED');
    expect(execute.body.data.shipment.referenceNumber).toMatch(
      /^SHP-\d{4}-\d{6}$/,
    );
    expect(execute.body.data.shipment.status).toBe('DISPATCHED');
    expect(execute.body.data.delivery.status).toBe('SCHEDULED');
    shipmentId = execute.body.data.shipment.id;
    deliveryId = execute.body.data.delivery.id;

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poOnDeliveryId },
    });
    expect(Number(po?.dispatchedQuantity)).toBe(8);
  });

  it('4) tracking IN_TRANSIT → OUT_FOR_DELIVERY', async () => {
    const inTransit = await request(app.getHttpServer())
      .post(`/api/v1/seller/shipments/${shipmentId}/tracking-events`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ status: 'IN_TRANSIT', location: 'Pune Hub' });
    expect(inTransit.status).toBe(200);
    expect(inTransit.body.data.status).toBe('IN_TRANSIT');

    const ofd = await request(app.getHttpServer())
      .post(`/api/v1/seller/shipments/${shipmentId}/tracking-events`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ status: 'OUT_FOR_DELIVERY', location: 'Customer city' });
    expect(ofd.status).toBe(200);
    expect(ofd.body.data.status).toBe('OUT_FOR_DELIVERY');

    const delivery = await request(app.getHttpServer())
      .get(`/api/v1/seller/deliveries/${deliveryId}`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(delivery.status).toBe(200);
    expect(delivery.body.data.status).toBe('OUT_FOR_DELIVERY');
  });

  it('5) mark delivered + customer confirm', async () => {
    const mark = await request(app.getHttpServer())
      .post(`/api/v1/seller/deliveries/${deliveryId}/mark-delivered`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        receivedBy: 'Site Supervisor',
        deliveryNote: 'Unloaded OK',
      });
    expect(mark.status).toBe(200);
    expect(mark.body.data.status).toBe('DELIVERED');

    const confirm = await request(app.getHttpServer())
      .post(`/api/v1/customer/deliveries/${deliveryId}/confirm`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.status).toBe('CONFIRMED');

    const shipment = await request(app.getHttpServer())
      .get(`/api/v1/customer/shipments/${shipmentId}`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(shipment.status).toBe(200);
    expect(shipment.body.data.status).toBe('DELIVERY_CONFIRMED');
  });

  it('6) blind: customer shipment hides seller identity', async () => {
    const shipment = await request(app.getHttpServer())
      .get(`/api/v1/customer/shipments/${shipmentId}`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(shipment.status).toBe(200);
    const json = JSON.stringify(shipment.body.data);
    expect(json).not.toContain('seller@test.local');
    expect(json).not.toContain('Demo Seller');
    expect(shipment.body.data.supplier.displayName).toBe('ANONYMOUS SUPPLIER');
    expect(shipment.body.data).not.toHaveProperty('sellerOrgId');
  });

  it('7) seller cannot access unrelated customer delivery', async () => {
    const foreign = await request(app.getHttpServer())
      .get(`/api/v1/customer/deliveries/${deliveryId}`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(foreign.status).toBe(403);

    // Seller path is fine for own delivery
    const own = await request(app.getHttpServer())
      .get(`/api/v1/seller/deliveries/${deliveryId}`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(own.status).toBe(200);
    expect(own.body.data.buyer.displayName).toBe('ANONYMOUS BUYER');

    void adminToken;
  });
});
