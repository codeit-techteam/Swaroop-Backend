import { Prisma } from '../../../generated/prisma/client.js';
import type { AnalyticsQueryDto } from '../dto/analytics-query.dto.js';
import type { AnalyticsPeriod } from '../common/analytics-period.js';

export type PoFilterContext = {
  where: Prisma.PurchaseOrderWhereInput;
  period: AnalyticsPeriod;
};

/**
 * Resolve sellerOrgId / customerOrgId from profile UUIDs when provided.
 */
export async function resolveOrgIds(
  prisma: {
    sellerProfile: {
      findUnique: (args: {
        where: { id: string };
        select: { organizationId: true };
      }) => Promise<{ organizationId: string } | null>;
    };
    customerProfile: {
      findUnique: (args: {
        where: { id: string };
        select: { organizationId: true };
      }) => Promise<{ organizationId: string } | null>;
    };
  },
  query: AnalyticsQueryDto,
): Promise<{ sellerOrgId?: string; customerOrgId?: string }> {
  let sellerOrgId: string | undefined;
  let customerOrgId: string | undefined;

  if (query.sellerId) {
    const seller = await prisma.sellerProfile.findUnique({
      where: { id: query.sellerId },
      select: { organizationId: true },
    });
    sellerOrgId = seller?.organizationId;
  }
  if (query.customerId) {
    const customer = await prisma.customerProfile.findUnique({
      where: { id: query.customerId },
      select: { organizationId: true },
    });
    customerOrgId = customer?.organizationId;
  }

  return { sellerOrgId, customerOrgId };
}

export function buildPoWhere(
  period: AnalyticsPeriod,
  orgs: { sellerOrgId?: string; customerOrgId?: string },
  query: AnalyticsQueryDto,
  extra?: Prisma.PurchaseOrderWhereInput,
): Prisma.PurchaseOrderWhereInput {
  const where: Prisma.PurchaseOrderWhereInput = {
    deletedAt: null,
    createdAt: { gte: period.from, lte: period.to },
    ...(orgs.sellerOrgId ? { sellerOrgId: orgs.sellerOrgId } : {}),
    ...(orgs.customerOrgId ? { customerOrgId: orgs.customerOrgId } : {}),
    ...(query.paymentOption ? { paymentMethod: query.paymentOption } : {}),
    ...(query.status
      ? { status: query.status as Prisma.EnumPurchaseOrderStatusFilter }
      : {}),
    ...extra,
  };

  if (query.gradeId || query.productId) {
    where.purchaseRequest = {
      deletedAt: null,
      items: {
        some: {
          ...(query.gradeId ? { gradeId: query.gradeId } : {}),
          ...(query.productId ? { productId: query.productId } : {}),
        },
      },
    };
  }

  return where;
}

export function buildPrWhere(
  period: AnalyticsPeriod,
  orgs: { sellerOrgId?: string; customerOrgId?: string },
  query: AnalyticsQueryDto,
): Prisma.PurchaseRequestWhereInput {
  return {
    deletedAt: null,
    createdAt: { gte: period.from, lte: period.to },
    ...(orgs.sellerOrgId ? { sellerOrgId: orgs.sellerOrgId } : {}),
    ...(orgs.customerOrgId ? { customerOrgId: orgs.customerOrgId } : {}),
    ...(query.paymentOption ? { paymentMethod: query.paymentOption } : {}),
    ...(query.status
      ? { status: query.status as Prisma.EnumPurchaseRequestStatusFilter }
      : {}),
    ...(query.gradeId || query.productId
      ? {
          items: {
            some: {
              ...(query.gradeId ? { gradeId: query.gradeId } : {}),
              ...(query.productId ? { productId: query.productId } : {}),
            },
          },
        }
      : {}),
  };
}

export function periodMeta(period: AnalyticsPeriod) {
  return {
    from: period.fromIso,
    to: period.toIso,
    defaultApplied: period.defaultApplied,
  };
}
