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

describe('Phase 13 Analytics Reports Audit (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let customerToken: string;
  let sellerToken: string;

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

    adminToken = await login(app, 'admin@test.local');
    customerToken = await login(app, 'customer@test.local');
    sellerToken = await login(app, 'seller@test.local');
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  it('1-3. non-admin cannot access analytics', async () => {
    for (const token of [customerToken, sellerToken]) {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/analytics/overview')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    }
  });

  it('4-8. admin sales / gmv analytics return numeric money strings', async () => {
    const overview = await request(app.getHttpServer())
      .get('/api/v1/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(overview.status).toBe(200);
    expect(overview.body.success).toBe(true);
    expect(overview.body.data.sales).toBeDefined();
    expect(typeof overview.body.data.sales.gmv).toBe('string');
    expect(typeof overview.body.data.sales.orders).toBe('number');
    expect(overview.body.data.period.from).toBeTruthy();
    expect(overview.body.data.period.to).toBeTruthy();

    const sales = await request(app.getHttpServer())
      .get('/api/v1/admin/analytics/sales')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(sales.status).toBe(200);
    expect(sales.body.data.summary.gmv).toMatch(/^\d+\.\d{2}$/);
    expect(Array.isArray(sales.body.data.trend)).toBe(true);

    const gmv = await request(app.getHttpServer())
      .get('/api/v1/admin/analytics/gmv?groupBy=day')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(gmv.status).toBe(200);
    expect(gmv.body.data.summary.orderCount).toBeTypeOf('number');
  });

  it('9-12. procurement rates handle zero denominators', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/analytics/procurement')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rate = res.body.data.conversion.prToPoRate;
    expect(Number.isFinite(rate)).toBe(true);
    expect(rate).not.toBeNaN();
  });

  it('13-16. payments and payment-clearance', async () => {
    const payments = await request(app.getHttpServer())
      .get('/api/v1/admin/analytics/payments')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(payments.status).toBe(200);
    expect(payments.body.data.totalPaymentAmount).toMatch(/^\d+\.\d{2}$/);

    const clearance = await request(app.getHttpServer())
      .get('/api/v1/admin/analytics/payment-clearance')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(clearance.status).toBe(200);
    expect(typeof clearance.body.data.paymentCleared).toBe('number');
    expect(typeof clearance.body.data.paymentBlockedForDispatch).toBe('number');
  });

  it('17-21. sellers customers inventory', async () => {
    for (const path of [
      '/api/v1/admin/analytics/sellers',
      '/api/v1/admin/analytics/customers',
      '/api/v1/admin/analytics/inventory',
      '/api/v1/admin/analytics/grades',
      '/api/v1/admin/analytics/products',
    ]) {
      const res = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    }
  });

  it('24-29. logistics delivery settlements finance operational', async () => {
    for (const path of [
      '/api/v1/admin/analytics/logistics',
      '/api/v1/admin/analytics/delivery',
      '/api/v1/admin/analytics/settlements',
      '/api/v1/admin/analytics/finance',
      '/api/v1/admin/analytics/operational-status',
    ]) {
      const res = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
    }
  });

  it('reports inventory + settlements endpoints', async () => {
    for (const path of [
      '/api/v1/admin/reports/inventory',
      '/api/v1/admin/reports/settlements',
      '/api/v1/admin/reports/sales',
    ]) {
      const res = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
    }
  });

  it('30-34. audit logs are readable, paginated, immutable API', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/admin/audit-logs?page=1&limit=20')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);
    expect(list.body.meta).toBeDefined();

    const put = await request(app.getHttpServer())
      .put('/api/v1/admin/audit-logs/00000000-0000-0000-0000-000000000001')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'HACKED' });
    expect([404, 405]).toContain(put.status);

    const del = await request(app.getHttpServer())
      .delete('/api/v1/admin/audit-logs/00000000-0000-0000-0000-000000000001')
      .set('Authorization', `Bearer ${adminToken}`);
    expect([404, 405]).toContain(del.status);
  });

  it('rejects invalid date range', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/analytics/overview?from=2026-09-12&to=2026-09-01')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });
});
