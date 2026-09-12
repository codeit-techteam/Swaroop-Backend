import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../decorators/auth.decorators.js';
import { AuthException } from '../exceptions/auth.exception.js';
import { AuthErrorCode } from '../types/auth.types.js';

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
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: { roles?: string[] };
    }>();
    const userRoles = request.user?.roles ?? [];
    const allowed = requiredRoles.some((role) => userRoles.includes(role));

    if (!allowed) {
      throw new AuthException(
        AuthErrorCode.AUTH_FORBIDDEN,
        'Insufficient permissions',
        HttpStatus.FORBIDDEN,
      );
    }

    return true;
  }
}
