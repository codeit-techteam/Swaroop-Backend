import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EntityOwnerType,
  KycVerificationStatus,
  KycVerificationType,
  Prisma,
  type KycVerification,
} from '../../../../generated/prisma/client.js';
import { PrismaService } from '../../../../database/prisma.service.js';
import { isUniqueConstraintError } from '../../../documents/common/document-number.js';
import { CustomerAuditService } from '../../common/customer-audit.service.js';
import {
  CustomerContext,
  CustomerContextService,
} from '../../common/customer-context.service.js';
import { readCustomerKycState } from '../customer-kyc.slots.js';
import {
  hashIdentifier,
  isValidGstin,
  isValidPan,
  maskGstin,
  maskPan,
  normalizeIdentifier,
  panFromGstin,
} from './kyc-identifiers.js';
import {
  KycVerificationProvider,
  type KycProviderOutcome,
} from './kyc-verification.provider.js';
import {
  latestVerification,
  toVerificationView,
  verificationSatisfied,
} from './kyc-verification.records.js';

/** A VERIFIED result for the same identifier is reused instead of re-billing the provider. */
const VERIFIED_REUSE_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class CustomerKycVerificationService {
  private readonly inflight = new Map<string, Promise<KycVerification>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly customerContext: CustomerContextService,
    private readonly provider: KycVerificationProvider,
    private readonly audit: CustomerAuditService,
  ) {}

  async verifyPan(userId: string, rawPan: string) {
    const pan = normalizeIdentifier(rawPan);
    if (!isValidPan(pan)) {
      throw new BadRequestException(
        'Enter a valid 10-character PAN (for example ABCDE1234F).',
      );
    }
    const ctx = await this.requireEditableCustomer(userId);
    const view = toVerificationView(
      await this.run(ctx, KycVerificationType.PAN, pan),
    );
    const [gst, organization] = await Promise.all([
      latestVerification(
        this.prisma,
        EntityOwnerType.CUSTOMER,
        ctx.customerProfileId,
        KycVerificationType.GST,
      ),
      this.prisma.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
        select: { gstin: true },
      }),
    ]);
    const gstin = organization.gstin;
    const panMismatch =
      verificationSatisfied(gst) &&
      Boolean(gstin) &&
      gst!.identifierHash === hashIdentifier('GST', gstin!) &&
      panFromGstin(gstin!) !== pan;
    return {
      ...view,
      warning: panMismatch
        ? `Your verified GSTIN (${gst!.identifierMasked}) belongs to a different PAN. Verify the matching PAN or GSTIN before submitting.`
        : null,
    };
  }

  async verifyGst(userId: string, rawGstin: string) {
    const gstin = normalizeIdentifier(rawGstin);
    if (!isValidGstin(gstin)) {
      throw new BadRequestException(
        'Enter a valid 15-character GSTIN. Check for typing mistakes.',
      );
    }
    const ctx = await this.requireEditableCustomer(userId);
    const view = toVerificationView(
      await this.run(ctx, KycVerificationType.GST, gstin),
    );
    const pan = await latestVerification(
      this.prisma,
      EntityOwnerType.CUSTOMER,
      ctx.customerProfileId,
      KycVerificationType.PAN,
    );
    const panMismatch =
      verificationSatisfied(pan) &&
      pan!.identifierHash !== hashIdentifier('PAN', panFromGstin(gstin));
    return {
      ...view,
      warning: panMismatch
        ? `This GSTIN is not registered to your verified PAN (${pan!.identifierMasked}). Verify the matching PAN or GSTIN before submitting.`
        : null,
    };
  }

  private async requireEditableCustomer(userId: string) {
    const ctx = await this.customerContext.getOrCreateCustomer(userId);
    const profile = await this.prisma.customerProfile.findUniqueOrThrow({
      where: { id: ctx.customerProfileId },
      select: { metadata: true },
    });
    const { status } = readCustomerKycState(profile.metadata);
    if (status === 'SUBMITTED') {
      throw new BadRequestException(
        'Your KYC is under review. PAN and GST details cannot be changed until the review is complete.',
      );
    }
    if (status === 'APPROVED') {
      throw new BadRequestException(
        'Your KYC is already approved. Contact support to change PAN or GST details.',
      );
    }
    return ctx;
  }

  /** Concurrent calls for the same customer and identifier share one provider request. */
  private run(
    ctx: CustomerContext,
    type: KycVerificationType,
    identifier: string,
  ): Promise<KycVerification> {
    const key = `${type}:${ctx.customerProfileId}:${identifier}`;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const task = this.execute(ctx, type, identifier).finally(() =>
      this.inflight.delete(key),
    );
    this.inflight.set(key, task);
    return task;
  }

  private async execute(
    ctx: CustomerContext,
    type: KycVerificationType,
    identifier: string,
  ): Promise<KycVerification> {
    const kind = type === KycVerificationType.PAN ? 'PAN' : 'GST';
    const identifierHash = hashIdentifier(kind, identifier);
    const identifierMasked =
      type === KycVerificationType.PAN
        ? maskPan(identifier)
        : maskGstin(identifier);

    const reusable = await this.reusableResult(ctx, type, identifierHash);
    if (reusable) {
      await this.applyToOrganization(ctx, reusable, identifier);
      return reusable;
    }

    let row: KycVerification;
    try {
      row = await this.prisma.kycVerification.create({
        data: {
          organizationId: ctx.organizationId,
          ownerType: EntityOwnerType.CUSTOMER,
          ownerId: ctx.customerProfileId,
          type,
          status: KycVerificationStatus.VERIFYING,
          identifierHash,
          identifierMasked,
          provider: this.provider.providerName(kind),
          requestedById: ctx.userId,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(
          `${kind === 'PAN' ? 'PAN' : 'GST'} verification is already in progress. Please wait a moment.`,
        );
      }
      throw error;
    }

    await this.log(ctx, `CUSTOMER_KYC_${kind}_VERIFICATION_STARTED`, row);

    let outcome: KycProviderOutcome;
    try {
      outcome = await this.provider.verify(kind, identifier);
    } catch {
      outcome = {
        outcome: 'UNAVAILABLE',
        code: 'PROVIDER_ERROR',
        reason: 'The verification service returned an unexpected response.',
      };
    }

    const updated = await this.prisma.kycVerification.update({
      where: { id: row.id },
      data: this.outcomeData(outcome),
    });
    await this.applyToOrganization(ctx, updated, identifier);
    await this.log(ctx, this.outcomeAction(kind, updated.status), updated);
    return updated;
  }

  /**
   * Returns a recent VERIFIED row for the same identifier, and clears VERIFYING
   * rows left behind by a crashed request so they stop blocking new attempts.
   */
  private async reusableResult(
    ctx: CustomerContext,
    type: KycVerificationType,
    identifierHash: string,
  ): Promise<KycVerification | null> {
    const latest = await latestVerification(
      this.prisma,
      EntityOwnerType.CUSTOMER,
      ctx.customerProfileId,
      type,
    );
    if (!latest) return null;
    const ageMs = Date.now() - latest.createdAt.getTime();

    if (latest.status === KycVerificationStatus.VERIFYING) {
      const timeoutMs =
        this.config.get<number>('kyc.requestTimeoutMs') ?? 10_000;
      if (ageMs < timeoutMs * 3) {
        throw new ConflictException(
          'Verification is already in progress. Please wait a moment.',
        );
      }
      await this.prisma.kycVerification.update({
        where: { id: latest.id },
        data: {
          status: KycVerificationStatus.FAILED,
          failureCode: 'ABANDONED',
          failureReason: 'Verification was interrupted. Please verify again.',
        },
      });
      return null;
    }

    if (
      latest.status === KycVerificationStatus.VERIFIED &&
      latest.identifierHash === identifierHash &&
      ageMs < VERIFIED_REUSE_MS
    ) {
      return latest;
    }
    return null;
  }

  private outcomeData(
    outcome: KycProviderOutcome,
  ): Prisma.KycVerificationUpdateInput {
    switch (outcome.outcome) {
      case 'VERIFIED':
        return {
          status: KycVerificationStatus.VERIFIED,
          verifiedAt: new Date(),
          result: outcome.details as Prisma.InputJsonValue,
        };
      case 'FAILED':
        return {
          status: KycVerificationStatus.FAILED,
          failureCode: outcome.code,
          failureReason: outcome.reason,
          result: (outcome.details ?? undefined) as
            Prisma.InputJsonValue | undefined,
        };
      case 'UNAVAILABLE':
        return {
          status: KycVerificationStatus.MANUAL_REVIEW,
          failureCode: outcome.code,
          failureReason: outcome.reason,
        };
      case 'NOT_CONFIGURED':
        return {
          status: KycVerificationStatus.MANUAL_REVIEW,
          failureCode: 'PROVIDER_NOT_CONFIGURED',
          failureReason: 'Automatic verification is not configured.',
        };
    }
  }

  private outcomeAction(kind: 'PAN' | 'GST', status: KycVerificationStatus) {
    switch (status) {
      case KycVerificationStatus.VERIFIED:
        return `CUSTOMER_KYC_${kind}_VERIFIED`;
      case KycVerificationStatus.FAILED:
        return `CUSTOMER_KYC_${kind}_VERIFICATION_FAILED`;
      default:
        return `CUSTOMER_KYC_${kind}_MANUAL_REVIEW`;
    }
  }

  /** Only accepted identifiers are written onto the organization record. */
  private async applyToOrganization(
    ctx: CustomerContext,
    row: KycVerification,
    identifier: string,
  ) {
    if (!verificationSatisfied(row)) return;
    if (row.type === KycVerificationType.PAN) {
      await this.prisma.organization.update({
        where: { id: ctx.organizationId },
        data: { pan: identifier },
      });
      return;
    }
    const legalName =
      row.status === KycVerificationStatus.VERIFIED
        ? toVerificationView(row).details.legalName
        : null;
    await this.prisma.organization.update({
      where: { id: ctx.organizationId },
      data: { gstin: identifier, ...(legalName ? { legalName } : {}) },
    });
  }

  private log(ctx: CustomerContext, action: string, row: KycVerification) {
    return this.audit.log({
      action,
      actorUserId: ctx.userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.CUSTOMER,
      entityId: ctx.customerProfileId,
      metadata: {
        actorRole: 'CUSTOMER',
        verificationId: row.id,
        type: row.type,
        identifier: row.identifierMasked,
        provider: row.provider,
        status: row.status,
        failureCode: row.failureCode,
      },
    });
  }
}
