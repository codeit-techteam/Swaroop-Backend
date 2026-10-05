import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  EntityOwnerType,
  KycVerificationStatus,
  KycVerificationType,
  Prisma,
  SellerOnboardingStatus,
  type KycVerification,
  type SellerOnboarding,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  isValidGstin,
  isValidPan,
  normalizeIdentifier,
  normalizePanHolder,
  panHolderProblem,
} from '../../kyc-verification/kyc-identifiers.js';
import {
  hasPanGstMismatch,
  identityVerificationBlockers,
  latestVerification,
  latestVerifications,
  toVerificationView,
  verificationLabel,
  verificationSatisfied,
} from '../../kyc-verification/kyc-verification.records.js';
import {
  KycVerificationService,
  type KycOwner,
} from '../../kyc-verification/kyc-verification.service.js';
import type { KycRequestMeta } from '../../kyc-verification/kyc-verification.types.js';
import {
  SellerContext,
  SellerContextService,
} from '../common/seller-context.service.js';
import { resolveSellerActor } from '../common/resolve-seller-actor.js';
import { readJsonObject } from './onboarding-documents.slots.js';

const LOCKED_ONBOARDING_STATUSES = new Set<SellerOnboardingStatus>([
  SellerOnboardingStatus.SUBMITTED,
  SellerOnboardingStatus.UNDER_REVIEW,
  SellerOnboardingStatus.APPROVED,
]);

/** Keys in gstData / panData that only the server may set. */
const SERVER_OWNED_KEYS = ['status', 'gstStatus', 'panStatus', 'verified'];

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? normalizeIdentifier(value)
    : null;
}

