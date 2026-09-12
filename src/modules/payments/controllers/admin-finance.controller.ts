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
  AdminPaymentActionDto,
  FinanceListQueryDto,
} from '../dto/finance.dto.js';
import { DispatchGateService } from '../services/dispatch-gate.service.js';
import { FinanceInvoiceService } from '../services/finance-invoice.service.js';
import { FinanceSummaryService } from '../services/finance-summary.service.js';
import { PaymentService } from '../services/payment.service.js';
import { PaymentVerificationService } from '../services/payment-verification.service.js';
import { ProformaInvoiceService } from '../services/proforma-invoice.service.js';
import { SettlementService } from '../services/settlement.service.js';
import { TransactionService } from '../services/transaction.service.js';

@ApiTags('Admin Finance')
@Controller({ path: 'admin/finance', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN, RoleCode.FINANCE_MANAGER)
export class AdminFinanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly summary: FinanceSummaryService,
    private readonly proformas: ProformaInvoiceService,
    private readonly payments: PaymentService,
    private readonly verification: PaymentVerificationService,
    private readonly transactions: TransactionService,
    private readonly settlements: SettlementService,
    private readonly invoices: FinanceInvoiceService,
    private readonly dispatchGate: DispatchGateService,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: 'Admin finance summary' })
  async financeSummary() {
    return successResponse(await this.summary.forAdmin(), 'Finance summary');
  }

  @Get('proforma-invoices')
  @ApiOperation({ summary: 'List all proforma invoices' })
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

  @Get('proforma-invoices/:id')
  @ApiOperation({ summary: 'Admin proforma detail' })
  async getProforma(@Param('id', ParseUUIDPipe) id: string) {
    const pi = await this.prisma.proformaInvoice.findFirst({
      where: { id, deletedAt: null },
      include: {
        customerOrg: {
          select: { id: true, name: true, legalName: true },
        },
        sellerOrg: {
          select: { id: true, name: true, legalName: true },
        },
        lines: true,
        paymentSchedules: { orderBy: { sequence: 'asc' } },
      },
    });
    if (!pi) throw new FinanceException('PROFORMA_NOT_FOUND');
    return successResponse(
      this.proformas.toAdminView(pi),
      'Proforma invoice retrieved',
    );
  }

  @Get('payments')
  @ApiOperation({ summary: 'List payments' })
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
  @ApiOperation({ summary: 'Payment detail' })
  async getPayment(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.payments.findOneForAdmin(id),
      'Payment retrieved',
    );
  }

  @Post('payments/:id/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify payment (admin only)' })
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
  @ApiOperation({ summary: 'Reject payment' })
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
  @ApiOperation({ summary: 'Flag payment for further review' })
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

  @Get('transactions')
  @ApiOperation({ summary: 'List payment transactions' })
  async listTransactions(@Query() query: FinanceListQueryDto) {
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.transactions.list({ skip, take });
    return successResponse(
      items,
      'Transactions retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Get('settlements')
  @ApiOperation({ summary: 'List settlements' })
  async listSettlements(@Query() query: FinanceListQueryDto) {
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.settlements.list({ skip, take });
    return successResponse(
      items,
      'Settlements retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Get('invoices')
  @ApiOperation({ summary: 'List finance invoices (foundation)' })
  async listInvoices(@Query() query: FinanceListQueryDto) {
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.invoices.list({ skip, take });
    return successResponse(
      items,
      'Finance invoices retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Get('purchase-orders/:id/dispatch-clearance')
  @ApiOperation({ summary: 'Dispatch payment clearance check' })
  async dispatchClearance(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.dispatchGate.checkForPurchaseOrder(id),
      'Dispatch clearance',
    );
  }
}
