import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';

describe('Auth (e2e)', () => {
  let app: INestApplication;

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
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('logs in admin with password and returns tokens', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.local', password: 'Test@12345' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.accessToken).toBeTruthy();
    expect(response.body.data.refreshToken).toBeTruthy();
    expect(response.body.data.user.roles).toContain('ADMIN');
  });

  it('logs in customer with phone and password', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone: '+918240890242', password: 'Test@12345' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.accessToken).toBeTruthy();
    expect(response.body.data.user.email).toBe('customer@test.local');
    expect(response.body.data.user.roles).toContain('CUSTOMER');
  });

  it('rejects invalid credentials', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.local', password: 'WrongPass1' });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('returns current user for valid access token', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'customer@test.local', password: 'Test@12345' });

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);

    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe('customer@test.local');
    expect(me.body.data.roles).toContain('CUSTOMER');
  });

  it('forbids customer from admin-check', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'customer@test.local', password: 'Test@12345' });

    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/admin-check')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTH_FORBIDDEN');
  });

  it('allows admin on admin-check', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.local', password: 'Test@12345' });

    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/admin-check')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.ok).toBe(true);
  });

  it('rotates refresh tokens and rejects reuse of old refresh token', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'seller@test.local', password: 'Test@12345' });

    const oldRefresh = login.body.data.refreshToken as string;

    const refreshed = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: oldRefresh });

    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.refreshToken).toBeTruthy();
    expect(refreshed.body.data.refreshToken).not.toBe(oldRefresh);

    const reuse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: oldRefresh });

    expect(reuse.status).toBe(401);
    expect(['AUTH_SESSION_REVOKED', 'AUTH_INVALID_REFRESH_TOKEN']).toContain(
      reuse.body.code,
    );
  });

  it('sends and verifies OTP when AUTH_DEV_EXPOSE_OTP is enabled', async () => {
    const phone = `+9199${String(Date.now()).slice(-8)}`;

    const send = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/send')
      .send({ phone, purpose: 'LOGIN' });

    expect(send.status).toBe(200);
    expect(send.body.data.devOtp).toMatch(/^\d{6}$/);

    const verify = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verify')
      .send({
        phone,
        otp: send.body.data.devOtp,
        purpose: 'LOGIN',
        roleHint: 'CUSTOMER',
      });

    expect(verify.status).toBe(200);
    expect(verify.body.data.accessToken).toBeTruthy();
    expect(verify.body.data.user.phone).toBe(phone);

    const reuse = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verify')
      .send({
        phone,
        otp: send.body.data.devOtp,
        purpose: 'LOGIN',
      });

    expect(reuse.status).toBe(400);
  });

  it('logs out and revokes session', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.local', password: 'Test@12345' });

    const logout = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .send({ refreshToken: login.body.data.refreshToken });

    expect(logout.status).toBe(200);

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);

    expect(me.status).toBe(401);
  });

  it('supports forgot and reset password flow in development', async () => {
    const forgot = await request(app.getHttpServer())
      .post('/api/v1/auth/password/forgot')
      .send({ email: 'seller@test.local' });

    expect(forgot.status).toBe(200);
    expect(forgot.body.data.devResetToken).toBeTruthy();

    const reset = await request(app.getHttpServer())
      .post('/api/v1/auth/password/reset')
      .send({
        token: forgot.body.data.devResetToken,
        newPassword: 'Seller@12345',
      });

    expect(reset.status).toBe(200);

    const loginOld = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'seller@test.local', password: 'Test@12345' });
    expect(loginOld.status).toBe(401);

    const loginNew = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'seller@test.local', password: 'Seller@12345' });
    expect(loginNew.status).toBe(200);

    // restore original password for other tests if suite re-runs
    const forgot2 = await request(app.getHttpServer())
      .post('/api/v1/auth/password/forgot')
      .send({ email: 'seller@test.local' });
    await request(app.getHttpServer())
      .post('/api/v1/auth/password/reset')
      .send({
        token: forgot2.body.data.devResetToken,
        newPassword: 'Test@12345',
      });
  });
});
