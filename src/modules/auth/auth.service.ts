import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import {
  EntityOwnerType,
  OtpIdentifierType,
  OtpPurpose,
  UserStatus,
  type Prisma,
  type User,
} from '../../generated/prisma/client.js';
import { SELLER_OWNER_PERMISSIONS } from '../sellers/managers/seller-access.js';
import { resolveSellerActor } from '../sellers/common/resolve-seller-actor.js';
import { PrismaService } from '../../database/prisma.service.js';
import { RoleCode } from '../../common/enums/domain.enums.js';
import { AuthException } from './exceptions/auth.exception.js';
import { CryptoService } from './services/crypto.service.js';
import {
  DEMO_PHONE_E164,
  DemoBootstrapService,
} from './services/demo-bootstrap.service.js';
import { OtpDeliveryService } from './services/otp-delivery.service.js';
import {
  AuthErrorCode,
  type AuthenticatedUser,
  type AuthTokens,
  type JwtAccessPayload,
  type JwtRefreshPayload,
  type PublicUser,
} from './types/auth.types.js';
import type {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  ResetPasswordDto,
  SendOtpDto,
  VerifyOtpDto,
} from './dto/auth.dto.js';

type RequestMeta = {
  ipAddress?: string;
  userAgent?: string;
  deviceId?: string;
  deviceName?: string;
};

type DbClient = Prisma.TransactionClient | PrismaService;

const DEMO_OTP = '123456';

/**
 * A just-rotated refresh token stays usable briefly so concurrent refreshes
 * (multiple tabs, retried requests, lost responses) don't trip reuse detection
 * and revoke the whole session family.
 */
