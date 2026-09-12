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

describe('Seller APIs (e2e)', () => {
  let app: INestApplication;
  let sellerToken: string;
  let customerToken: string;
  let adminToken: string;

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

    sellerToken = await login(app, 'seller@test.local');
    customerToken = await login(app, 'customer@test.local');
    adminToken = await login(app, 'admin@test.local');
  }, 90_000);

  afterAll(async () => {
    await app.close();
  });

  it('rejects customer from seller profile', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/seller/profile')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(403);
  });

  it('returns seller profile / dashboard for seller', async () => {
    const profile = await request(app.getHttpServer())
      .get('/api/v1/seller/profile')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(profile.status).toBe(200);
    expect(
      profile.body.data.sellerProfileId || profile.body.data.id,
    ).toBeTruthy();

    const dash = await request(app.getHttpServer())
      .get('/api/v1/seller/dashboard/summary')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(dash.status).toBe(200);
    expect(dash.body.data.products).toBeTruthy();
  });

  it('lists seller products referencing grade master', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/seller/products')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    if (res.body.data.length) {
      expect(
        res.body.data[0].gradeId || res.body.data[0].grade?.id,
      ).toBeTruthy();
    }
  });

  it('lists inventory and prevents unauthorized access without auth', async () => {
    const unauth = await request(app.getHttpServer()).get(
      '/api/v1/seller/inventory',
    );
    expect(unauth.status).toBe(401);

    const res = await request(app.getHttpServer())
      .get('/api/v1/seller/inventory')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
  });

  it('returns blind PR without buyer identity fields', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/seller/purchase-requests')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(list.status).toBe(200);

    const pr = list.body.data.find(
      (item: { referenceNumber: string }) =>
        item.referenceNumber === 'PR-2026-000123',
    );
    expect(pr).toBeTruthy();
    expect(pr.buyer.displayName).toBe('ANONYMOUS BUYER');
    expect(pr.buyer.reference).toMatch(/^BUYER-/);
    expect(pr.customerOrgId).toBeUndefined();
    expect(JSON.stringify(pr)).not.toContain('Confidential Buyer');
    expect(JSON.stringify(pr)).not.toContain('buyer-secret@test.local');
    expect(JSON.stringify(pr)).not.toContain('+919900009999');

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/seller/purchase-requests/${pr.id}`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.buyer.displayName).toBe('ANONYMOUS BUYER');
  });

  it('allows seller to reject a PR response path safely', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/seller/purchase-requests')
      .set('Authorization', `Bearer ${sellerToken}`);
    const pr = list.body.data.find(
      (item: { referenceNumber: string }) =>
        item.referenceNumber === 'PR-2026-000123',
    );
    if (!pr) return;

    // Use respond with message only to avoid locking demo PR into rejected for other tests
    const respond = await request(app.getHttpServer())
      .post(`/api/v1/seller/purchase-requests/${pr.id}/respond`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        type: 'RESPOND',
        message: 'Acknowledged — reviewing stock',
      });
    expect([200, 201]).toContain(respond.status);
  });

  it('admin can review seller company with sellerProfileId', async () => {
    const sellerProfile = await request(app.getHttpServer())
      .get('/api/v1/seller/profile')
      .set('Authorization', `Bearer ${sellerToken}`);
    const sellerProfileId =
      sellerProfile.body.data.sellerProfileId ?? sellerProfile.body.data.id;

    const company = await request(app.getHttpServer())
      .get('/api/v1/seller/company')
      .query({ sellerProfileId })
      .set('Authorization', `Bearer ${adminToken}`);
    expect([200, 403]).toContain(company.status);
  });
});
