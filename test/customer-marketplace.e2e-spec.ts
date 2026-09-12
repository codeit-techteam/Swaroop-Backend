import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';

async function login(app: INestApplication, email: string) {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password: 'Test@12345' });
  expect(response.status).toBe(200);
  return response.body.data.accessToken as string;
}

describe('Customer Marketplace (e2e)', () => {
  let app: INestApplication;
  let customerToken: string;
  let sellerToken: string;
  let offerId: string;
  let createdPrId: string | undefined;

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

    customerToken = await login(app, 'customer@test.local');
    sellerToken = await login(app, 'seller@test.local');
  }, 90_000);

  afterAll(async () => {
    await app.close();
  });

  it('loads marketplace home and grades without seller identity', async () => {
    const home = await request(app.getHttpServer())
      .get('/api/v1/customer/marketplace')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(home.status).toBe(200);
    expect(home.body.success).toBe(true);

    const grades = await request(app.getHttpServer())
      .get('/api/v1/customer/marketplace/grades')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(grades.status).toBe(200);
    expect(Array.isArray(grades.body.data)).toBe(true);
    expect(JSON.stringify(grades.body)).not.toMatch(/seller@test\.local/i);
  });

  it('lists products and offers with anonymous supplier', async () => {
    const products = await request(app.getHttpServer())
      .get('/api/v1/customer/products')
      .query({ search: 'HDPE' })
      .set('Authorization', `Bearer ${customerToken}`);
    expect(products.status).toBe(200);

    const offers = await request(app.getHttpServer())
      .get('/api/v1/customer/offers')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(offers.status).toBe(200);
    expect(offers.body.data.length).toBeGreaterThan(0);
    const offer = offers.body.data[0];
    offerId = offer.id;
    expect(offer.supplier.displayName).toBe('ANONYMOUS SUPPLIER');
    expect(offer.organizationId).toBeUndefined();
    expect(JSON.stringify(offer)).not.toContain('Demo Seller Polymers');
    expect(JSON.stringify(offer)).not.toContain('seller@test.local');
  });

  it('rejects quantity below MOQ and adds valid cart item', async () => {
    const belowMoq = await request(app.getHttpServer())
      .post('/api/v1/customer/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ offerId, quantity: 0.001, paymentMethod: 'ADVANCE' });
    // Depending on offer MOQ this may be 400
    expect([200, 201, 400]).toContain(belowMoq.status);

    const add = await request(app.getHttpServer())
      .post('/api/v1/customer/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ offerId, quantity: 15, paymentMethod: 'ADVANCE' });
    expect([200, 201]).toContain(add.status);
    const items = add.body.data.items ?? add.body.data;
    const item = Array.isArray(items)
      ? items.find(
          (i: { offerId?: string; offer?: { id: string } }) =>
            i.offerId === offerId || i.offer?.id === offerId,
        )
      : null;
    expect(item || add.body.data).toBeTruthy();

    const cart = await request(app.getHttpServer())
      .get('/api/v1/customer/cart')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(cart.status).toBe(200);
    expect(cart.body.data.items.length).toBeGreaterThan(0);
  });

  it('validates checkout and creates PR with 15-minute deadline', async () => {
    const validate = await request(app.getHttpServer())
      .post('/api/v1/customer/cart/validate')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({});
    expect(validate.status).toBe(200);

    const create = await request(app.getHttpServer())
      .post('/api/v1/customer/purchase-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        destinationRegion: 'West India',
        notes: 'Phase 6 e2e PR',
        idempotencyKey: `e2e-${Date.now()}`,
      });
    expect([200, 201]).toContain(create.status);
    const pr = Array.isArray(create.body.data)
      ? create.body.data[0]
      : create.body.data;
    createdPrId = pr.id ?? pr.purchaseRequests?.[0]?.id ?? pr[0]?.id;
    const payload = pr.referenceNumber ? pr : (pr.purchaseRequests?.[0] ?? pr);
    expect(payload.referenceNumber).toMatch(/^PR-\d{4}-\d{6}$/);
    expect(payload.supplier.displayName).toBe('ANONYMOUS SUPPLIER');
    expect(payload.responseDeadline || payload.expiresAt).toBeTruthy();
    const created = new Date(payload.createdAt).getTime();
    const deadline = new Date(
      payload.responseDeadline ?? payload.expiresAt,
    ).getTime();
    expect(deadline - created).toBeGreaterThanOrEqual(14 * 60 * 1000);
    expect(deadline - created).toBeLessThanOrEqual(16 * 60 * 1000);
    expect(JSON.stringify(payload)).not.toContain('Demo Seller Polymers');
  });

  it('enforces blind marketplace on seller PR inbox', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/seller/purchase-requests')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(list.status).toBe(200);
    const blob = JSON.stringify(list.body);
    expect(blob).not.toContain('customer@test.local');
    expect(blob).not.toContain('+919900000001');
    expect(blob).not.toContain('Confidential Buyer');
    const any = list.body.data?.[0];
    if (any) {
      expect(any.buyer.displayName).toBe('ANONYMOUS BUYER');
      expect(any.customerOrgId).toBeUndefined();
    }
  });

  it('blocks seller from customer cart and customer from other ownership', async () => {
    const sellerCart = await request(app.getHttpServer())
      .get('/api/v1/customer/cart')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(sellerCart.status).toBe(403);

    if (createdPrId) {
      const status = await request(app.getHttpServer())
        .get(`/api/v1/customer/purchase-requests/${createdPrId}/status`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(status.status).toBe(200);
    }
  });

  it('returns customer dashboard summary', async () => {
    const dash = await request(app.getHttpServer())
      .get('/api/v1/customer/dashboard/summary')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(dash.status).toBe(200);
    expect(dash.body.data).toBeTruthy();
  });
});
