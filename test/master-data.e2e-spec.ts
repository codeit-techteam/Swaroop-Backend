import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';

async function login(app: INestApplication, email: string): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password: 'Test@12345' });
  expect(response.status).toBe(200);
  return response.body.data.accessToken as string;
}

describe('Master Data (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let customerToken: string;
  let sellerToken: string;
  let createdGradeId: string | undefined;
  const uniqueCode = `E2E_GRADE_${Date.now()}`;

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
  }, 60_000);

  afterAll(async () => {
    if (createdGradeId) {
      await request(app.getHttpServer())
        .delete(`/api/v1/master-data/grades/${createdGradeId}`)
        .set('Authorization', `Bearer ${adminToken}`);
    }
    await app.close();
  });

  it('lists seeded customer grades with pagination', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/master-data/grades/customer')
      .query({ page: 1, limit: 20, search: 'HDPE' })
      .set('Authorization', `Bearer ${customerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.meta.page).toBe(1);
    expect(response.body.meta.total).toBeGreaterThan(0);
  });

  it('lists seller grades', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/master-data/grades/seller')
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
  });

  it('forbids customer from creating grades', async () => {
    const categories = await request(app.getHttpServer())
      .get('/api/v1/master-data/categories/active')
      .set('Authorization', `Bearer ${adminToken}`);

    const categoryId = categories.body.data[0]?.id as string;
    expect(categoryId).toBeTruthy();

    const response = await request(app.getHttpServer())
      .post('/api/v1/master-data/grades')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        code: uniqueCode,
        name: 'E2E Grade',
        categoryId,
      });

    expect(response.status).toBe(403);
  });

  it('forbids seller from creating grades', async () => {
    const categories = await request(app.getHttpServer())
      .get('/api/v1/master-data/categories/active')
      .set('Authorization', `Bearer ${adminToken}`);
    const categoryId = categories.body.data[0]?.id as string;

    const response = await request(app.getHttpServer())
      .post('/api/v1/master-data/grades')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        code: `${uniqueCode}_S`,
        name: 'E2E Seller Grade',
        categoryId,
      });

    expect(response.status).toBe(403);
  });

  it('allows admin to create, update visibility, and deactivate a grade', async () => {
    const categories = await request(app.getHttpServer())
      .get('/api/v1/master-data/categories/active')
      .set('Authorization', `Bearer ${adminToken}`);
    const categoryId = categories.body.data[0]?.id as string;

    const created = await request(app.getHttpServer())
      .post('/api/v1/master-data/grades')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: uniqueCode,
        name: 'E2E Grade',
        displayName: 'E2E Grade',
        categoryId,
        customerVisible: true,
        sellerVisible: true,
        status: 'ACTIVE',
      });

    expect([200, 201]).toContain(created.status);
    createdGradeId = created.body.data.id as string;
    expect(created.body.data.code).toBe(uniqueCode);

    const duplicate = await request(app.getHttpServer())
      .post('/api/v1/master-data/grades')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: uniqueCode,
        name: 'Dup',
        categoryId,
      });
    expect(duplicate.status).toBe(409);

    const hideCustomer = await request(app.getHttpServer())
      .patch(`/api/v1/master-data/grades/${createdGradeId}/visibility`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerVisible: false, sellerVisible: true });
    expect(hideCustomer.status).toBe(200);

    const customerList = await request(app.getHttpServer())
      .get('/api/v1/master-data/grades/customer')
      .query({ search: uniqueCode })
      .set('Authorization', `Bearer ${customerToken}`);
    expect(
      customerList.body.data.some(
        (g: { code: string }) => g.code === uniqueCode,
      ),
    ).toBe(false);

    const sellerList = await request(app.getHttpServer())
      .get('/api/v1/master-data/grades/seller')
      .query({ search: uniqueCode })
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(
      sellerList.body.data.some((g: { code: string }) => g.code === uniqueCode),
    ).toBe(true);

    const deactivate = await request(app.getHttpServer())
      .patch(`/api/v1/master-data/grades/${createdGradeId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'INACTIVE' });
    expect(deactivate.status).toBe(200);

    const sellerAfter = await request(app.getHttpServer())
      .get('/api/v1/master-data/grades/seller')
      .query({ search: uniqueCode })
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(
      sellerAfter.body.data.some(
        (g: { code: string }) => g.code === uniqueCode,
      ),
    ).toBe(false);
  });

  it('lists active units and payment terms', async () => {
    const units = await request(app.getHttpServer())
      .get('/api/v1/master-data/units/active')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(units.status).toBe(200);
    expect(units.body.data.length).toBeGreaterThan(0);

    const terms = await request(app.getHttpServer())
      .get('/api/v1/master-data/payment-terms/active')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(terms.status).toBe(200);
    expect(terms.body.data.length).toBeGreaterThan(0);
  });

  it('returns location hierarchy', async () => {
    const countries = await request(app.getHttpServer())
      .get('/api/v1/master-data/locations/countries')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(countries.status).toBe(200);
    const india = countries.body.data.find(
      (c: { code: string }) => c.code === 'IN',
    );
    expect(india).toBeTruthy();

    const states = await request(app.getHttpServer())
      .get('/api/v1/master-data/locations/states')
      .query({ countryId: india.id })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(states.status).toBe(200);
    expect(states.body.data.length).toBeGreaterThan(0);
  });
});
