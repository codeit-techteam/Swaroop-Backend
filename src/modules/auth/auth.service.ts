import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import {
  OtpIdentifierType,
  OtpPurpose,
  UserStatus,
  type Prisma,
  type User,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { RoleCode } from '../../common/enums/domain.enums.js';
import { AuthException } from './exceptions/auth.exception.js';
import { CryptoService } from './services/crypto.service.js';
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

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly crypto: CryptoService,
    private readonly otpDelivery: OtpDeliveryService,
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
      throw new AuthException(
        AuthErrorCode.AUTH_OTP_RATE_LIMITED,
        'Please wait before requesting another OTP',
        HttpStatus.TOO_MANY_REQUESTS,
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

    const demoPhone = '+918240890242';
    const isNonProduction =
      this.configService.get<string>('app.env') !== 'production';
    const useFixedDevOtp =
      isNonProduction &&
      identifierType === OtpIdentifierType.PHONE &&
      identifier === demoPhone;

    const otp = useFixedDevOtp ? '123456' : this.crypto.generateOtp(otpLength);
    const otpHash = this.crypto.hashOtp(otp);
    const user = await this.findUserByIdentifier(identifier, identifierType);

    await this.prisma.otpVerification.create({
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

    await this.otpDelivery.send({
      identifier,
      identifierType,
      purpose,
      otp,
    });

    const expose =
      this.configService.get<boolean>('security.authDevExposeOtp') === true &&
      this.configService.get<string>('app.env') !== 'production';

    return {
      message: 'OTP sent successfully',
      ...(expose ? { devOtp: otp } : {}),
    };
  }

  async verifyOtp(dto: VerifyOtpDto, meta: RequestMeta = {}) {
    const { identifier, identifierType } = this.resolveIdentifier(dto);
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

    const result = await this.prisma.$transaction(async (tx: DbClient) => {
      await tx.otpVerification.update({
        where: { id: record.id },
        data: {
          verifiedAt: new Date(),
          consumedAt: new Date(),
        },
      });

      let user = await this.findUserByIdentifier(
        identifier,
        identifierType,
        tx,
      );

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
        user = await tx.user.create({
          data: {
            phone:
              identifierType === OtpIdentifierType.PHONE ? identifier : null,
            email:
              identifierType === OtpIdentifierType.EMAIL ? identifier : null,
            status: UserStatus.ACTIVE,
            phoneVerified: identifierType === OtpIdentifierType.PHONE,
            emailVerified: identifierType === OtpIdentifierType.EMAIL,
            userRoles: {
              create: {
                role: { connect: { code: roleHint } },
              },
            },
          },
        });
      } else {
        this.assertUserCanAuthenticate(user);
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
          },
        });
      }

      const tokens = await this.createSession(user.id, meta, tx);
      const publicUser = await this.toPublicUser(user.id, tx);
      return { user: publicUser, ...tokens };
    });

    return result;
  }

  async login(dto: LoginDto, meta: RequestMeta = {}) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

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

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.createSession(user.id, meta);
    const publicUser = await this.toPublicUser(user.id);
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
          revokedAt: new Date(),
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
        data: { passwordHash },
      });
      await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

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

    await this.prisma.$transaction(async (tx: DbClient) => {
      await tx.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
      await tx.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          status: UserStatus.ACTIVE,
        },
      });
      await tx.authSession.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    return { message: 'Password reset successfully' };
  }

  private resolveIdentifier(dto: { phone?: string; email?: string }): {
    identifier: string;
    identifierType: OtpIdentifierType;
  } {
    if (dto.phone) {
      return {
        identifier: dto.phone.trim(),
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

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      isEmailVerified: user.emailVerified,
      isPhoneVerified: user.phoneVerified,
      roles: user.userRoles.map(
        (ur: { role: { code: string } }) => ur.role.code,
      ),
      lastLoginAt: user.lastLoginAt,
    };
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
