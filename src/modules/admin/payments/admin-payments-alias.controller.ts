import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { toDecimal } from '../../payments/common/money.util.js';
import {
  AdminPaymentActionDto,
  FinanceListQueryDto,
} from '../../payments/dto/finance.dto.js';
import { FinanceInvoiceService } from '../../payments/services/finance-invoice.service.js';
import { PaymentService } from '../../payments/services/payment.service.js';
import { PaymentVerificationService } from '../../payments/services/payment-verification.service.js';
import { ProformaInvoiceService } from '../../payments/services/proforma-invoice.service.js';
import { SettlementService } from '../../payments/services/settlement.service.js';
import { TransactionService } from '../../payments/services/transaction.service.js';
import { ADMIN_FINANCE_ROLES } from '../common/admin-roles.js';

/**
 * Thin aliases under /admin/payments and related finance lists.
 * Canonical paths remain at /admin/finance/*.
 */
@ApiTags('Admin Payments Aliases')
@Controller({ path: 'admin', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_FINANCE_ROLES)
export class AdminPaymentsAliasController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentService,
    private readonly verification: PaymentVerificationService,
    private readonly transactions: TransactionService,
    private readonly settlements: SettlementService,
    private readonly invoices: FinanceInvoiceService,
    private readonly proformas: ProformaInvoiceService,
  ) {}

  @Get('payments')
  @ApiOperation({ summary: 'List payments (alias)' })
  async listPayments(@Query() query: FinanceListQueryDto) {
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.payments.listForAdmin(
      skip,
      take,
      query.status,
    );
    return successResponse(
      items,
      'Payments retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Get('payments/:id')
  @ApiOperation({ summary: 'Payment detail (alias)' })
  async getPayment(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.payments.findOneForAdmin(id),
      'Payment retrieved',
    );
  }

  @Post('payments/:id/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify payment (alias)' })
  async verify(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminPaymentActionDto,
  ) {
    const payment = await this.verification.verify(id, user.id, dto.note);
    return successResponse(
      {
        id: payment.id,
        status: payment.status,
        verifiedAt: payment.verifiedAt,
        amount: toDecimal(payment.amount).toFixed(2),
      },
      'Payment verified',
    );
  }

  @Post('payments/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject payment (alias)' })
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminPaymentActionDto,
  ) {
    const payment = await this.verification.reject(
      id,
      user.id,
      dto.reason ?? dto.note,
    );
    return successResponse(
      {
        id: payment.id,
        status: payment.status,
        failureReason: payment.failureReason,
      },
      'Payment rejected',
    );
  }

  @Post('payments/:id/request-review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request payment review (alias)' })
  async requestReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminPaymentActionDto,
  ) {
    return successResponse(
      await this.verification.requestReview(id, user.id, dto.note),
      'Review requested',
    );
  }

  @Get('payment-schedules')
  @ApiOperation({ summary: 'List payment schedules (alias)' })
  async listSchedules(@Query() query: FinanceListQueryDto) {
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const [items, total] = await Promise.all([
      this.prisma.paymentSchedule.findMany({
        orderBy: [{ purchaseOrderId: 'asc' }, { sequence: 'asc' }],
        skip,
        take,
        include: {
          purchaseOrder: {
            select: { id: true, referenceNumber: true, status: true },
          },
        },
      }),
      this.prisma.paymentSchedule.count(),
    ]);
    return successResponse(
      items.map((s) => ({
        ...s,
        amount: s.amount.toString(),
        paidAmount: s.paidAmount.toString(),
        remainingAmount: s.remainingAmount.toString(),
        percentage: s.percentage?.toString() ?? null,
      })),
      'Payment schedules retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Get('transactions')
  @ApiOperation({ summary: 'List transactions (alias)' })
  async listTransactions(@Query() query: FinanceListQueryDto) {
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.transactions.list({ skip, take });
    return successResponse(
      items,
      'Transactions retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Get('proforma-invoices')
  @ApiOperation({ summary: 'List proforma invoices (alias)' })
  async listProformas(@Query() query: FinanceListQueryDto) {
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const [rows, total] = await Promise.all([
      this.prisma.proformaInvoice.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          customerOrg: {
            select: { id: true, name: true, legalName: true },
          },
          sellerOrg: {
            select: { id: true, name: true, legalName: true },
          },
          paymentSchedules: { orderBy: { sequence: 'asc' } },
        },
      }),
      this.prisma.proformaInvoice.count({ where: { deletedAt: null } }),
    ]);
    return successResponse(
      rows.map((pi) => this.proformas.toAdminView(pi)),
      'Proforma invoices retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Get('invoices')
  @ApiOperation({ summary: 'List finance invoices (alias)' })
  async listInvoices(@Query() query: FinanceListQueryDto) {
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.invoices.list({ skip, take });
    return successResponse(
      items,
      'Finance invoices retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Get('settlements')
  @ApiOperation({ summary: 'List settlements (alias)' })
  async listSettlements(@Query() query: FinanceListQueryDto) {
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.settlements.list({ skip, take });
    return successResponse(
      items,
      'Settlements retrieved',
      paginationMeta(page, limit, total),
    );
  }
}
