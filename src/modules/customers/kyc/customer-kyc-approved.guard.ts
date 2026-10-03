import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  isCustomerKycVerified,
  readCustomerKycState,
} from './customer-kyc.slots.js';

/**
 * Blocks trading actions until the customer's KYC is approved, when
 * KYC_ENFORCE_FOR_TRADING is on. Must run after JwtAuthGuard.
 */
@Injectable()
export class CustomerKycApprovedGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.config.get<boolean>('kyc.enforceForTrading')) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: { id?: string } }>();
    const userId = request.user?.id;
    if (!userId) return true;

    const profile = await this.prisma.customerProfile.findFirst({
      where: { userId, deletedAt: null },
      select: {
        metadata: true,
        organization: { select: { verificationStatus: true } },
      },
    });
    const status = readCustomerKycState(profile?.metadata).status;
    if (
      profile &&
      isCustomerKycVerified(status, profile.organization.verificationStatus)
    ) {
      return true;
    }
    throw new ForbiddenException({
      message:
        status === 'SUBMITTED'
          ? 'Your Business KYC is under review. You can trade once it is approved.'
          : 'Complete Business KYC and get it approved before placing purchase requests.',
      error: 'KYC_NOT_APPROVED',
    });
  }
}
