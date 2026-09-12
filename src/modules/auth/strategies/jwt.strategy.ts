import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../database/prisma.service.js';
import { AuthException } from '../exceptions/auth.exception.js';
import {
  AuthErrorCode,
  type AuthenticatedUser,
  type JwtAccessPayload,
} from '../types/auth.types.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('security.jwtAccessSecret') ??
        configService.get<string>('security.jwtSecret') ??
        '',
    });
  }

  async validate(payload: JwtAccessPayload): Promise<AuthenticatedUser> {
    if (payload.type !== 'access' || !payload.sub || !payload.sessionId) {
      throw new AuthException(
        AuthErrorCode.AUTH_UNAUTHORIZED,
        'Invalid access token',
      );
    }

    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sessionId },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() < Date.now()
    ) {
      throw new AuthException(
        AuthErrorCode.AUTH_SESSION_REVOKED,
        'Session is no longer valid',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        userRoles: {
          include: { role: true },
        },
      },
    });

    if (!user || user.deletedAt) {
      throw new AuthException(
        AuthErrorCode.AUTH_UNAUTHORIZED,
        'User not found',
      );
    }

    if (user.status !== 'ACTIVE') {
      throw new AuthException(
        AuthErrorCode.AUTH_UNAUTHORIZED,
        'Account is not active',
      );
    }

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      isEmailVerified: user.emailVerified,
      isPhoneVerified: user.phoneVerified,
      roles: user.userRoles.map((ur) => ur.role.code),
      sessionId: session.id,
    };
  }
}
