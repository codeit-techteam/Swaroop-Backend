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

describe('Finance Phase 8 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customerToken: string;
  let sellerToken: string;
  let adminToken: string;
  let offerId: string;
  let purchaseOrderId: string;
  let proformaId: string;
  let scheduleAmount: number;
  let paymentId: string;
  const utrA = `UTR-P8-A-${Date.now()}`;
  const utrB = `UTR-P8-B-${Date.now()}`;

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

  async function createPrAndAccept(paymentMethod: string, note: string) {
    await request(app.getHttpServer())
      .delete('/api/v1/customer/cart')
      .set('Authorization', `Bearer ${customerToken}`);

    const add = await request(app.getHttpServer())
      .post('/api/v1/customer/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ offerId, quantity: 15, paymentMethod });
    expect([200, 201]).toContain(add.status);

    const create = await request(app.getHttpServer())
      .post('/api/v1/customer/purchase-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        destinationRegion: 'West India',
        notes: note,
        idempotencyKey: `phase8-${note}-${Date.now()}`,
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
      // Surface API error body for debugging in CI/logs

      console.error('seller accept failed', accept.status, accept.body);
    }
    expect(accept.status).toBe(200);
    expect(accept.body.data.purchaseRequest.status).toBe('CONVERTED_TO_ORDER');
    const poId = accept.body.data.purchaseOrder?.id as string;
    expect(poId).toBeTruthy();
    return { prId: pr.id as string, poId };
  }

  it('1-3) PR→PO creates PI with PI-YYYY pattern', async () => {
    const { poId } = await createPrAndAccept('ADVANCE', 'finance-advance');
    purchaseOrderId = poId;

    const piRes = await request(app.getHttpServer())
      .get(`/api/v1/customer/purchase-orders/${poId}/proforma-invoice`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(piRes.status).toBe(200);
    expect(piRes.body.data.piNumber).toMatch(/^PI-\d{4}-\d{6}$/);
    expect(piRes.body.data.status).toBe('ISSUED');
    proformaId = piRes.body.data.id;
    scheduleAmount = Number(piRes.body.data.remainingAmount);
    expect(scheduleAmount).toBeGreaterThan(0);
  });

  it('4-5) customer initiates payment and submits UTR', async () => {
    const createPay = await request(app.getHttpServer())
      .post('/api/v1/customer/payments')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        purchaseOrderId,
        amount: scheduleAmount,
        rail: 'BANK_TRANSFER',
        idempotencyKey: `pay-adv-${Date.now()}`,
      });
    expect([200, 201]).toContain(createPay.status);
    expect(createPay.body.data.status).toBe('INITIATED');
    paymentId = createPay.body.data.id;

    const submit = await request(app.getHttpServer())
      .post(`/api/v1/customer/payments/${paymentId}/submit`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ utrNumber: utrA, note: 'phase8 e2e' });
    expect(submit.status).toBe(200);
    expect(submit.body.data.status).toBe('UNDER_VERIFICATION');
  });

  it('6) customer verify attempt → 403', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/finance/payments/${paymentId}/verify`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ note: 'should fail' });
    expect(res.status).toBe(403);
  });

  it('7) seller verify attempt → 403', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/finance/payments/${paymentId}/verify`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ note: 'should fail' });
    expect(res.status).toBe(403);
  });

  it('8) admin verify → schedule PAID, PI PAID', async () => {
    const verify = await request(app.getHttpServer())
      .post(`/api/v1/admin/finance/payments/${paymentId}/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ note: 'verified e2e' });
    expect(verify.status).toBe(200);
    expect(verify.body.data.status).toBe('VERIFIED');

    const pi = await prisma.proformaInvoice.findUnique({
      where: { id: proformaId },
      include: { paymentSchedules: true },
    });
    expect(pi?.status).toBe('PAID');
    expect(pi?.paymentSchedules.every((s) => s.status === 'PAID')).toBe(true);
  });

  it('9) duplicate UTR rejected', async () => {
    const { poId } = await createPrAndAccept('ADVANCE', 'finance-dup-utr');
    const piRes = await request(app.getHttpServer())
      .get(`/api/v1/customer/purchase-orders/${poId}/proforma-invoice`)
      .set('Authorization', `Bearer ${customerToken}`);
    const amount = Number(piRes.body.data.remainingAmount);

    const createPay = await request(app.getHttpServer())
      .post('/api/v1/customer/payments')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        purchaseOrderId: poId,
        amount,
        rail: 'UPI',
        idempotencyKey: `pay-dup-${Date.now()}`,
      });
    expect([200, 201]).toContain(createPay.status);

    const submit = await request(app.getHttpServer())
      .post(`/api/v1/customer/payments/${createPay.body.data.id}/submit`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ utrNumber: utrA });
    expect(submit.status).toBe(409);
    expect(submit.body.code).toBe('UTR_ALREADY_USED');
  });

  it('10) partial payment path on PARTIAL_ADVANCE PO', async () => {
    const { poId } = await createPrAndAccept(
      'PARTIAL_ADVANCE',
      'finance-partial',
    );
    const piRes = await request(app.getHttpServer())
      .get(`/api/v1/customer/purchase-orders/${poId}/proforma-invoice`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(piRes.status).toBe(200);
    const schedules = piRes.body.data.paymentSchedules as Array<{
      id: string;
      type: string;
      status: string;
      remainingAmount: string;
    }>;
    expect(schedules.length).toBe(2);
    expect(schedules[0].type).toBe('ADVANCE');
    expect(schedules[0].status).toBe('DUE');
    expect(schedules[1].type).toBe('BEFORE_DISPATCH');
    expect(schedules[1].status).toBe('PENDING');

    const advanceAmt = Number(schedules[0].remainingAmount);
    const createPay = await request(app.getHttpServer())
      .post('/api/v1/customer/payments')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        purchaseOrderId: poId,
        paymentScheduleId: schedules[0].id,
        amount: advanceAmt,
        rail: 'NEFT',
        idempotencyKey: `pay-partial-${Date.now()}`,
      });
    expect([200, 201]).toContain(createPay.status);

    const submit = await request(app.getHttpServer())
      .post(`/api/v1/customer/payments/${createPay.body.data.id}/utr`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ utrNumber: utrB });
    expect(submit.status).toBe(200);

    const verify = await request(app.getHttpServer())
      .post(`/api/v1/admin/finance/payments/${createPay.body.data.id}/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(verify.status).toBe(200);

    const pi = await prisma.proformaInvoice.findUnique({
      where: { purchaseOrderId: poId },
      include: { paymentSchedules: { orderBy: { sequence: 'asc' } } },
    });
    expect(pi?.status).toBe('PARTIALLY_PAID');
    expect(pi?.paymentSchedules[0].status).toBe('PAID');
    expect(pi?.paymentSchedules[1].status).toBe('PENDING');
  });

  it('11) isPaymentClearedForDispatch true after ADVANCE paid', async () => {
    const clearance = await request(app.getHttpServer())
      .get(
        `/api/v1/admin/finance/purchase-orders/${purchaseOrderId}/dispatch-clearance`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(clearance.status).toBe(200);
    expect(clearance.body.data.cleared).toBe(true);

    const sellerClearance = await request(app.getHttpServer())
      .get(
        `/api/v1/seller/finance/purchase-orders/${purchaseOrderId}/dispatch-clearance`,
      )
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(sellerClearance.status).toBe(200);
    expect(sellerClearance.body.data.cleared).toBe(true);
  });

  it('12) admin finance summary 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/finance/summary')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('ADMIN');
  });

  it('13) customer cannot access another org PI', async () => {
    const fakeId = '00000000-0000-4000-8000-000000000099';
    const res = await request(app.getHttpServer())
      .get(`/api/v1/customer/proforma-invoices/${fakeId}`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect([403, 404]).toContain(res.status);
  });
});
