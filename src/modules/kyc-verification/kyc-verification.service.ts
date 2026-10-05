import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EntityOwnerType,
  KycVerificationStatus,
  KycVerificationType,
  Prisma,
  type KycVerification,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { isUniqueConstraintError } from '../documents/common/document-number.js';
import { NotificationService } from '../notifications/notification.service.js';
import {
  hashIdentifier,
  maskGstin,
  maskPan,
  panFromGstin,
} from './kyc-identifiers.js';
import { KycVerificationProvider } from './kyc-verification.provider.js';
import { latestVerification } from './kyc-verification.records.js';
import type {
  KycProviderOutcome,
  KycRequestMeta,
} from './kyc-verification.types.js';

/** A VERIFIED result for the same identifier is reused instead of re-billing the provider. */
const VERIFIED_REUSE_MS = 30 * 24 * 60 * 60 * 1000;

/** The customer or seller profile a verification belongs to, resolved from the JWT. */
export type KycOwner = {
  ownerType: typeof EntityOwnerType.CUSTOMER | typeof EntityOwnerType.SELLER;
  ownerId: string;
  organizationId: string;
  userId: string;
};

const ROLE_BY_OWNER = {
  [EntityOwnerType.CUSTOMER]: 'CUSTOMER',
  [EntityOwnerType.SELLER]: 'SELLER',
} as const;

/**
 * Provider-agnostic PAN / GSTIN verification shared by customer KYC and
 * seller onboarding. Callers validate the identifier format and ownership;
 * this service dedupes concurrent requests, calls the provider, persists the
 * normalized result and writes the audit trail.
 */
