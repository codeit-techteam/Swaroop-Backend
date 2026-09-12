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

describe('Procurement Phase 7 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customerToken: string;
  let sellerToken: string;
  let adminToken: string;
  let offerId: string;
  let acceptPrId: string | undefined;
  let counterPrId: string | undefined;
  let expirePrId: string | undefined;

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
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  async function createPrFromCart(notes: string) {
    await request(app.getHttpServer())
      .delete('/api/v1/customer/cart')
      .set('Authorization', `Bearer ${customerToken}`);

    const add = await request(app.getHttpServer())
      .post('/api/v1/customer/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ offerId, quantity: 15, paymentMethod: 'ADVANCE' });
    expect([200, 201]).toContain(add.status);

    const create = await request(app.getHttpServer())
      .post('/api/v1/customer/purchase-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        destinationRegion: 'West India',
        notes,
        idempotencyKey: `phase7-${notes}-${Date.now()}`,
      });
    expect([200, 201]).toContain(create.status);
    const payload = create.body.data;
    const pr =
      payload.purchaseRequests?.[0] ??
      (Array.isArray(payload) ? payload[0] : payload);
    expect(pr?.id).toBeTruthy();
    expect(pr.status).toBe('SOURCING');
    return pr as {
      id: string;
      referenceNumber: string;
      status: string;
    };
  }

  it('1) customer creates PR from cart in SOURCING', async () => {
    const pr = await createPrFromCart('accept-flow');
    acceptPrId = pr.id;
    expect(pr.referenceNumber).toMatch(/^PR-\d{4}-\d{6}$/);
  });

  it('2) seller sees blind PR (no customer email/name)', async () => {
    expect(acceptPrId).toBeTruthy();
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/seller/purchase-requests/${acceptPrId}`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(detail.status).toBe(200);
    const blob = JSON.stringify(detail.body);
    expect(blob).not.toContain('customer@test.local');
    expect(detail.body.data.buyer.displayName).toBe('ANONYMOUS BUYER');
    expect(detail.body.data.customerOrgId).toBeUndefined();
    expect(detail.body.data.responseDeadline).toBeTruthy();
    expect(Array.isArray(detail.body.data.allowedActions)).toBe(true);
  });

  it('3) seller accept → PO created; customer sees CONVERTED_TO_ORDER + po number', async () => {
    expect(acceptPrId).toBeTruthy();
    const accept = await request(app.getHttpServer())
      .post(`/api/v1/seller/purchase-requests/${acceptPrId}/accept`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ message: 'Accepted Phase 7 e2e' });
    expect(accept.status).toBe(200);
    expect(accept.body.data.purchaseRequest.status).toBe('CONVERTED_TO_ORDER');
    expect(accept.body.data.purchaseOrder?.referenceNumber).toMatch(
      /^PO-\d{4}-\d{6}$/,
    );

    const customerView = await request(app.getHttpServer())
      .get(`/api/v1/customer/purchase-requests/${acceptPrId}`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(customerView.status).toBe(200);
    expect(customerView.body.data.status).toBe('CONVERTED_TO_ORDER');
    expect(
      customerView.body.data.poNumber ||
        customerView.body.data.purchaseOrder?.referenceNumber,
    ).toMatch(/^PO-\d{4}-\d{6}$/);
    const blob = JSON.stringify(customerView.body);
    expect(blob).not.toContain('Demo Seller Polymers');
    expect(blob).not.toContain('seller@test.local');
  });

  it('4) counter flow: seller counter → customer accept → PO', async () => {
    const pr = await createPrFromCart('counter-flow');
    counterPrId = pr.id;

    const counter = await request(app.getHttpServer())
      .post(`/api/v1/seller/purchase-requests/${counterPrId}/counter`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        unitPrice: 95_000,
        quantity: 15,
        paymentMethod: 'ADVANCE',
        note: 'Seller counter Phase 7',
      });
    expect(counter.status).toBe(200);
    expect(counter.body.data.purchaseRequest.status).toBe('NEGOTIATION');

    const customerAccept = await request(app.getHttpServer())
      .post(`/api/v1/customer/purchase-requests/${counterPrId}/accept-counter`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({});
    expect(customerAccept.status).toBe(200);
    expect(customerAccept.body.data.status).toBe('CONVERTED_TO_ORDER');
    expect(
      customerAccept.body.data.poNumber ||
        customerAccept.body.data.purchaseOrder?.referenceNumber,
    ).toMatch(/^PO-\d{4}-\d{6}$/);
  });

  it('5) expired PR: seller accept returns 409 PURCHASE_REQUEST_EXPIRED', async () => {
    const pr = await createPrFromCart('expire-flow');
    expirePrId = pr.id;

    await prisma.purchaseRequest.update({
      where: { id: expirePrId },
      data: {
        responseDeadline: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const accept = await request(app.getHttpServer())
      .post(`/api/v1/seller/purchase-requests/${expirePrId}/accept`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({});
    expect(accept.status).toBe(409);
    expect(accept.body.code || accept.body.message?.code).toBeTruthy();
    const code =
      accept.body.code ??
      accept.body.error?.code ??
      (typeof accept.body.message === 'object'
        ? accept.body.message.code
        : undefined);
    expect(code).toBe('PURCHASE_REQUEST_EXPIRED');
  });

  it('6) admin summary + list sees both identities', async () => {
    const summary = await request(app.getHttpServer())
      .get('/api/v1/admin/procurement/summary')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(summary.status).toBe(200);
    expect(summary.body.data.total).toBeGreaterThan(0);

    const list = await request(app.getHttpServer())
      .get('/api/v1/admin/procurement/purchase-requests')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    const any = list.body.data[0];
    expect(any.customerOrg?.name).toBeTruthy();
    // sellerOrg may be null for broadcast, but accept flow should have one
    const converted = list.body.data.find(
      (p: { status: string }) => p.status === 'CONVERTED_TO_ORDER',
    );
    if (converted) {
      expect(converted.sellerOrg?.name).toBeTruthy();
      expect(converted.customerOrg?.name).toBeTruthy();
    }
  });

  it('7) blind: seller list omits customer@test.local; customer PR omits seller identity', async () => {
    const sellerList = await request(app.getHttpServer())
      .get('/api/v1/seller/purchase-requests')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(sellerList.status).toBe(200);
    expect(JSON.stringify(sellerList.body)).not.toContain(
      'customer@test.local',
    );

    if (acceptPrId) {
      const customerPr = await request(app.getHttpServer())
        .get(`/api/v1/customer/purchase-requests/${acceptPrId}`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(customerPr.status).toBe(200);
      const blob = JSON.stringify(customerPr.body);
      expect(blob).not.toContain('Demo Seller Polymers');
      expect(blob).not.toContain('seller@test.local');
    }
  });
});
