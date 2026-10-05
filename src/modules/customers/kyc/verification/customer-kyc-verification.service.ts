import { BadRequestException, Injectable } from '@nestjs/common';
import {
  EntityOwnerType,
  KycVerificationStatus,
  KycVerificationType,
  type KycVerification,
} from '../../../../generated/prisma/client.js';
import { PrismaService } from '../../../../database/prisma.service.js';
import {
  isValidGstin,
  isValidPan,
  normalizeIdentifier,
  normalizePanHolder,
  panHolderProblem,
} from '../../../kyc-verification/kyc-identifiers.js';
import {
  hasPanGstMismatch,
  latestVerification,
  toVerificationView,
  verificationSatisfied,
} from '../../../kyc-verification/kyc-verification.records.js';
import {
  KycVerificationService,
  type KycOwner,
} from '../../../kyc-verification/kyc-verification.service.js';
import type { KycRequestMeta } from '../../../kyc-verification/kyc-verification.types.js';
import {
  CustomerContext,
  CustomerContextService,
} from '../../common/customer-context.service.js';
import { readCustomerKycState } from '../customer-kyc.slots.js';

@Injectable()
export class CustomerKycVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerContext: CustomerContextService,
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
    const ctx = await this.requireEditableCustomer(userId);
    const row = await this.verification.verify(
      this.owner(ctx),
      KycVerificationType.PAN,
      pan,
      meta,
      holder,
    );
    await this.applyToOrganization(ctx, row, pan);

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
    const mismatch = hasPanGstMismatch(row, gst, organization.gstin);
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
    const ctx = await this.requireEditableCustomer(userId);
    const row = await this.verification.verify(
      this.owner(ctx),
      KycVerificationType.GST,
      gstin,
      meta,
    );
    await this.applyToOrganization(ctx, row, gstin);

    const pan = await latestVerification(
      this.prisma,
      EntityOwnerType.CUSTOMER,
      ctx.customerProfileId,
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

  private owner(ctx: CustomerContext): KycOwner {
    return {
      ownerType: EntityOwnerType.CUSTOMER,
      ownerId: ctx.customerProfileId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
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
}