@Injectable()
export class KycVerificationService {
  private readonly logger = new Logger(KycVerificationService.name);
  private readonly inflight = new Map<string, Promise<KycVerification>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly provider: KycVerificationProvider,
    private readonly notifications: NotificationService,
  ) {}

  /** Concurrent calls for the same owner and identifier share one provider request. */
  verify(
    owner: KycOwner,
    type: KycVerificationType,
    identifier: string,
    meta: KycRequestMeta = {},
  ): Promise<KycVerification> {
    const key = `${owner.ownerType}:${type}:${owner.ownerId}:${identifier}`;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const task = this.execute(owner, type, identifier, meta).finally(() =>
      this.inflight.delete(key),
    );
    this.inflight.set(key, task);
    return task;
  }

  private async execute(
    owner: KycOwner,
    type: KycVerificationType,
    identifier: string,
    meta: KycRequestMeta,
  ): Promise<KycVerification> {
    const kind = type === KycVerificationType.PAN ? 'PAN' : 'GST';
    const identifierHash = hashIdentifier(kind, identifier);

    const reusable = await this.reusableResult(owner, type, identifierHash);
    if (reusable) return reusable;

    let row: KycVerification;
    try {
      row = await this.prisma.kycVerification.create({
        data: {
          organizationId: owner.organizationId,
          ownerType: owner.ownerType,
          ownerId: owner.ownerId,
          type,
          status: KycVerificationStatus.VERIFYING,
          identifierHash,
          identifierMasked:
            kind === 'PAN' ? maskPan(identifier) : maskGstin(identifier),
          provider: this.provider.providerName(kind),
          requestedById: owner.userId,
          source: meta.source ?? null,
          requestId: meta.requestId ?? null,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(
          `${kind} verification is already in progress. Please wait a moment.`,
        );
      }
      throw error;
    }

    await this.log(owner, `${kind}_VERIFICATION_STARTED`, row, meta);

    let outcome: KycProviderOutcome;
    try {
      outcome = await this.provider.verify(kind, identifier);
    } catch (error) {
      this.logger.error(
        `${kind} verification provider threw: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      outcome = {
        outcome: 'UNAVAILABLE',
        code: 'PROVIDER_ERROR',
        reason: 'The verification service returned an unexpected response.',
      };
    }

    const updated = await this.prisma.kycVerification.update({
      where: { id: row.id },
      data: {
        ...this.outcomeData(outcome),
        ...(type === KycVerificationType.GST
          ? { linkedPanHash: this.linkedPanHash(outcome, identifier) }
          : {}),
      },
    });
    await this.log(
      owner,
      this.outcomeAction(kind, updated.status),
      updated,
      meta,
    );
    if (updated.status === KycVerificationStatus.VERIFIED) {
      await this.notifyVerified(owner, updated);
    }
    return updated;
  }

  /** GSTIN characters 3–12 are the PAN; the provider's value wins when it returns one. */
  private linkedPanHash(outcome: KycProviderOutcome, gstin: string): string {
    const providerPan =
      outcome.outcome === 'VERIFIED' ? outcome.linkedPan : null;
    return hashIdentifier('PAN', providerPan ?? panFromGstin(gstin));
  }

  /**
   * Returns a recent VERIFIED row for the same identifier, and clears VERIFYING
   * rows left behind by a crashed request so they stop blocking new attempts.
   */
  private async reusableResult(
    owner: KycOwner,
    type: KycVerificationType,
    identifierHash: string,
  ): Promise<KycVerification | null> {
    const latest = await latestVerification(
      this.prisma,
      owner.ownerType,
      owner.ownerId,
      type,
    );
    if (!latest) return null;
    const ageMs = Date.now() - latest.createdAt.getTime();

    if (latest.status === KycVerificationStatus.VERIFYING) {
      const timeoutMs =
        this.config.get<number>('kyc.requestTimeoutMs') ?? 10_000;
      // Provider calls can be retried once, so allow for two timeouts plus slack.
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
          providerReference: outcome.referenceId ?? null,
        };
      case 'FAILED':
        return {
          status: KycVerificationStatus.FAILED,
          failureCode: outcome.code,
          failureReason: outcome.reason,
          result: (outcome.details ?? undefined) as
            Prisma.InputJsonValue | undefined,
          providerReference: outcome.referenceId ?? null,
        };
      case 'REVIEW':
        return {
          status: KycVerificationStatus.MANUAL_REVIEW,
          failureCode: outcome.code,
          failureReason: outcome.reason,
          result: outcome.details as Prisma.InputJsonValue,
          providerReference: outcome.referenceId ?? null,
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
        return `${kind}_VERIFIED`;
      case KycVerificationStatus.FAILED:
        return `${kind}_VERIFICATION_FAILED`;
      default:
        return `${kind}_MANUAL_REVIEW`;
    }
  }

  private async notifyVerified(owner: KycOwner, row: KycVerification) {
    const label = row.type === KycVerificationType.PAN ? 'PAN' : 'GSTIN';
    try {
      await this.notifications.create({
        userId: owner.userId,
        organizationId: owner.organizationId,
        title: `${label} verified`,
        body: `${label} ${row.identifierMasked} was verified successfully.`,
        entityType: owner.ownerType,
        entityId: owner.ownerId,
        metadata: { type: `${row.type}_VERIFIED`, verificationId: row.id },
      });
    } catch (error) {
      this.logger.warn(
        `Could not create ${label} verified notification: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  /** Audit rows carry only the masked identifier, never the raw PAN / GSTIN. */
  private async log(
    owner: KycOwner,
    suffix: string,
    row: KycVerification,
    meta: KycRequestMeta,
  ) {
    const role = ROLE_BY_OWNER[owner.ownerType];
    await this.prisma.auditLog.create({
      data: {
        action: `${role}_KYC_${suffix}`,
        actorUserId: owner.userId,
        organizationId: owner.organizationId,
        entityType: owner.ownerType,
        entityId: owner.ownerId,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent?.slice(0, 512) ?? null,
        metadata: {
          actorRole: role,
          verificationId: row.id,
          type: row.type,
          identifier: row.identifierMasked,
          provider: row.provider,
          providerReference: row.providerReference,
          status: row.status,
          failureCode: row.failureCode,
          source: meta.source ?? null,
          requestId: meta.requestId ?? null,
        },
      },
    });
  }
}
