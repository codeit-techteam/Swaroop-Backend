import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  DocumentCategory,
  DocumentStatus,
  EntityOwnerType,
  StorageProvider,
} from '../src/generated/prisma/client.js';

async function login(app: INestApplication, email: string) {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password: 'Test@12345' });
  expect(response.status).toBe(200);
  return response.body.data.accessToken as string;
}

describe('Documents & Storage (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customerToken: string;
  let sellerToken: string;
  let adminToken: string;
  let customerDocId: string;
  let sellerDocId: string;

  beforeAll(async () => {
    process.env.STORAGE_PROVIDER = 'none';

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
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  it('1. health 200 with storage unconfigured', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.storage).toBe('not_configured');
  });

  it('2. customer creates document metadata (DB OK without R2)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/customer/documents')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        category: DocumentCategory.KYC,
        fileName: 'pan-card.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 12_345,
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.documentNumber).toMatch(/^DOC-\d{4}-\d{6}$/);
    expect(res.body.data.storageProvider).toBe(StorageProvider.NONE);
    expect(res.body.data.uploadUrl).toBeUndefined();
    customerDocId = res.body.data.id;
  });

  it('3. customer download / upload-url → 503 STORAGE_NOT_CONFIGURED', async () => {
    const download = await request(app.getHttpServer())
      .get(`/api/v1/customer/documents/${customerDocId}/download`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(download.status).toBe(503);
    expect(download.body.code).toBe('STORAGE_NOT_CONFIGURED');

    const uploadUrl = await request(app.getHttpServer())
      .get(`/api/v1/customer/documents/${customerDocId}/upload-url`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(uploadUrl.status).toBe(503);
    expect(uploadUrl.body.code).toBe('STORAGE_NOT_CONFIGURED');
  });

  it('4. customer cannot access other customer document', async () => {
    const foreignId = randomUUID();
    const profile = await prisma.customerProfile.findFirst({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    expect(profile).toBeTruthy();

    await prisma.document.create({
      data: {
        id: foreignId,
        documentNumber: `DOC-2099-${Math.floor(Math.random() * 1e6)
          .toString()
          .padStart(6, '0')}`,
        organizationId: profile!.organizationId,
        uploadedById: profile!.userId,
        ownerType: EntityOwnerType.CUSTOMER,
        ownerId: randomUUID(),
        category: DocumentCategory.KYC,
        fileName: 'foreign.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: BigInt(100),
        storageProvider: StorageProvider.NONE,
        storageKey: `customers/other/kyc/${foreignId}/foreign.pdf`,
        status: DocumentStatus.UPLOADED,
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/customer/documents/${foreignId}`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect([403, 404]).toContain(res.status);
  });

  it('5. seller ownership enforced', async () => {
    const upload = await request(app.getHttpServer())
      .post('/api/v1/seller/documents/upload')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        category: DocumentCategory.GST,
        fileName: 'gst.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 2048,
      });
    expect([200, 201]).toContain(upload.status);
    sellerDocId = upload.body.data.id;
    expect(upload.body.data.documentNumber).toMatch(/^DOC-/);

    const denied = await request(app.getHttpServer())
      .get(`/api/v1/seller/documents/${sellerDocId}`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(denied.status).toBe(403);

    const ok = await request(app.getHttpServer())
      .get(`/api/v1/seller/documents/${sellerDocId}`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.id).toBe(sellerDocId);
  });

  it('6. admin list documents 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/documents')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('7. admin reject without reason → 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/documents/${customerDocId}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('8. admin approve → VERIFIED', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/documents/${customerDocId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'Looks good' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(DocumentStatus.VERIFIED);
    expect(res.body.data.approved).toBe(true);
    expect(res.body.data.approvedById).toBeTruthy();
    expect(res.body.data.approvedAt).toBeTruthy();
  });

  it('9. non-admin 403 on admin documents', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/documents')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(403);
  });

  it('10. expiring query 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/documents/expiring?days=30')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.days).toBe(30);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });
});
