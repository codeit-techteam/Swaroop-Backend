import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { FinanceException } from '../common/finance.errors.js';
import { toDecimal } from '../common/money.util.js';
import {
  FinanceListQueryDto,
  SettlementListQueryDto,
} from '../dto/finance.dto.js';
import { DispatchGateService } from '../services/dispatch-gate.service.js';
import { FinanceSummaryService } from '../services/finance-summary.service.js';
import { PaymentService } from '../services/payment.service.js';
import { ProformaInvoiceService } from '../services/proforma-invoice.service.js';
import { SettlementService } from '../services/settlement.service.js';
import { FinanceActorService } from '../services/finance-actor.service.js';
import { anonymousBuyerRef } from '../../sellers/common/seller-context.service.js';
import { BLIND_BUYER_DISPLAY_NAME } from '../../sellers/common/blind-buyer.js';
import { resolveSearch } from '../../master-data/common/pagination.js';

@ApiTags('Seller Finance')
@Controller({ path: 'seller', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.SELLER)
export class SellerFinanceController {
  constructor(
    private readonly actors: FinanceActorService,
    private readonly prisma: PrismaService,
    private readonly summary: FinanceSummaryService,
    private readonly proformas: ProformaInvoiceService,
    private readonly payments: PaymentService,
    private readonly settlements: SettlementService,
    private readonly dispatchGate: DispatchGateService,
  ) {}

  @Get('finance/summary')
  @ApiOperation({ summary: 'Seller finance summary (read-only)' })
  async financeSummary(@CurrentUser() user: AuthenticatedUser) {
    const seller = await this.actors.requireSellerOrg(user.id);
    return successResponse(
      await this.summary.forSeller(seller.organizationId),
      'Finance summary',
    );
  }

  @Get('proforma-invoices')
  @ApiOperation({ summary: 'List seller proforma invoices' })
  async listProformas(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FinanceListQueryDto,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const where = {
      sellerOrgId: seller.organizationId,
      deletedAt: null,
    };
    const [rows, total] = await Promise.all([
      this.prisma.proformaInvoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          sellerOrg: {
            select: { id: true, name: true, legalName: true },
          },
          paymentSchedules: { orderBy: { sequence: 'asc' } },
        },
      }),
      this.prisma.proformaInvoice.count({ where }),
    ]);
    return successResponse(
      rows.map((pi) => this.proformas.toSellerView(pi)),
      'Proforma invoices retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Get('purchase-orders')
  @ApiOperation({ summary: 'List seller purchase orders' })
  async listPurchaseOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FinanceListQueryDto,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const where = {
      sellerOrgId: seller.organizationId,
      deletedAt: null,
    };
    const [items, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          purchaseRequest: {
            select: {
              id: true,
              referenceNumber: true,
              destinationRegion: true,
              items: {
                take: 1,
                include: {
                  grade: {
                    select: { code: true, name: true, displayName: true },
                  },
                  product: { select: { name: true, code: true } },
                },
              },
            },
          },
          payments: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { status: true },
          },
          dispatches: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { status: true, plannedDispatchDate: true },
          },
          shipments: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { status: true, referenceNumber: true },
          },
        },
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return successResponse(
      items.map((po) => {
        const line = po.purchaseRequest?.items?.[0];
        const snapshot = (
          po.metadata as {
            commercialSnapshot?: { quantity?: number; unit?: string };
          } | null
        )?.commercialSnapshot;
        return {
          id: po.id,
          orderNumber: po.referenceNumber,
          referenceNumber: po.referenceNumber,
          purchaseOrderId: po.id,
          status: po.status,
          paymentMethod: po.paymentMethod,
          currency: po.currency,
          totalAmount: toDecimal(po.totalAmount).toFixed(2),
          orderedQuantity:
            po.orderedQuantity != null ? String(po.orderedQuantity) : null,
          createdAt: po.createdAt,
          updatedAt: po.updatedAt,
          productName: line?.product?.name ?? 'Material',
          gradeName:
            line?.grade?.displayName ??
            line?.grade?.name ??
            line?.grade?.code ??
            '—',
          quantity: Number(
            toDecimal(
              line?.quantity ?? snapshot?.quantity ?? po.orderedQuantity ?? 0,
            ).toFixed(3),
          ),
          unit: line?.unit ?? snapshot?.unit ?? 'MT',
          paymentStatus: po.payments[0]?.status ?? null,
          dispatchStatus: po.dispatches[0]?.status ?? null,
          shipmentStatus: po.shipments[0]?.status ?? null,
          expectedDispatchDate:
            po.dispatches[0]?.plannedDispatchDate?.toISOString() ?? null,
          deliveryRegion:
            po.purchaseRequest?.destinationRegion ?? 'Assigned Destination',
          buyer: {
            displayName: BLIND_BUYER_DISPLAY_NAME,
            reference: anonymousBuyerRef(po.customerOrgId),
          },
          // Blind marketplace: seller never receives credit underwriting
          creditStatus: null,
        };
      }),
      'Purchase orders retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Get('payments')
  @ApiOperation({ summary: 'List payments for seller POs (read-only)' })
  async listPayments(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FinanceListQueryDto,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.payments.listForSeller(
      seller.organizationId,
      skip,
      take,
    );
    return successResponse(
      items,
      'Payments retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Get('settlements/summary')
  @ApiOperation({ summary: 'Seller settlement amount summary (read-only)' })
  async settlementsSummary(@CurrentUser() user: AuthenticatedUser) {
    const seller = await this.actors.requireSellerOrg(user.id);
    return successResponse(
      await this.settlements.summaryForSeller(seller.organizationId),
      'Settlement summary',
    );
  }

  @Get('settlements')
  @ApiOperation({ summary: 'List seller settlements (read-only)' })
  async listSettlements(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SettlementListQueryDto,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.settlements.list({
      organizationId: seller.organizationId,
      skip,
      take,
      status: query.status,
      search: resolveSearch(query),
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });
    return successResponse(
      items,
      'Settlements retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Get('settlements/:id')
  @ApiOperation({ summary: 'Seller settlement detail (read-only)' })
  async getSettlement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    return successResponse(
      await this.settlements.findOneForSeller(id, seller.organizationId),
      'Settlement retrieved',
    );
  }

  @Get('settlements/:id/timeline')
  @ApiOperation({ summary: 'Seller settlement timeline (read-only)' })
  async getSettlementTimeline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    return successResponse(
      await this.settlements.timelineForSeller(id, seller.organizationId),
      'Settlement timeline',
    );
  }

  @Get('finance/purchase-orders/:id/dispatch-clearance')
  @ApiOperation({ summary: 'Dispatch clearance for seller PO (read-only)' })
  async dispatchClearance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    return successResponse(
      await this.dispatchGate.checkForPurchaseOrder(id, {
        sellerOrgId: seller.organizationId,
      }),
      'Dispatch clearance',
    );
  }

  @Get('proforma-invoices/:id')
  @ApiOperation({ summary: 'Seller proforma detail' })
  async getProforma(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const pi = await this.prisma.proformaInvoice.findFirst({
      where: {
        id,
        sellerOrgId: seller.organizationId,
        deletedAt: null,
      },
      include: {
        sellerOrg: {
          select: { id: true, name: true, legalName: true },
        },
        lines: true,
        paymentSchedules: { orderBy: { sequence: 'asc' } },
      },
    });
    if (!pi) throw new FinanceException('PROFORMA_NOT_FOUND');
    return successResponse(
      this.proformas.toSellerView(pi),
      'Proforma invoice retrieved',
    );
  }
}
