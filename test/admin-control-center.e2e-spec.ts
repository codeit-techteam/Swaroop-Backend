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
import { SellerStatus } from '../src/generated/prisma/client.js';

async function login(app: INestApplication, email: string) {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password: 'Test@12345' });
  expect(response.status).toBe(200);
  return response.body.data.accessToken as string;
}

describe('Admin Control Center Phase 10 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
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

    prisma = app.get(PrismaService);
    customerToken = await login(app, 'customer@test.local');
    adminToken = await login(app, 'admin@test.local');
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  it('customer cannot access admin dashboard', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/dashboard/summary')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(403);
  });

  it('admin dashboard summary returns numeric fields', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/dashboard/summary')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    for (const key of [
      'users',
      'customers',
      'sellers',
      'grades',
      'products',
      'offers',
      'purchaseRequests',
      'purchaseOrders',
      'payments',
      'documentsPending',
      'notificationsUnread',
    ]) {
      expect(typeof data[key]).toBe('number');
    }
  });

  it('admin lists users, sellers, customers', async () => {
    for (const path of [
      '/api/v1/admin/users',
      '/api/v1/admin/sellers',
      '/api/v1/admin/customers',
    ]) {
      const res = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    }
  });

  it('admin grades alias lists grades', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/grades')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('admin search q=HDPE', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/search')
      .query({ q: 'HDPE' })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('grades');
    expect(res.body.data).toHaveProperty('products');
  });

  it('admin audit-logs list', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/audit-logs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('admin reports overview', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/reports/overview')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.data.users).toBe('number');
  });

  it('seller approve path if pending seller exists', async () => {
    const pending = await prisma.sellerProfile.findFirst({
      where: {
        deletedAt: null,
        status: {
          in: [
            SellerStatus.PENDING_VERIFICATION,
            SellerStatus.UNDER_REVIEW,
            SellerStatus.DRAFT,
          ],
        },
      },
    });
    if (!pending) {
      expect(true).toBe(true);
      return;
    }
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/sellers/${pending.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'e2e approve' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(SellerStatus.APPROVED);
  });

  it('non-admin cannot verify payment via alias', async () => {
    const payment = await prisma.payment.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    if (!payment) {
      const res = await request(app.getHttpServer())
        .post(
          '/api/v1/admin/payments/00000000-0000-4000-8000-000000000001/verify',
        )
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ note: 'nope' });
      expect(res.status).toBe(403);
      return;
    }
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/payments/${payment.id}/verify`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ note: 'nope' });
    expect(res.status).toBe(403);
  });
});
