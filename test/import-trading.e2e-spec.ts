import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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

const day = 24 * 3600 * 1000;
const isoDate = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);

describe('Import trading (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customer: string;
  let seller: string;
  let admin: string;
  const created = { listings: [] as string[] };
  let terms: Record<string, unknown>;

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    customer = await login(app, 'customer@test.local');
    seller = await login(app, 'seller@test.local');
    admin = await login(app, 'admin@test.local');

    const bundle = await api()
      .get('/api/v1/import/master-data')
      .set(auth(customer));
    expect(bundle.status).toBe(200);
    const m = bundle.body.data;
    const usd = m.currencies.find((c: { code: string }) => c.code === 'USD');
    const cfr = m.incoterms.find((i: { code: string }) => i.code === 'CFR');
    const grade = await prisma.grade.findFirstOrThrow({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        category: { status: 'ACTIVE', isActive: true, deletedAt: null },
      },
    });
    const [brand, origin, pol, pod, lc, coa] = await Promise.all([
      prisma.brand.findUniqueOrThrow({ where: { code: 'SINOPEC' } }),
      prisma.location.findUniqueOrThrow({ where: { code: 'CN' } }),
      prisma.port.findUniqueOrThrow({ where: { code: 'CNSHA' } }),
      prisma.port.findUniqueOrThrow({ where: { code: 'INMUN' } }),
      prisma.paymentTerm.findUniqueOrThrow({ where: { code: 'IMP_LC_SIGHT' } }),
      prisma.documentRequirement.findUniqueOrThrow({ where: { code: 'COA' } }),
    ]);
    terms = {
      categoryId: grade.categoryId,
      gradeId: grade.id,
      brandId: brand.id,
      originCountryId: origin.id,
      quantity: '500',
      quantityUnit: 'MT',
      currencyId: usd.id,
      priceUnit: 'MT',
      priceType: 'NEGOTIABLE',
      incotermId: cfr.id,
      priceBasisPortId: pod.id,
      paymentTermId: lc.id,
      polId: pol.id,
      podId: pod.id,
      esd: isoDate(10),
      lsd: isoDate(40),
      transitMinDays: 18,
      transitMaxDays: 25,
      shipmentType: 'FCL',
      inspectionType: 'SGS',
      documentRequirementIds: [coa.id],
      validUntil: new Date(Date.now() + 7 * day).toISOString(),
    };
  }, 90_000);

  afterAll(async () => {
    if (prisma && created.listings.length) {
      const ids = created.listings;
      const listingFilter = {
        OR: [{ buyListingId: { in: ids } }, { sellListingId: { in: ids } }],
      };
      await prisma.importDeal.deleteMany({ where: listingFilter });
      await prisma.importNegotiation.deleteMany({ where: listingFilter });
      await prisma.importMatch.deleteMany({ where: listingFilter });
      await prisma.importListing.deleteMany({ where: { id: { in: ids } } });
    }
    await app?.close();
  });

  let buyId: string;
  let sellId: string;
  let negotiationId: string;
  let dealId: string;

  it('documents Import routes in OpenAPI', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    const paths = Object.keys(doc.paths);
    for (const path of [
      '/api/v1/import/buy/{id}/publish',
      '/api/v1/import/sell/{id}/pause',
      '/api/v1/import/negotiations/{id}/counter',
      '/api/v1/import/deals/{id}/confirm',
      '/api/v1/admin/import/master-data/{entity}',
      '/api/v1/admin/import/dashboard',
    ]) {
      expect(paths).toContain(path);
    }
  });

  it('exposes the feature flag and USD-first master data', async () => {
    const cfg = await api().get('/api/v1/import/config').set(auth(customer));
    expect(cfg.status).toBe(200);
    expect(cfg.body.data.enabled).toBe(true);

    const bundle = await api()
      .get('/api/v1/import/master-data')
      .set(auth(seller));
    expect(bundle.body.data.defaultCurrencyCode).toBe('USD');

    const inr = await api()
      .get('/api/v1/import/master-data/payment-terms?currencyCode=INR')
      .set(auth(customer));
    expect(inr.status).toBe(200);
    expect(inr.body.data.length).toBeGreaterThan(0);
    for (const t of inr.body.data) expect(t.currencyCodes).toContain('INR');
  });

  it('creates a BUY draft with a backend reference and rejects incomplete publish', async () => {
    const res = await api()
      .post('/api/v1/import/buy')
      .set(auth(customer))
      .send({ categoryId: terms.categoryId, quantity: '500' });
    expect(res.status).toBe(201);
    expect(res.body.data.referenceNumber).toMatch(/^IBR-\d{6}-\d{6}$/);
    expect(res.body.data.status).toBe('DRAFT');
    buyId = res.body.data.id;
    created.listings.push(buyId);

    const publish = await api()
      .post(`/api/v1/import/buy/${buyId}/publish`)
      .set(auth(customer));
    expect(publish.status).toBe(422);
    expect(publish.body.code).toBe('IMPORT_VALIDATION_FAILED');
    const fields = (publish.body.details as Array<{ field: string }>).map(
      (d) => d.field,
    );
    expect(fields).toEqual(
      expect.arrayContaining(['incotermId', 'polId', 'validUntil']),
    );
  });

  it('enforces ESD <= LSD and optimistic locking on autosave', async () => {
    const bad = await api()
      .patch(`/api/v1/import/buy/${buyId}`)
      .set(auth(customer))
      .send({ esd: isoDate(30), lsd: isoDate(20) });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('INVALID_SHIPMENT_WINDOW');

    const ok = await api()
      .patch(`/api/v1/import/buy/${buyId}`)
      .set(auth(customer))
      .send({
        ...terms,
        version: 1,
        price: '1050',
        acceptableQuantityMin: '400',
      });
    expect(ok.status).toBe(200);
    expect(ok.body.data.version).toBe(2);
    expect(ok.body.data.shipping.estimatedEta.basis).toBe(
      'ESTIMATED_FROM_TRANSIT_DAYS',
    );

    const stale = await api()
      .patch(`/api/v1/import/buy/${buyId}`)
      .set(auth(customer))
      .send({ remarks: 'stale', version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('IMPORT_DRAFT_CONFLICT');
  });

  it('rejects GST on non-INR and client-supplied identity fields', async () => {
    const gst = await api()
      .patch(`/api/v1/import/buy/${buyId}`)
      .set(auth(customer))
      .send({ gstTreatment: 'GST_EXTRA' });
    expect(gst.status).toBe(422);

    const spoof = await api()
      .patch(`/api/v1/import/buy/${buyId}`)
      .set(auth(customer))
      .send({
        ownerOrgId: '00000000-0000-0000-0000-000000000000',
        status: 'PUBLISHED',
      });
    expect(spoof.status).toBe(400);
  });

  it('publishes idempotently and locks product fields afterwards', async () => {
    const key = `e2e-publish-${Date.now()}`;
    const first = await api()
      .post(`/api/v1/import/buy/${buyId}/publish`)
      .set(auth(customer))
      .set('Idempotency-Key', key);
    expect(first.status).toBe(200);
    expect(first.body.data.status).toMatch(/PUBLISHED|MATCHING/);
    expect(first.body.data.product.category.name).toBeTruthy();

    const replay = await api()
      .post(`/api/v1/import/buy/${buyId}/publish`)
      .set(auth(customer))
      .set('Idempotency-Key', key);
    expect(replay.status).toBe(200);
    expect(replay.body.data.id).toBe(buyId);

    const again = await api()
      .post(`/api/v1/import/buy/${buyId}/publish`)
      .set(auth(customer));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('IMPORT_ALREADY_PUBLISHED');

    const locked = await api()
      .patch(`/api/v1/import/buy/${buyId}`)
      .set(auth(customer))
      .send({ podId: terms.polId });
    expect(locked.status).toBe(422);
    expect(locked.body.details[0].code).toBe('FIELD_LOCKED');
  });

  it('enforces roles and resolves trading identity server-side', async () => {
    const adminSell = await api()
      .post('/api/v1/import/sell')
      .set(auth(admin))
      .send({});
    expect(adminSell.status).toBe(403);

    const unauth = await api().get('/api/v1/import/buy');
    expect(unauth.status).toBe(401);

    const otherDraft = await api()
      .get(`/api/v1/import/buy/${buyId}`)
      .set(auth(admin));
    expect(otherDraft.status).toBe(403);
  });

  it('publishes a SELL offer and computes explainable matches', async () => {
    const res = await api()
      .post('/api/v1/import/sell')
      .set(auth(seller))
      .send({
        ...terms,
        price: '1020',
        moq: '100',
        readyStockType: 'READY_STOCK',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.referenceNumber).toMatch(/^ISO-\d{6}-\d{6}$/);
    sellId = res.body.data.id;
    created.listings.push(sellId);

    const pub = await api()
      .post(`/api/v1/import/sell/${sellId}/publish`)
      .set(auth(seller));
    expect(pub.status).toBe(200);

    const matches = await api()
      .get(`/api/v1/import/buy/${buyId}/matches`)
      .set(auth(customer));
    expect(matches.status).toBe(200);
    const match = matches.body.data.find(
      (m: { listing: { id: string } }) => m.listing.id === sellId,
    );
    expect(match).toBeTruthy();
    expect(match.matchScore).toBe(100);
    expect(match.matchedCriteria).toEqual(
      expect.arrayContaining(['PRODUCT', 'GRADE', 'PRICE', 'INCOTERM']),
    );
    expect(match.unmatchedCriteria).toEqual([]);
    expect(JSON.stringify(match.listing)).not.toContain('ownerOrgId');
    expect(match.listing.counterpartyRef).toMatch(/^SELLER-[0-9A-F]{8}$/);
  });

  it('keeps the marketplace blind', async () => {
    const market = await api()
      .get('/api/v1/import/buy?scope=market')
      .set(auth(seller));
    expect(market.status).toBe(200);
    const row = market.body.data.find((l: { id: string }) => l.id === buyId);
    expect(row).toBeTruthy();
    expect(row.ownerOrgId).toBeUndefined();
    expect(row.customerProfileId).toBeUndefined();
    expect(row.counterpartyRef).toMatch(/^BUYER-/);

    const noCurrency = await api()
      .get('/api/v1/import/buy?scope=market&priceMin=100')
      .set(auth(seller));
    expect(noCurrency.status).toBe(422);
    const priceSortNoCurrency = await api()
      .get('/api/v1/import/buy?scope=market&sortBy=price')
      .set(auth(seller));
    expect(priceSortNoCurrency.status).toBe(422);
  });

  it('runs a turn-based negotiation to a two-party confirmed deal', async () => {
    const key = `e2e-open-${Date.now()}`;
    const open = await api()
      .post('/api/v1/import/negotiations')
      .set(auth(customer))
      .set('Idempotency-Key', key)
      .send({
        listingId: sellId,
        counterListingId: buyId,
        price: '990',
        quantity: '450',
      });
    expect(open.status).toBe(201);
    negotiationId = open.body.data.id;
    expect(open.body.data.referenceNumber).toMatch(/^INE-/);
    expect(open.body.data.awaitingMyResponse).toBe(false);

    const replay = await api()
      .post('/api/v1/import/negotiations')
      .set(auth(customer))
      .set('Idempotency-Key', key)
      .send({ listingId: sellId, price: '990', quantity: '450' });
    expect(replay.body.data.id).toBe(negotiationId);

    const outOfTurn = await api()
      .post(`/api/v1/import/negotiations/${negotiationId}/counter`)
      .set(auth(customer))
      .send({ price: '995' });
    expect(outOfTurn.status).toBe(409);
    expect(outOfTurn.body.code).toBe('NEGOTIATION_NOT_ALLOWED');

    const belowMoq = await api()
      .post(`/api/v1/import/negotiations/${negotiationId}/counter`)
      .set(auth(seller))
      .send({ quantity: '50' });
    expect(belowMoq.status).toBe(422);

    const counter = await api()
      .post(`/api/v1/import/negotiations/${negotiationId}/counter`)
      .set(auth(seller))
      .send({ price: '1005', note: 'Best we can do' });
    expect(counter.status).toBe(200);
    expect(counter.body.data.latestTerms.price).toBe('1005');
    expect(counter.body.data.latestTerms.quantity).toBe('450');

    const accept = await api()
      .post(`/api/v1/import/negotiations/${negotiationId}/accept`)
      .set(auth(customer));
    expect(accept.status).toBe(200);
    expect(accept.body.data.status).toBe('AGREED');
    dealId = accept.body.data.deal.id;

    const pending = await api()
      .get(`/api/v1/import/deals/${dealId}`)
      .set(auth(seller));
    expect(pending.body.data.status).toBe('PENDING_CONFIRMATION');
    expect(pending.body.data.buyer).toBeUndefined();
    expect(pending.body.data.awaitingMyConfirmation).toBe(true);
    expect(pending.body.data.price).toBe('1005');

    const confirm = await api()
      .post(`/api/v1/import/deals/${dealId}/confirm`)
      .set(auth(seller));
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.status).toBe('CONFIRMED');
    expect(confirm.body.data.buyer.name).toBeTruthy();

    const sell = await prisma.importListing.findUniqueOrThrow({
      where: { id: sellId },
    });
    expect(sell.status).toBe('DEAL_CONFIRMED');
  });

  it('keeps negotiation events append-only at the database level', async () => {
    await expect(
      prisma.importNegotiationEvent.updateMany({
        where: { negotiationId },
        data: { note: 'tampered' },
      }),
    ).rejects.toThrow();
  });

  it('gives Admin a full timeline and master data management', async () => {
    const detail = await api()
      .get(`/api/v1/admin/import/listings/${sellId}`)
      .set(auth(admin));
    expect(detail.status).toBe(200);
    const actions = detail.body.data.auditTrail.map(
      (a: { action: string }) => a.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        'IMPORT_SELL_CREATED',
        'IMPORT_SELL_PUBLISHED',
        'IMPORT_DEAL_CONFIRMED',
      ]),
    );
    expect(detail.body.data.negotiations[0].events.length).toBe(3);

    const dash = await api()
      .get('/api/v1/admin/import/dashboard')
      .set(auth(admin));
    expect(dash.status).toBe(200);
    expect(Number(dash.body.data.confirmedVolumeMt)).toBeGreaterThanOrEqual(
      450,
    );

    const dup = await api()
      .post('/api/v1/admin/import/master-data/ports')
      .set(auth(admin))
      .send({
        code: 'INMUN',
        name: 'Mundra',
        countryId: terms.originCountryId,
      });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('IMPORT_MASTER_CONFLICT');

    const forbidden = await api()
      .get('/api/v1/admin/import/dashboard')
      .set(auth(customer));
    expect(forbidden.status).toBe(403);
  });

  it('gives Admin deal tracking, an Import audit feed and a documents register', async () => {
    const deal = await api()
      .get(`/api/v1/admin/import/deals/${dealId}`)
      .set(auth(admin));
    expect(deal.status).toBe(200);
    expect(deal.body.data.buyer.name).toBeTruthy();
    expect(
      deal.body.data.timeline.map((e: { type: string }) => e.type),
    ).toEqual(['OPENED', 'COUNTER', 'ACCEPTED']);
    expect(deal.body.data.negotiationSummary.id).toBe(negotiationId);
    expect(
      deal.body.data.auditTrail.map((a: { action: string }) => a.action),
    ).toEqual(expect.arrayContaining(['IMPORT_DEAL_CONFIRMED']));
    expect(Array.isArray(deal.body.data.documents)).toBe(true);

    const audit = await api()
      .get(`/api/v1/admin/import/audit-logs?entityId=${dealId}`)
      .set(auth(admin));
    expect(audit.status).toBe(200);
    expect(audit.body.meta.total).toBeGreaterThan(0);
    for (const row of audit.body.data) {
      expect(row.entityId).toBe(dealId);
      expect(row.entityReference).toMatch(/^IDL-/);
    }

    const byRef = await api()
      .get(
        `/api/v1/admin/import/audit-logs?search=${deal.body.data.referenceNumber}`,
      )
      .set(auth(admin));
    expect(byRef.status).toBe(200);
    expect(byRef.body.meta.total).toBeGreaterThan(0);

    const dealSearch = await api()
      .get(
        `/api/v1/admin/import/deals?search=${deal.body.data.buyer.name.slice(0, 6)}`,
      )
      .set(auth(admin));
    expect(dealSearch.status).toBe(200);
    expect(
      dealSearch.body.data.some((d: { id: string }) => d.id === dealId),
    ).toBe(true);

    const docs = await api()
      .get(`/api/v1/admin/import/documents?dealId=${dealId}`)
      .set(auth(admin));
    expect(docs.status).toBe(200);
    expect(Array.isArray(docs.body.data)).toBe(true);

    const badAction = await api()
      .get('/api/v1/admin/import/audit-logs?action=drop table')
      .set(auth(admin));
    expect(badAction.status).toBe(400);

    for (const path of ['audit-logs', 'documents']) {
      const denied = await api()
        .get(`/api/v1/admin/import/${path}`)
        .set(auth(seller));
      expect(denied.status).toBe(403);
    }
  });

  it('expires overdue listings by server time', async () => {
    const res = await api()
      .post('/api/v1/import/buy')
      .set(auth(customer))
      .send({ ...terms, price: '1000' });
    const id = res.body.data.id as string;
    created.listings.push(id);
    const pub = await api()
      .post(`/api/v1/import/buy/${id}/publish`)
      .set(auth(customer));
    expect(pub.status).toBe(200);

    await prisma.importListing.update({
      where: { id },
      data: { validUntil: new Date(Date.now() - 1000) },
    });
    const read = await api()
      .get(`/api/v1/import/buy/${id}`)
      .set(auth(customer));
    expect(read.body.data.status).toBe('EXPIRED');

    const negotiate = await api()
      .post('/api/v1/import/negotiations')
      .set(auth(seller))
      .send({ listingId: id, price: '1000', quantity: '500' });
    expect(negotiate.status).toBe(409);
    expect(negotiate.body.code).toBe('OFFER_EXPIRED');
  });
});