/** PAN / GSTIN verification for seller onboarding (Seller App and Seller Web). */
@Injectable()
export class SellerKycVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellerContext: SellerContextService,
    private readonly verification: KycVerificationService,
  ) {}

  async verifyPan(
    userId: string,
    rawPan: string,
    holderInput: { fullName: string; dob: string },
    meta: KycRequestMeta = {},
  ) {
    const pan = normalizeIdentifier(rawPan);
    if (!isValidPan(pan)) {
      throw new BadRequestException(
        'Enter a valid 10-character PAN (for example ABCDE1234F).',
      );
    }
    const holder = normalizePanHolder(holderInput.fullName, holderInput.dob);
    const holderProblem = panHolderProblem(holder);
    if (holderProblem) throw new BadRequestException(holderProblem);
    const { ctx, onboarding } = await this.requireEditableSeller(userId);
    const row = await this.verification.verify(
      this.owner(ctx),
      KycVerificationType.PAN,
      pan,
      meta,
      holder,
    );
    await this.applyToOnboarding(onboarding, row, pan);

    const gst = await latestVerification(
      this.prisma,
      EntityOwnerType.SELLER,
      ctx.sellerProfileId,
      KycVerificationType.GST,
    );
    const gstin = str(readJsonObject(onboarding.gstData).gstin);
    const mismatch = hasPanGstMismatch(row, gst, gstin);
    return {
      ...toVerificationView(row),
      mismatch,
      warning: mismatch
        ? `GST/PAN mismatch: your verified GSTIN (${gst!.identifierMasked}) belongs to a different PAN. Verify the matching PAN or GSTIN before submitting.`
        : null,
    };
  }

  async verifyGst(userId: string, rawGstin: string, meta: KycRequestMeta = {}) {
    const gstin = normalizeIdentifier(rawGstin);
    if (!isValidGstin(gstin)) {
      throw new BadRequestException(
        'Enter a valid 15-character GSTIN. Check for typing mistakes.',
      );
    }
    const { ctx, onboarding } = await this.requireEditableSeller(userId);
    const row = await this.verification.verify(
      this.owner(ctx),
      KycVerificationType.GST,
      gstin,
      meta,
    );
    await this.applyToOnboarding(onboarding, row, gstin);

    const pan = await latestVerification(
      this.prisma,
      EntityOwnerType.SELLER,
      ctx.sellerProfileId,
      KycVerificationType.PAN,
    );
    const mismatch = hasPanGstMismatch(pan, row, gstin);
    return {
      ...toVerificationView(row),
      mismatch,
      warning: mismatch
        ? `GST/PAN mismatch: this GSTIN is not registered to your verified PAN (${pan!.identifierMasked}). Verify the matching PAN or GSTIN before submitting.`
        : null,
    };
  }

  /** Latest attempts plus the blockers for the PAN / GSTIN currently in the onboarding draft. */
  async summary(
    sellerProfileId: string,
    onboarding: Pick<SellerOnboarding, 'gstData' | 'panData'> | null,
  ) {
    const latest = await latestVerifications(
      this.prisma,
      EntityOwnerType.SELLER,
      sellerProfileId,
    );
    const current = {
      pan: str(readJsonObject(onboarding?.panData).pan),
      gstin: str(readJsonObject(onboarding?.gstData).gstin),
    };
    return {
      pan: latest.pan ? toVerificationView(latest.pan) : null,
      gst: latest.gst ? toVerificationView(latest.gst) : null,
      mismatch: hasPanGstMismatch(latest.pan, latest.gst, current.gstin),
      blockers: identityVerificationBlockers(latest, current),
    };
  }

  /**
   * Drops verification flags a client tried to set and re-derives them from
   * the latest verification of the identifier actually being saved.
   */
  async withServerVerificationFields(
    sellerProfileId: string,
    sections: {
      gstData?: Record<string, unknown>;
      panData?: Record<string, unknown>;
    },
  ) {
    const latest = await latestVerifications(
      this.prisma,
      EntityOwnerType.SELLER,
      sellerProfileId,
    );
    const clean = (
      section: Record<string, unknown> | undefined,
      kind: 'PAN' | 'GST',
      key: 'pan' | 'gstin',
      row: KycVerification | null,
    ) => {
      if (!section) return undefined;
      const result = Object.fromEntries(
        Object.entries(section).filter(([k]) => !SERVER_OWNED_KEYS.includes(k)),
      );
      return { ...result, status: verificationLabel(row, kind, result[key]) };
    };
    return {
      gstData: clean(sections.gstData, 'GST', 'gstin', latest.gst),
      panData: clean(sections.panData, 'PAN', 'pan', latest.pan),
    };
  }

  private owner(ctx: SellerContext): KycOwner {
    return {
      ownerType: EntityOwnerType.SELLER,
      ownerId: ctx.sellerProfileId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
    };
  }

  /** Only the seller account owner verifies identifiers, and only before submission. */
  private async requireEditableSeller(userId: string) {
    const actor = await resolveSellerActor(this.prisma, userId);
    if (actor?.kind === 'MANAGER') {
      throw new ForbiddenException(
        'Only the seller account owner can verify PAN and GST details.',
      );
    }
    const ctx = await this.sellerContext.getOrCreateDraftSeller(userId);
    const onboarding = await this.prisma.sellerOnboarding.upsert({
      where: { sellerProfileId: ctx.sellerProfileId },
      update: {},
      create: {
        sellerProfileId: ctx.sellerProfileId,
        status: SellerOnboardingStatus.IN_PROGRESS,
        currentStep: 'company',
        completedSteps: [],
      },
    });
    if (LOCKED_ONBOARDING_STATUSES.has(onboarding.status)) {
      throw new BadRequestException(
        onboarding.status === SellerOnboardingStatus.APPROVED
          ? 'Your seller account is already approved. Contact support to change PAN or GST details.'
          : 'Your onboarding is under review. PAN and GST details cannot be changed until the review is complete.',
      );
    }
    return { ctx, onboarding };
  }

  /** Accepted identifiers are written into the onboarding draft by the server. */
  private async applyToOnboarding(
    onboarding: SellerOnboarding,
    row: KycVerification,
    identifier: string,
  ) {
    if (!verificationSatisfied(row)) return;
    const fresh = await this.prisma.sellerOnboarding.findUniqueOrThrow({
      where: { id: onboarding.id },
      select: { gstData: true, panData: true },
    });
    const status =
      row.status === KycVerificationStatus.VERIFIED
        ? 'verified'
        : 'manual_review';
    if (row.type === KycVerificationType.PAN) {
      await this.prisma.sellerOnboarding.update({
        where: { id: onboarding.id },
        data: {
          panData: {
            ...readJsonObject(fresh.panData),
            pan: identifier,
            status,
          } as Prisma.InputJsonValue,
        },
      });
      return;
    }
    const details = toVerificationView(row).details;
    await this.prisma.sellerOnboarding.update({
      where: { id: onboarding.id },
      data: {
        gstData: {
          ...readJsonObject(fresh.gstData),
          gstin: identifier,
          status,
          ...(details.legalName ? { legalName: details.legalName } : {}),
          ...(details.state ? { state: details.state } : {}),
          ...(details.stateCode ? { stateCode: details.stateCode } : {}),
        } as Prisma.InputJsonValue,
      },
    });
  }
}