const REFRESH_REUSE_GRACE_MS = 60_000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly crypto: CryptoService,
    private readonly otpDelivery: OtpDeliveryService,
    private readonly demoBootstrap: DemoBootstrapService,
  ) {}

  async sendOtp(dto: SendOtpDto) {
    const { identifier, identifierType } = this.resolveIdentifier(dto);
    const purpose = (dto.purpose ?? OtpPurpose.LOGIN) as OtpPurpose;
    const cooldown =
      this.configService.get<number>('security.otpResendCooldownSeconds') ?? 60;
    const expiresIn =
      this.configService.get<number>('security.otpExpiresInSeconds') ?? 300;
    const maxAttempts =
      this.configService.get<number>('security.otpMaxAttempts') ?? 5;
    const otpLength = this.configService.get<number>('security.otpLength') ?? 6;
    const useMsg91 =
      identifierType === OtpIdentifierType.PHONE &&
      this.otpDelivery.isMsg91PhoneProvider();

    const recent = await this.prisma.otpVerification.findFirst({
      where: {
        identifier,
        purpose,
        createdAt: { gt: new Date(Date.now() - cooldown * 1000) },
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recent) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(
          (recent.createdAt.getTime() + cooldown * 1000 - Date.now()) / 1000,
        ),
      );
      throw new AuthException(
        AuthErrorCode.AUTH_OTP_RATE_LIMITED,
        'Please wait before requesting another OTP',
        HttpStatus.TOO_MANY_REQUESTS,
        { retryAfterSeconds },
      );
    }

    // Rolling-hour send cap per identifier+purpose (DB-backed so it holds across
    // instances). Protects SMS spend and blocks OTP-bombing / enumeration.
    const maxSendsPerHour =
      this.configService.get<number>('security.otpMaxSendsPerHour') ?? 5;
    const sentLastHour = await this.prisma.otpVerification.count({
      where: {
        identifier,
        purpose,
        createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });
    if (sentLastHour >= maxSendsPerHour) {
      throw new AuthException(
        AuthErrorCode.AUTH_OTP_RATE_LIMITED,
        'Too many OTP requests. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
        { retryAfterSeconds: 3600 },
      );
    }

    await this.prisma.otpVerification.updateMany({
      where: {
        identifier,
        purpose,
        consumedAt: null,
        verifiedAt: null,
      },
      data: { consumedAt: new Date() },
    });

    const user = await this.findUserByIdentifier(identifier, identifierType);

    let otpHash: string;
    let localOtp: string | undefined;

    if (useMsg91) {
      let delivery;
      try {
        delivery = await this.otpDelivery.send({
          identifier,
          identifierType,
          purpose,
        });
      } catch (error) {
        this.logger.error(
          `OTP provider send failed for phone_suffix=${identifier.slice(-4)}`,
          error instanceof Error ? error.message : error,
        );
        throw new AuthException(
          AuthErrorCode.AUTH_OTP_PROVIDER_ERROR,
          'Unable to send OTP right now. Please try again shortly.',
          HttpStatus.BAD_GATEWAY,
        );
      }

      otpHash = this.otpDelivery.encodeMsg91Challenge(
        delivery.providerRequestId ?? `unknown-${Date.now()}`,
      );
    } else {
      const useFixedDevOtp =
        this.isFixedDevOtpEnabled() &&
        identifierType === OtpIdentifierType.PHONE &&
        identifier === DEMO_PHONE_E164;

      localOtp = useFixedDevOtp
        ? DEMO_OTP
        : this.crypto.generateOtp(otpLength);
      otpHash = this.crypto.hashOtp(localOtp);

      try {
        await this.otpDelivery.send({
          identifier,
          identifierType,
          purpose,
          otp: localOtp,
        });
      } catch (error) {
        this.logger.error(
          `OTP delivery failed for ${identifierType}`,
          error instanceof Error ? error.message : error,
        );
        throw new AuthException(
          AuthErrorCode.AUTH_OTP_PROVIDER_ERROR,
          'Unable to send OTP right now. Please try again shortly.',
          HttpStatus.BAD_GATEWAY,
        );
      }
    }

    const challenge = await this.prisma.otpVerification.create({
      data: {
        userId: user?.id,
        identifier,
        identifierType,
        purpose,
        otpHash,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        maxAttempts,
      },
    });

    const expose =
      this.configService.get<boolean>('security.authDevExposeOtp') === true &&
      this.configService.get<string>('app.env') !== 'production' &&
      !useMsg91 &&
      Boolean(localOtp);

    this.logger.log({
      event: 'auth.otp.sent',
      identifierType,
      purpose,
      challengeId: challenge.id,
      provider: useMsg91 ? 'msg91' : 'local',
    });

    return {
      message: 'OTP sent successfully',
      challengeId: challenge.id,
      expiresInSeconds: expiresIn,
      resendCooldownSeconds: cooldown,
      ...(expose ? { devOtp: localOtp } : {}),
    };
  }

  async verifyOtp(dto: VerifyOtpDto, meta: RequestMeta = {}) {
    const { identifier, identifierType } = this.resolveIdentifier(dto);

    // Dev/demo shortcut only when fixed OTP mode is explicitly enabled
    // (disabled whenever AUTH_STRICT_OTP=true or MSG91 provider is active).
    if (
      this.isFixedDevOtpEnabled() &&
      identifierType === OtpIdentifierType.PHONE &&
      identifier === DEMO_PHONE_E164 &&
      dto.otp === DEMO_OTP
    ) {
      return this.issueSessionForIdentifier(
        identifier,
        identifierType,
        dto,
        meta,
      );
    }

    const record = await this.prisma.otpVerification.findFirst({
      where: {
        identifier,
        purpose: dto.purpose as OtpPurpose,
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) {
      throw new AuthException(
        AuthErrorCode.AUTH_INVALID_OTP,
        'Invalid or expired OTP',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (record.expiresAt.getTime() < Date.now()) {
      await this.prisma.otpVerification.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
      throw new AuthException(
        AuthErrorCode.AUTH_OTP_EXPIRED,
        'OTP has expired',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (record.attempts >= record.maxAttempts) {
      throw new AuthException(
        AuthErrorCode.AUTH_OTP_MAX_ATTEMPTS,
        'Maximum OTP attempts exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const isMsg91Challenge = this.otpDelivery.isMsg91Challenge(record.otpHash);

    if (isMsg91Challenge) {
      let providerResult;
      try {
        providerResult = await this.otpDelivery.verifyPhoneWithProvider(
          identifier,
          dto.otp,
        );
      } catch (error) {
        this.logger.error(
          `OTP provider verify failed phone_suffix=${identifier.slice(-4)}`,
          error instanceof Error ? error.message : error,
        );
        throw new AuthException(
          AuthErrorCode.AUTH_OTP_PROVIDER_ERROR,
          'Unable to verify OTP right now. Please try again shortly.',
          HttpStatus.BAD_GATEWAY,
        );
      }

      if (!providerResult.verified) {
        await this.prisma.otpVerification.update({
          where: { id: record.id },
          data: { attempts: { increment: 1 } },
        });

        const expired =
          /expir/i.test(providerResult.message) ||
          /timeout/i.test(providerResult.message);
        throw new AuthException(
          expired
            ? AuthErrorCode.AUTH_OTP_EXPIRED
            : AuthErrorCode.AUTH_INVALID_OTP,
          expired ? 'OTP has expired' : 'Invalid OTP',
          HttpStatus.BAD_REQUEST,
        );
      }
    } else {
      const matches = record.otpHash === this.crypto.hashOtp(dto.otp);
      if (!matches) {
        await this.prisma.otpVerification.update({
          where: { id: record.id },
          data: { attempts: { increment: 1 } },
        });
        throw new AuthException(
          AuthErrorCode.AUTH_INVALID_OTP,
          'Invalid OTP',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const result = await this.prisma.$transaction(async (tx: DbClient) => {
      await tx.otpVerification.update({
        where: { id: record.id },
        data: {
          verifiedAt: new Date(),
          consumedAt: new Date(),
        },
      });

      return this.completeOtpLogin(tx, identifier, identifierType, dto, meta);
    });

    this.logger.log({
      event: 'auth.otp.verified',
      identifierType,
      purpose: dto.purpose,
      userId: result.user.id,
      provider: isMsg91Challenge ? 'msg91' : 'local',
    });

    await this.bootstrapDemoIfNeeded(result.user.id);
    return result;
  }

  async login(dto: LoginDto, meta: RequestMeta = {}) {
    const user = await this.findUserForPasswordLogin(dto);

    if (!user || !user.passwordHash) {
      throw new AuthException(
        AuthErrorCode.AUTH_INVALID_CREDENTIALS,
        'Invalid credentials',
      );
    }

    this.assertUserCanAuthenticate(user);

    const valid = await this.crypto.comparePassword(
      dto.password,
      user.passwordHash,
    );
    if (!valid) {
      throw new AuthException(
        AuthErrorCode.AUTH_INVALID_CREDENTIALS,
        'Invalid credentials',
      );
    }

    await this.assertManagerHasSeller(user.id);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.createSession(user.id, meta);
    await this.bootstrapDemoIfNeeded(user.id);
    const publicUser = await this.toPublicUser(user.id);
    if (publicUser.roles.includes(RoleCode.SELLER_MANAGER)) {
      await this.auditManagerEvent(
        'MANAGER_LOGIN',
        user.id,
        publicUser.sellerId,
      );
    }
    return { user: publicUser, ...tokens };
  }

  async refresh(refreshToken: string, meta: RequestMeta = {}) {
    let payload: JwtRefreshPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtRefreshPayload>(
        refreshToken,
        {
          secret: this.configService.get<string>('security.jwtRefreshSecret'),
        },
      );
    } catch {
      throw new AuthException(
        AuthErrorCode.AUTH_INVALID_REFRESH_TOKEN,
        'Invalid refresh token',
      );
    }

    if (payload.type !== 'refresh') {
      throw new AuthException(
        AuthErrorCode.AUTH_INVALID_REFRESH_TOKEN,
        'Invalid refresh token',
      );
    }

    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sessionId },
    });

    if (!session) {
      throw new AuthException(
        AuthErrorCode.AUTH_INVALID_REFRESH_TOKEN,
        'Invalid refresh token',
      );
    }

    if (session.revokedAt) {
      const rotatedWithinGrace =
        Boolean(session.replacedById) &&
        Date.now() - session.revokedAt.getTime() <= REFRESH_REUSE_GRACE_MS &&
        (await this.crypto.compareRefreshToken(
          refreshToken,
          session.refreshTokenHash,
        ));
      if (!rotatedWithinGrace) {
        // Reuse detection: revoke entire family
        await this.prisma.authSession.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        throw new AuthException(
          AuthErrorCode.AUTH_SESSION_REVOKED,
          'Refresh token reuse detected',
        );
      }
    }

    if (session.expiresAt.getTime() < Date.now()) {
      throw new AuthException(
        AuthErrorCode.AUTH_TOKEN_EXPIRED,
        'Refresh token expired',
      );
    }

    const matches = await this.crypto.compareRefreshToken(
      refreshToken,
      session.refreshTokenHash,
    );
    if (!matches) {
      await this.prisma.authSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new AuthException(
        AuthErrorCode.AUTH_INVALID_REFRESH_TOKEN,
        'Invalid refresh token',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
    });
    if (!user) {
      throw new AuthException(
        AuthErrorCode.AUTH_UNAUTHORIZED,
        'User not found',
      );
    }
    this.assertUserCanAuthenticate(user);

    return this.prisma.$transaction(async (tx: DbClient) => {
      const tokens = await this.createSession(
        user.id,
        meta,
        tx,
        session.familyId,
      );

      await tx.authSession.update({
        where: { id: session.id },
        data: {
          // Keep the original rotation time so the grace window can't be extended.
          revokedAt: session.revokedAt ?? new Date(),
          replacedById: undefined,
        },
      });

      // Link old session to new one if we can find it
      const newest = await tx.authSession.findFirst({
        where: {
          userId: user.id,
          familyId: session.familyId,
          revokedAt: null,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (newest) {
        await tx.authSession.update({
          where: { id: session.id },
          data: { replacedById: newest.id },
        });
      }

      const publicUser = await this.toPublicUser(user.id, tx);
      return { user: publicUser, ...tokens };
    });
  }

  async logout(user: AuthenticatedUser, refreshToken?: string) {
    if (refreshToken) {
      try {
        const payload = await this.jwtService.verifyAsync<JwtRefreshPayload>(
          refreshToken,
          {
            secret: this.configService.get<string>('security.jwtRefreshSecret'),
          },
        );
        await this.prisma.authSession.updateMany({
          where: { id: payload.sessionId, userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      } catch {
        // Still revoke current access session
      }
    }

    await this.prisma.authSession.updateMany({
      where: { id: user.sessionId, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (user.roles.includes(RoleCode.SELLER_MANAGER)) {
      await this.auditManagerEvent('MANAGER_LOGOUT', user.id);
    }

    return { message: 'Logged out successfully' };
  }

  async me(userId: string): Promise<PublicUser> {
    return this.toPublicUser(userId);
  }

  async changePassword(user: AuthenticatedUser, dto: ChangePasswordDto) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
    });
    if (!dbUser?.passwordHash) {
      throw new AuthException(
        AuthErrorCode.AUTH_PASSWORD_MISMATCH,
        'Current password is incorrect',
        HttpStatus.BAD_REQUEST,
      );
    }

    const valid = await this.crypto.comparePassword(
      dto.currentPassword,
      dbUser.passwordHash,
    );
    if (!valid) {
      throw new AuthException(
        AuthErrorCode.AUTH_PASSWORD_MISMATCH,
        'Current password is incorrect',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new AuthException(
        AuthErrorCode.AUTH_PASSWORD_WEAK,
        'New password must be different from current password',
        HttpStatus.BAD_REQUEST,
      );
    }

    const passwordHash = await this.crypto.hashPassword(dto.newPassword);

    await this.prisma.$transaction(async (tx: DbClient) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false },
      });
      await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    if (user.roles.includes(RoleCode.SELLER_MANAGER)) {
      await this.auditManagerEvent('MANAGER_PASSWORD_CHANGED', user.id);
    }

    return { message: 'Password changed successfully. Please sign in again.' };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const { identifier, identifierType } = this.resolveIdentifier(dto);
    const user = await this.findUserByIdentifier(identifier, identifierType);

    // Always return success to avoid account enumeration
    const generic = {
      message:
        'If an account exists for that identifier, password reset instructions have been sent',
    };

    if (!user) {
      return generic;
    }

    const expiresIn =
      this.configService.get<number>(
        'security.passwordResetExpiresInSeconds',
      ) ?? 1800;
    const rawToken = this.crypto.generateSecureToken(32);
    const tokenHash = this.crypto.hashToken(rawToken);

    await this.prisma.$transaction(async (tx: DbClient) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + expiresIn * 1000),
        },
      });
    });

    const expose =
      this.configService.get<boolean>('security.authDevExposeOtp') === true &&
      this.configService.get<string>('app.env') !== 'production';

    this.logger.log(
      `Password reset token created for user ${user.id} via ${identifierType}`,
    );

    return {
      ...generic,
      ...(expose ? { devResetToken: rawToken } : {}),
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = this.crypto.hashToken(dto.token);
    const record = await this.prisma.passwordResetToken.findFirst({
      where: {
        tokenHash,
        usedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!record || record.expiresAt.getTime() < Date.now()) {
      throw new AuthException(
        AuthErrorCode.AUTH_TOKEN_EXPIRED,
        'Invalid or expired reset token',
        HttpStatus.BAD_REQUEST,
      );
    }

    const passwordHash = await this.crypto.hashPassword(dto.newPassword);
    const owner = await this.prisma.user.findUnique({
      where: { id: record.userId },
      select: { status: true, deletedAt: true },
    });
    if (!owner || owner.deletedAt) {
      throw new AuthException(
        AuthErrorCode.AUTH_TOKEN_EXPIRED,
        'Invalid or expired reset token',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.prisma.$transaction(async (tx: DbClient) => {
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) {
        throw new AuthException(
          AuthErrorCode.AUTH_TOKEN_EXPIRED,
          'Invalid or expired reset token',
          HttpStatus.BAD_REQUEST,
        );
      }
      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          // Accepting an invitation activates a pending account. A suspended,
          // blocked, or deactivated account stays closed until an admin acts.
          ...(owner.status === UserStatus.PENDING
            ? { status: UserStatus.ACTIVE }
            : {}),
          mustChangePassword: false,
        },
      });
      await tx.authSession.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    if (record.purpose === 'INVITATION') {
      await this.auditManagerEvent(
        'MANAGER_INVITATION_ACCEPTED',
        record.userId,
      );
      this.logger.log({
        event: 'seller_manager.invitation_accepted',
        userId: record.userId,
      });
    }

    return {
      message:
        owner.status === UserStatus.PENDING ||
        owner.status === UserStatus.ACTIVE
          ? 'Password reset successfully'
          : 'Password saved. This account is not active; contact your administrator.',
    };
  }

  /**
   * Fixed demo OTP (123456 for demo phone) during the development phase.
   * Disabled when AUTH_STRICT_OTP=true (real SMS production lock).
   */
  private isFixedDevOtpEnabled(): boolean {
    if (this.configService.get<boolean>('security.authStrictOtp') === true) {
      return false;
    }
    return this.configService.get<boolean>('security.authDevFixedOtp') === true;
  }

  private async issueSessionForIdentifier(
    identifier: string,
    identifierType: OtpIdentifierType,
    dto: VerifyOtpDto,
    meta: RequestMeta,
  ) {
    const result = await this.prisma.$transaction(async (tx: DbClient) =>
      this.completeOtpLogin(tx, identifier, identifierType, dto, meta),
    );
    await this.bootstrapDemoIfNeeded(result.user.id);
    return result;
  }

  /** Public re-entry for already-logged-in demo users on empty remote DBs. */
  async bootstrapDemo(userId: string) {
    await this.demoBootstrap.ensureForDemoUser(userId);
    return {
      message: 'Demo catalog, HD Film SKR, locations, and profiles are ready',
    };
  }

  private async bootstrapDemoIfNeeded(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !this.demoBootstrap.isDemoUser(user)) return;
    try {
      await this.demoBootstrap.ensureForDemoUser(userId);
    } catch (error) {
      this.logger.error(
        `Demo bootstrap after login failed for ${userId}`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  private async completeOtpLogin(
    tx: DbClient,
    identifier: string,
    identifierType: OtpIdentifierType,
    dto: VerifyOtpDto,
    meta: RequestMeta,
  ) {
    const isDemoPhone =
      identifierType === OtpIdentifierType.PHONE &&
      identifier === DEMO_PHONE_E164;

    let user = await this.findUserByIdentifier(identifier, identifierType, tx);

    if (!user && isDemoPhone) {
      // Also try seeded email account if phone row was never created.
      user = await tx.user.findUnique({
        where: { email: 'customer@test.local' },
      });
    }

    if (!user) {
      if (
        dto.purpose !== OtpPurpose.LOGIN &&
        dto.purpose !== OtpPurpose.SIGNUP
      ) {
        throw new AuthException(
          AuthErrorCode.AUTH_USER_NOT_FOUND,
          'User not found',
          HttpStatus.NOT_FOUND,
        );
      }

      const roleHint = this.normalizeRoleHint(dto.roleHint);
      const roleCodes = isDemoPhone
        ? (['CUSTOMER', 'SELLER'] as const)
        : ([roleHint] as const);

      for (const code of roleCodes) {
        await tx.role.upsert({
          where: { code },
          update: { name: code },
          create: { code, name: code },
        });
      }

      const passwordHash = isDemoPhone
        ? await this.crypto.hashPassword('Test@12345')
        : undefined;

      const signupFirstName = dto.firstName?.trim() || null;

      user = await tx.user.create({
        data: {
          phone: identifierType === OtpIdentifierType.PHONE ? identifier : null,
          email: isDemoPhone
            ? 'customer@test.local'
            : identifierType === OtpIdentifierType.EMAIL
              ? identifier
              : null,
          firstName: isDemoPhone ? 'Karan' : signupFirstName,
          lastName: isDemoPhone ? 'Veer' : null,
          passwordHash,
          status: UserStatus.ACTIVE,
          phoneVerified: identifierType === OtpIdentifierType.PHONE,
          emailVerified:
            identifierType === OtpIdentifierType.EMAIL || isDemoPhone,
          userRoles: {
            create: roleCodes.map((code) => ({
              role: { connect: { code } },
            })),
          },
        },
      });
    } else {
      this.assertUserCanAuthenticate(user);
      if (user.status === UserStatus.PENDING) {
        const pendingManager = await tx.userRole.findFirst({
          where: { userId: user.id, role: { code: RoleCode.SELLER_MANAGER } },
          select: { id: true },
        });
        if (pendingManager) {
          throw new AuthException(
            AuthErrorCode.AUTH_ACCOUNT_PENDING,
            'Activate your Seller Manager account from the invitation link first',
            HttpStatus.FORBIDDEN,
          );
        }
      }
      user = await tx.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          phoneVerified:
            identifierType === OtpIdentifierType.PHONE
              ? true
              : user.phoneVerified,
          emailVerified:
            identifierType === OtpIdentifierType.EMAIL
              ? true
              : user.emailVerified,
          status:
            user.status === UserStatus.PENDING
              ? UserStatus.ACTIVE
              : user.status,
          ...(isDemoPhone && !user.passwordHash
            ? { passwordHash: await this.crypto.hashPassword('Test@12345') }
            : {}),
        },
      });
    }

    const tokens = await this.createSession(user.id, meta, tx);
    const publicUser = await this.toPublicUser(user.id, tx);
    return { user: publicUser, ...tokens };
  }

  private resolveIdentifier(dto: { phone?: string; email?: string }): {
    identifier: string;
    identifierType: OtpIdentifierType;
  } {
    if (dto.phone) {
      return {
        identifier: this.normalizePhoneE164(dto.phone),
        identifierType: OtpIdentifierType.PHONE,
      };
    }
    if (dto.email) {
      return {
        identifier: dto.email.trim().toLowerCase(),
        identifierType: OtpIdentifierType.EMAIL,
      };
    }
    throw new AuthException(
      AuthErrorCode.AUTH_IDENTIFIER_REQUIRED,
      'phone or email is required',
      HttpStatus.BAD_REQUEST,
    );
  }

  /**
   * Normalize Indian mobiles to E.164 (+91XXXXXXXXXX).
   * Accepts +91…, 91…, or bare 10-digit numbers.
   */
  private normalizePhoneE164(raw: string): string {
    const trimmed = raw.trim();
    if (/^\+[1-9]\d{7,14}$/.test(trimmed)) {
      return trimmed;
    }
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length === 10 && /^[6-9]/.test(digits)) {
      return `+91${digits}`;
    }
    if (digits.length === 12 && digits.startsWith('91')) {
      return `+${digits}`;
    }
    if (digits.length >= 8 && digits.length <= 15) {
      return `+${digits}`;
    }
    throw new AuthException(
      AuthErrorCode.AUTH_IDENTIFIER_REQUIRED,
      'phone must be a valid mobile number',
      HttpStatus.BAD_REQUEST,
    );
  }

  private async findUserByIdentifier(
    identifier: string,
    identifierType: OtpIdentifierType,
    client: DbClient = this.prisma,
  ) {
    if (identifierType === OtpIdentifierType.PHONE) {
      return client.user.findUnique({ where: { phone: identifier } });
    }
    return client.user.findUnique({ where: { email: identifier } });
  }

  private assertUserCanAuthenticate(user: User) {
    switch (user.status) {
      case UserStatus.BLOCKED:
        throw new AuthException(
          AuthErrorCode.AUTH_ACCOUNT_BLOCKED,
          'Account is blocked',
          HttpStatus.FORBIDDEN,
        );
      case UserStatus.SUSPENDED:
        throw new AuthException(
          AuthErrorCode.AUTH_ACCOUNT_SUSPENDED,
          'Account is suspended',
          HttpStatus.FORBIDDEN,
        );
      case UserStatus.INACTIVE:
      case UserStatus.DELETED:
        throw new AuthException(
          AuthErrorCode.AUTH_ACCOUNT_DEACTIVATED,
          'Account is deactivated',
          HttpStatus.FORBIDDEN,
        );
      case UserStatus.PENDING:
      case UserStatus.ACTIVE:
        return;
      default:
        throw new AuthException(
          AuthErrorCode.AUTH_UNAUTHORIZED,
          'Account cannot authenticate',
        );
    }
  }

  private normalizeRoleHint(roleHint?: string): string {
    const allowed = new Set<string>([RoleCode.CUSTOMER, RoleCode.SELLER]);
    if (roleHint && allowed.has(roleHint.toUpperCase())) {
      return roleHint.toUpperCase();
    }
    return RoleCode.CUSTOMER;
  }

  private async createSession(
    userId: string,
    meta: RequestMeta,
    client: DbClient = this.prisma,
    familyId: string = randomUUID(),
  ): Promise<AuthTokens> {
    const roles = await client.userRole.findMany({
      where: { userId },
      include: { role: true },
    });
    const roleCodes = roles.map((r: { role: { code: string } }) => r.role.code);

    const sessionId = randomUUID();
    const accessExpiresIn =
      this.configService.get<string>('security.jwtAccessExpiresIn') ?? '15m';
    const refreshExpiresIn =
      this.configService.get<string>('security.jwtRefreshExpiresIn') ?? '30d';

    const accessPayload: JwtAccessPayload = {
      sub: userId,
      sessionId,
      roles: roleCodes,
      type: 'access',
    };
    const refreshPayload: JwtRefreshPayload = {
      sub: userId,
      sessionId,
      familyId,
      type: 'refresh',
    };

    const accessToken = await this.jwtService.signAsync(accessPayload, {
      secret: this.configService.get<string>('security.jwtAccessSecret'),
      expiresIn: accessExpiresIn as `${number}${'s' | 'm' | 'h' | 'd'}`,
    });
    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      secret: this.configService.get<string>('security.jwtRefreshSecret'),
      expiresIn: refreshExpiresIn as `${number}${'s' | 'm' | 'h' | 'd'}`,
    });

    const refreshTokenHash = await this.crypto.hashRefreshToken(refreshToken);
    const refreshMs = this.parseDurationToMs(refreshExpiresIn);

    await client.authSession.create({
      data: {
        id: sessionId,
        userId,
        refreshTokenHash,
        familyId,
        deviceId: meta.deviceId,
        deviceName: meta.deviceName,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        expiresAt: new Date(Date.now() + refreshMs),
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(this.parseDurationToMs(accessExpiresIn) / 1000),
    };
  }

  private async toPublicUser(
    userId: string,
    client: DbClient = this.prisma,
  ): Promise<PublicUser> {
    const user = await client.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        userRoles: { include: { role: true } },
      },
    });

    const roles = user.userRoles.map(
      (ur: { role: { code: string } }) => ur.role.code,
    );
    const actor = await resolveSellerActor(client, user.id);
    const isManager = roles.includes(RoleCode.SELLER_MANAGER);
    const isSeller = roles.includes(RoleCode.SELLER);
    const grants = isManager
      ? await client.userPermissionGrant.findMany({
          where: { userId },
          select: { code: true },
        })
      : [];

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      loginId: user.loginId,
      status: user.status,
      isEmailVerified: user.emailVerified,
      isPhoneVerified: user.phoneVerified,
      mustChangePassword: user.mustChangePassword,
      roles,
      lastLoginAt: user.lastLoginAt,
      sellerId: actor?.profile.id ?? null,
      sellerName: actor?.profile.organization.name ?? null,
      permissions: isManager
        ? grants.map((grant) => grant.code)
        : isSeller
          ? [...SELLER_OWNER_PERMISSIONS]
          : [],
    };
  }

  private async findUserForPasswordLogin(dto: LoginDto) {
    const identifier = dto.identifier?.trim();
    if (identifier) {
      const byLoginId = await this.prisma.user.findUnique({
        where: { loginId: identifier },
      });
      if (byLoginId) return byLoginId;
      if (identifier.includes('@')) {
        return this.prisma.user.findUnique({
          where: { email: identifier.toLowerCase() },
        });
      }
      const digits = identifier.replace(/\D/g, '');
      const phone =
        digits.length === 10
          ? `+91${digits}`
          : identifier.startsWith('+')
            ? identifier
            : null;
      if (phone) {
        return this.prisma.user.findUnique({ where: { phone } });
      }
      return null;
    }

    const email = dto.email?.trim().toLowerCase();
    const phone = dto.phone?.trim();
    if (email) return this.prisma.user.findUnique({ where: { email } });
    if (phone) return this.prisma.user.findUnique({ where: { phone } });
    return null;
  }

  private async assertManagerHasSeller(userId: string) {
    const [managerRole, ownerProfile, assignment] = await Promise.all([
      this.prisma.userRole.findFirst({
        where: { userId, role: { code: RoleCode.SELLER_MANAGER } },
        select: { id: true },
      }),
      this.prisma.sellerProfile.findFirst({
        where: { userId, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.sellerManagerAssignment.findFirst({
        where: {
          userId,
          status: 'ACTIVE',
          sellerProfile: { deletedAt: null },
        },
        select: { id: true },
      }),
    ]);
    if (managerRole && !ownerProfile && !assignment) {
      throw new AuthException(
        AuthErrorCode.AUTH_FORBIDDEN,
        'No active seller is assigned to this account. Contact your administrator.',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private async auditManagerEvent(
    action: string,
    userId: string,
    sellerId?: string | null,
  ) {
    try {
      await this.prisma.auditLog.create({
        data: {
          action,
          actorUserId: userId,
          entityType: EntityOwnerType.USER,
          entityId: userId,
          metadata: sellerId ? { sellerId } : undefined,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to audit ${action} for ${userId}`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  private parseDurationToMs(value: string): number {
    const match = /^(\d+)([smhd])$/.exec(value.trim());
    if (!match) {
      return 15 * 60 * 1000;
    }
    const amount = Number(match[1]);
    const unit = match[2];
    switch (unit) {
      case 's':
        return amount * 1000;
      case 'm':
        return amount * 60 * 1000;
      case 'h':
        return amount * 60 * 60 * 1000;
      case 'd':
        return amount * 24 * 60 * 60 * 1000;
      default:
        return 15 * 60 * 1000;
    }
  }
}
