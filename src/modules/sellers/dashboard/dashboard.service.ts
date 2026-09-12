import { Injectable } from '@nestjs/common';
import {
  CounterOfferStatus,
  DocumentStatus,
  EntityOwnerType,
  InventoryStatus,
  NegotiationActorRole,
  OfferStatus,
  ProductStatus,
  PurchaseRequestStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { SellerContextService } from '../common/seller-context.service.js';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellerContext: SellerContextService,
  ) {}

  async summary(userId: string) {
    const ctx = await this.sellerContext.requireSeller(userId);
    const orgId = ctx.organizationId;
    const sellerProfileId = ctx.sellerProfileId;
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const inFiveMin = new Date(now.getTime() + 5 * 60 * 1000);

    const [
      activeProducts,
      inactiveProducts,
      activeOffers,
      lowStockItems,
      pendingDocuments,
      expiringDocuments,
      pendingPrs,
      acceptedPrs,
      rejectedPrs,
      pendingPurchaseRequests,
      expiringSoon,
      acceptedToday,
      rejectedToday,
      counterOffersPending,
      onboarding,
      verification,
    ] = await Promise.all([
      this.prisma.product.count({
        where: {
          organizationId: orgId,
          deletedAt: null,
          status: ProductStatus.ACTIVE,
        },
      }),
      this.prisma.product.count({
        where: {
          organizationId: orgId,
          deletedAt: null,
          status: { in: [ProductStatus.PAUSED, ProductStatus.DRAFT] },
        },
      }),
      this.prisma.offer.count({
        where: {
          organizationId: orgId,
          deletedAt: null,
          status: OfferStatus.ACTIVE,
        },
      }),
      this.prisma.inventory.count({
        where: {
          organizationId: orgId,
          deletedAt: null,
          status: InventoryStatus.LOW,
        },
      }),
      this.prisma.document.count({
        where: {
          organizationId: orgId,
          deletedAt: null,
          ownerType: EntityOwnerType.SELLER,
          ownerId: sellerProfileId,
          status: {
            in: [DocumentStatus.UPLOADED, DocumentStatus.UNDER_REVIEW],
          },
        },
      }),
      this.prisma.document.count({
        where: {
          organizationId: orgId,
          deletedAt: null,
          ownerId: sellerProfileId,
          expiresAt: { lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
        },
      }),
      this.prisma.purchaseRequest.count({
        where: {
          deletedAt: null,
          sellerOrgId: orgId,
          status: {
            in: [
              PurchaseRequestStatus.SOURCING,
              PurchaseRequestStatus.UNDER_REVIEW,
              PurchaseRequestStatus.SUBMITTED,
            ],
          },
        },
      }),
      this.prisma.purchaseRequest.count({
        where: {
          deletedAt: null,
          sellerOrgId: orgId,
          status: {
            in: [
              PurchaseRequestStatus.APPROVED,
              PurchaseRequestStatus.CONVERTED_TO_ORDER,
            ],
          },
        },
      }),
      this.prisma.purchaseRequest.count({
        where: {
          deletedAt: null,
          sellerOrgId: orgId,
          status: PurchaseRequestStatus.REJECTED,
        },
      }),
      this.prisma.purchaseRequest.count({
        where: {
          deletedAt: null,
          sellerOrgId: orgId,
          status: {
            in: [
              PurchaseRequestStatus.SOURCING,
              PurchaseRequestStatus.NEGOTIATION,
              PurchaseRequestStatus.OFFER_RECEIVED,
              PurchaseRequestStatus.SUBMITTED,
              PurchaseRequestStatus.UNDER_REVIEW,
            ],
          },
        },
      }),
      this.prisma.purchaseRequest.count({
        where: {
          deletedAt: null,
          sellerOrgId: orgId,
          status: {
            in: [
              PurchaseRequestStatus.SOURCING,
              PurchaseRequestStatus.NEGOTIATION,
              PurchaseRequestStatus.OFFER_RECEIVED,
            ],
          },
          responseDeadline: { gt: now, lte: inFiveMin },
        },
      }),
      this.prisma.purchaseRequest.count({
        where: {
          deletedAt: null,
          sellerOrgId: orgId,
          status: PurchaseRequestStatus.CONVERTED_TO_ORDER,
          commerciallyAcceptedAt: { gte: startOfDay },
        },
      }),
      this.prisma.purchaseRequest.count({
        where: {
          deletedAt: null,
          sellerOrgId: orgId,
          status: PurchaseRequestStatus.REJECTED,
          updatedAt: { gte: startOfDay },
        },
      }),
      this.prisma.counterOffer.count({
        where: {
          status: CounterOfferStatus.PENDING,
          createdByRole: NegotiationActorRole.CUSTOMER,
          purchaseRequest: {
            deletedAt: null,
            sellerOrgId: orgId,
          },
        },
      }),
      this.prisma.sellerOnboarding.findUnique({
        where: { sellerProfileId },
        select: { status: true, currentStep: true, submittedAt: true },
      }),
      this.prisma.sellerVerification.findUnique({
        where: { sellerProfileId },
        select: {
          overallStatus: true,
          gstVerified: true,
          panVerified: true,
          bankVerified: true,
        },
      }),
    ]);

    return {
      sellerProfileId,
      organizationId: orgId,
      sellerStatus: ctx.status,
      onboardingStatus: onboarding?.status ?? null,
      onboardingStep: onboarding?.currentStep ?? null,
      verificationStatus: ctx.verificationStatus,
      verification,
      products: { active: activeProducts, inactive: inactiveProducts },
      offers: { active: activeOffers },
      activeOffers,
      inventory: { lowStockItems },
      documents: { pending: pendingDocuments, expiringSoon: expiringDocuments },
      purchaseRequests: {
        pending: pendingPrs,
        accepted: acceptedPrs,
        rejected: rejectedPrs,
        pendingPurchaseRequests,
        expiringSoon,
        acceptedToday,
        rejectedToday,
        counterOffersPending,
        activeOffers,
      },
      pendingPurchaseRequests,
      expiringSoon,
      acceptedToday,
      rejectedToday,
      counterOffersPending,
    };
  }
}
