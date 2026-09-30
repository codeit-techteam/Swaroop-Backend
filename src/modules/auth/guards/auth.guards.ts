import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../../../database/prisma.service.js';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import {
  SELLER_ACCESS_DENY,
  permissionForManagerRequest,
} from '../../sellers/managers/seller-access.js';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../decorators/auth.decorators.js';
import { AuthException } from '../exceptions/auth.exception.js';
import { AuthErrorCode, type AuthenticatedUser } from '../types/auth.types.js';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest<TUser>(err: Error | null, user: TUser): TUser {
    if (err || !user) {
      throw (
        err ??
        new AuthException(
          AuthErrorCode.AUTH_UNAUTHORIZED,
          'Authentication required',
        )
      );
    }
    return user;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
      method?: string;
      originalUrl?: string;
      url?: string;
    }>();
    const user = request.user;
    const userRoles = user?.roles ?? [];
    const isManager = userRoles.includes(RoleCode.SELLER_MANAGER);
    const isSellerOwner = userRoles.includes(RoleCode.SELLER);
    const allowed = requiredRoles.some(
      (role) =>
        userRoles.includes(role) ||
        (role === RoleCode.SELLER && isManager && !isSellerOwner),
    );

    if (!allowed) {
      throw new AuthException(
        AuthErrorCode.AUTH_FORBIDDEN,
        'Insufficient permissions',
        HttpStatus.FORBIDDEN,
      );
    }

    if (user?.mustChangePassword) {
      throw new AuthException(
        AuthErrorCode.AUTH_FORBIDDEN,
        'Password change required before this account can be used',
        HttpStatus.FORBIDDEN,
      );
    }

    if (isManager && !isSellerOwner && user) {
      await this.assertManagerAccess(user.id, request);
    }

    return true;
  }

  private async assertManagerAccess(
    userId: string,
    request: { method?: string; originalUrl?: string; url?: string },
  ) {
    const needed = permissionForManagerRequest(
      request.method ?? 'GET',
      request.originalUrl ?? request.url ?? '',
    );
    if (needed === SELLER_ACCESS_DENY) {
      throw new AuthException(
        AuthErrorCode.AUTH_FORBIDDEN,
        'Seller Managers cannot access this resource',
        HttpStatus.FORBIDDEN,
      );
    }

    const [assignment, grant] = await Promise.all([
      this.prisma.sellerManagerAssignment.findFirst({
        where: { userId, status: 'ACTIVE' },
        select: { id: true },
      }),
      this.prisma.userPermissionGrant.findFirst({
        where: { userId, code: needed },
        select: { id: true },
      }),
    ]);

    if (!assignment || !grant) {
      throw new AuthException(
        AuthErrorCode.AUTH_FORBIDDEN,
        'You do not have permission for this seller resource',
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
