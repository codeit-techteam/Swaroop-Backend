import { Injectable } from '@nestjs/common';
import {
  CustomerStatus,
  ImportSide,
  ImportTradeParty,
  SellerStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import { resolveSellerActor } from '../../sellers/common/resolve-seller-actor.js';
import { ImportException } from '../domain/import.errors.js';

export type ImportBuyerContext = {
  customerProfileId: string;
  organizationId: string;
  status: CustomerStatus;
};

export type ImportSellerContext = {
  sellerProfileId: string;
  organizationId: string;
  status: SellerStatus;
  kind: 'OWNER' | 'MANAGER';
};

export type ImportActor = {
  userId: string;
  roles: string[];
  buyer: ImportBuyerContext | null;
  seller: ImportSellerContext | null;
};

const BLOCKED_CUSTOMER: CustomerStatus[] = [
  CustomerStatus.SUSPENDED,
  CustomerStatus.REJECTED,
  CustomerStatus.INACTIVE,
];

/**
 * Identity for every Import call comes from the JWT user. Organisation,
 * customer profile and seller profile are looked up server-side; a client can
 * never supply buyerId / sellerId.
 */
@Injectable()
export class ImportActorService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(user: AuthenticatedUser): Promise<ImportActor> {
    const roles = user.roles ?? [];
    const wantsBuyer = roles.includes(RoleCode.CUSTOMER);
    const wantsSeller =
      roles.includes(RoleCode.SELLER) ||
      roles.includes(RoleCode.SELLER_MANAGER);

    const [customer, seller] = await Promise.all([
      wantsBuyer
        ? this.prisma.customerProfile.findFirst({
            where: { userId: user.id, deletedAt: null },
            select: { id: true, organizationId: true, status: true },
          })
        : null,
      wantsSeller ? resolveSellerActor(this.prisma, user.id) : null,
    ]);

    return {
      userId: user.id,
      roles,
      buyer: customer
        ? {
            customerProfileId: customer.id,
            organizationId: customer.organizationId,
            status: customer.status,
          }
        : null,
      seller: seller
        ? {
            sellerProfileId: seller.profile.id,
            organizationId: seller.profile.organizationId,
            status: seller.profile.status,
            kind: seller.kind,
          }
        : null,
    };
  }

  requireBuyer(actor: ImportActor): ImportBuyerContext {
    if (!actor.buyer) throw new ImportException('IMPORT_PROFILE_REQUIRED');
    return actor.buyer;
  }

  requireSeller(actor: ImportActor): ImportSellerContext {
    if (!actor.seller) throw new ImportException('IMPORT_PROFILE_REQUIRED');
    return actor.seller;
  }

  /** Publishing and negotiating need an account in good standing. */
  assertBuyerCanTrade(buyer: ImportBuyerContext) {
    if (BLOCKED_CUSTOMER.includes(buyer.status)) {
      throw new ImportException('IMPORT_ACCOUNT_NOT_APPROVED');
    }
  }

  assertSellerCanTrade(seller: ImportSellerContext) {
    if (seller.status !== SellerStatus.APPROVED) {
      throw new ImportException(
        'IMPORT_ACCOUNT_NOT_APPROVED',
        'Your seller account must be approved before it can publish or negotiate Import offers.',
      );
    }
  }

  /** Which side of a negotiation/deal this actor represents, or null. */
  partyFor(
    actor: ImportActor,
    record: { buyerOrgId: string; sellerOrgId: string },
  ): ImportTradeParty | null {
    if (actor.buyer?.organizationId === record.buyerOrgId)
      return ImportTradeParty.BUYER;
    if (actor.seller?.organizationId === record.sellerOrgId)
      return ImportTradeParty.SELLER;
    return null;
  }

  /** A user may hold both a buyer and a seller profile, so the role depends on the side acted for. */
  actorRole(
    actor: ImportActor,
    actingAs: ImportSide | ImportTradeParty,
  ): string {
    const asSeller =
      actingAs === ImportSide.SELL || actingAs === ImportTradeParty.SELLER;
    if (asSeller && actor.seller) {
      return actor.seller.kind === 'MANAGER'
        ? RoleCode.SELLER_MANAGER
        : RoleCode.SELLER;
    }
    if (!asSeller && actor.buyer) return RoleCode.CUSTOMER;
    return actor.roles[0] ?? 'UNKNOWN';
  }
}
