import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EntityOwnerType,
  OrganizationStatus,
  Prisma,
  SellerOnboardingStatus,
  SellerStatus,
  VerificationStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { SellerAuditService } from '../common/seller-audit.service.js';
import { SellerContextService } from '../common/seller-context.service.js';
import { OnboardingDocumentsService } from './onboarding-documents.service.js';
import type {
  CreateOnboardingDto,
  UpdateOnboardingDto,
} from './onboarding.dto.js';

function hasValue(
  obj: Record<string, unknown> | null | undefined,
  key: string,
) {
  const v = obj?.[key];
  return typeof v === 'string' ? v.trim().length > 0 : v != null;
}

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellerContext: SellerContextService,
    private readonly audit: SellerAuditService,
    private readonly onboardingDocuments: OnboardingDocumentsService,
  ) {}

  async create(
    userId: string,
    dto: CreateOnboardingDto,
    user?: { email?: string | null; phone?: string | null },
  ) {
    const ctx = await this.sellerContext.getOrCreateDraftSeller(userId, {
      companyName: dto.companyName,
      email: dto.email ?? user?.email,
      phone: dto.phone ?? user?.phone,
    });

    const onboarding = await this.prisma.sellerOnboarding.upsert({
      where: { sellerProfileId: ctx.sellerProfileId },
      update: {
        status: SellerOnboardingStatus.IN_PROGRESS,
        currentStep: dto.currentStep ?? 'company',
        companyData: (dto.companyData ?? undefined) as Prisma.InputJsonValue,
        businessData: (dto.businessData ?? undefined) as Prisma.InputJsonValue,
        gstData: (dto.gstData ?? undefined) as Prisma.InputJsonValue,
        panData: (dto.panData ?? undefined) as Prisma.InputJsonValue,
        bankData: (dto.bankData ?? undefined) as Prisma.InputJsonValue,
        addressData: (dto.addressData ?? undefined) as Prisma.InputJsonValue,
        locationData: (dto.locationData ?? undefined) as Prisma.InputJsonValue,
        completedSteps: (dto.completedSteps ?? []) as Prisma.InputJsonValue,
        metadata: (dto.metadata ?? undefined) as Prisma.InputJsonValue,
      },
      create: {
        sellerProfileId: ctx.sellerProfileId,
        status: SellerOnboardingStatus.IN_PROGRESS,
        currentStep: dto.currentStep ?? 'company',
        companyData: (dto.companyData ?? undefined) as Prisma.InputJsonValue,
        businessData: (dto.businessData ?? undefined) as Prisma.InputJsonValue,
        gstData: (dto.gstData ?? undefined) as Prisma.InputJsonValue,
        panData: (dto.panData ?? undefined) as Prisma.InputJsonValue,
        bankData: (dto.bankData ?? undefined) as Prisma.InputJsonValue,
        addressData: (dto.addressData ?? undefined) as Prisma.InputJsonValue,
        locationData: (dto.locationData ?? undefined) as Prisma.InputJsonValue,
        completedSteps: (dto.completedSteps ?? []) as Prisma.InputJsonValue,
        metadata: (dto.metadata ?? undefined) as Prisma.InputJsonValue,
      },
    });

    await this.audit.log({
      action: 'SELLER_ONBOARDING_STARTED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.SELLER,
      entityId: ctx.sellerProfileId,
    });

    return onboarding;
  }

  async get(userId: string) {
    const ctx = await this.sellerContext.requireSeller(userId);
    const onboarding = await this.prisma.sellerOnboarding.findUnique({
      where: { sellerProfileId: ctx.sellerProfileId },
    });
    if (!onboarding) throw new NotFoundException('Onboarding not found');
    return onboarding;
  }

  async update(userId: string, dto: UpdateOnboardingDto) {
    const ctx = await this.sellerContext.requireSeller(userId);
    const existing = await this.get(userId);

    if (
      existing.status === SellerOnboardingStatus.SUBMITTED ||
      existing.status === SellerOnboardingStatus.UNDER_REVIEW ||
      existing.status === SellerOnboardingStatus.APPROVED
    ) {
      throw new BadRequestException(
        'Onboarding is locked after submission. Contact support for re-verification.',
      );
    }

    const verification = await this.prisma.sellerVerification.findUnique({
      where: { sellerProfileId: ctx.sellerProfileId },
    });
    if (verification?.gstVerified && dto.gstData !== undefined) {
      throw new BadRequestException(
        'GST is verified and cannot be edited. Request re-verification to change GSTIN.',
      );
    }
    if (verification?.panVerified && dto.panData !== undefined) {
      throw new BadRequestException(
        'PAN is verified and cannot be edited. Request re-verification to change PAN.',
      );
    }

    return this.prisma.sellerOnboarding.update({
      where: { id: existing.id },
      data: {
        status: SellerOnboardingStatus.IN_PROGRESS,
        currentStep: dto.currentStep,
        companyData: dto.companyData as Prisma.InputJsonValue | undefined,
        businessData: dto.businessData as Prisma.InputJsonValue | undefined,
        gstData: dto.gstData as Prisma.InputJsonValue | undefined,
        panData: dto.panData as Prisma.InputJsonValue | undefined,
        bankData: dto.bankData as Prisma.InputJsonValue | undefined,
        addressData: dto.addressData as Prisma.InputJsonValue | undefined,
        locationData: dto.locationData as Prisma.InputJsonValue | undefined,
        completedSteps: dto.completedSteps as Prisma.InputJsonValue | undefined,
        metadata: dto.metadata as Prisma.InputJsonValue | undefined,
        reviewNotes: dto.reviewNotes,
      },
    });
  }

  async submit(userId: string) {
    const ctx = await this.sellerContext.requireSeller(userId);
    const onboarding = await this.get(userId);

    const company = (onboarding.companyData ?? {}) as Record<string, unknown>;
    const gst = (onboarding.gstData ?? {}) as Record<string, unknown>;
    const pan = (onboarding.panData ?? {}) as Record<string, unknown>;
    const bank = (onboarding.bankData ?? {}) as Record<string, unknown>;
    const address = (onboarding.addressData ?? {}) as Record<string, unknown>;

    const missing: string[] = [];
    if (!hasValue(company, 'legalName') && !hasValue(company, 'name')) {
      missing.push('company.legalName');
    }
    if (!hasValue(gst, 'gstin')) missing.push('gst.gstin');
    if (!hasValue(pan, 'pan')) missing.push('pan.pan');
    if (!hasValue(bank, 'accountNumber') || !hasValue(bank, 'ifsc')) {
      missing.push('bank.accountNumber/ifsc');
    }
    if (!hasValue(address, 'line1') || !hasValue(address, 'city')) {
      missing.push('address.line1/city');
    }
    const missingDocuments =
      await this.onboardingDocuments.missingRequiredLabels(userId);
    for (const name of missingDocuments) {
      missing.push(`documents.${name}`);
    }
    if (missing.length) {
      throw new BadRequestException(
        `Incomplete onboarding. Missing: ${missing.join(', ')}`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.sellerOnboarding.update({
        where: { id: onboarding.id },
        data: {
          status: SellerOnboardingStatus.SUBMITTED,
          submittedAt: new Date(),
          currentStep: 'submitted',
        },
      });

      await tx.sellerProfile.update({
        where: { id: ctx.sellerProfileId },
        data: { status: SellerStatus.UNDER_REVIEW },
      });

      await tx.organization.update({
        where: { id: ctx.organizationId },
        data: {
          status: OrganizationStatus.PENDING_VERIFICATION,
          verificationStatus: VerificationStatus.UNDER_REVIEW,
          legalName: String(company.legalName ?? company.name ?? ''),
          gstin: String(gst.gstin),
          pan: String(pan.pan),
          name: String(
            company.name ?? company.legalName ?? 'Seller Organization',
          ),
        },
      });

      const existingBank = await tx.bankAccount.findFirst({
        where: { organizationId: ctx.organizationId, deletedAt: null },
      });
      const bankPayload = {
        accountHolder: String(
          bank.accountHolder ?? company.legalName ?? 'Seller',
        ),
        bankName: String(bank.bankName ?? 'Bank'),
        accountNumber: String(bank.accountNumber),
        ifsc: String(bank.ifsc),
        branch: bank.branch ? String(bank.branch) : undefined,
        isPrimary: true,
      };
      if (existingBank) {
        await tx.bankAccount.update({
          where: { id: existingBank.id },
          data: bankPayload,
        });
      } else {
        await tx.bankAccount.create({
          data: { organizationId: ctx.organizationId, ...bankPayload },
        });
      }

      return updated;
    });

    await this.audit.log({
      action: 'SELLER_ONBOARDING_SUBMITTED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.SELLER,
      entityId: ctx.sellerProfileId,
    });

    return result;
  }

  async status(userId: string) {
    const onboarding = await this.get(userId);
    return {
      status: onboarding.status,
      currentStep: onboarding.currentStep,
      completedSteps: onboarding.completedSteps,
      submittedAt: onboarding.submittedAt,
      reviewedAt: onboarding.reviewedAt,
      rejectedReason: onboarding.rejectedReason,
    };
  }
}
