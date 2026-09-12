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
import { FinanceListQueryDto } from '../dto/finance.dto.js';
import { DispatchGateService } from '../services/dispatch-gate.service.js';
import { FinanceSummaryService } from '../services/finance-summary.service.js';
import { PaymentService } from '../services/payment.service.js';
import { ProformaInvoiceService } from '../services/proforma-invoice.service.js';
import { SettlementService } from '../services/settlement.service.js';
import { FinanceActorService } from '../services/finance-actor.service.js';

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

  @Get('settlements')
  @ApiOperation({ summary: 'List seller settlements (read-only)' })
  async listSettlements(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FinanceListQueryDto,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.settlements.list({
      organizationId: seller.organizationId,
      skip,
      take,
    });
    return successResponse(
      items,
      'Settlements retrieved',
      paginationMeta(page, limit, total),
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
