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
import { ProformaInvoiceStatus } from '../../../generated/prisma/client.js';
import { FinanceException } from '../common/finance.errors.js';
import { toDecimal } from '../common/money.util.js';
import {
  CreatePaymentDto,
  FinanceListQueryDto,
  SubmitUtrDto,
} from '../dto/finance.dto.js';
import { DispatchGateService } from '../services/dispatch-gate.service.js';
import { FinanceSummaryService } from '../services/finance-summary.service.js';
import { PaymentService } from '../services/payment.service.js';
import { ProformaInvoiceService } from '../services/proforma-invoice.service.js';
import { FinanceActorService } from '../services/finance-actor.service.js';

@ApiTags('Customer Finance')
@Controller({ path: 'customer', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.CUSTOMER)
export class CustomerFinanceController {
  constructor(
    private readonly actors: FinanceActorService,
    private readonly prisma: PrismaService,
    private readonly summary: FinanceSummaryService,
    private readonly proformas: ProformaInvoiceService,
    private readonly payments: PaymentService,
    private readonly dispatchGate: DispatchGateService,
  ) {}

  @Get('finance/summary')
  @ApiOperation({ summary: 'Customer finance summary' })
  async financeSummary(@CurrentUser() user: AuthenticatedUser) {
    const customer = await this.actors.requireCustomerOrg(user.id);
    return successResponse(
      await this.summary.forCustomer(customer.organizationId),
      'Finance summary',
    );
  }

  @Get('purchase-orders')
  @ApiOperation({ summary: 'List own purchase orders (finance UX)' })
  async listPurchaseOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FinanceListQueryDto,
  ) {
    const customer = await this.actors.requireCustomerOrg(user.id);
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const where = {
      customerOrgId: customer.organizationId,
      deletedAt: null,
    };
    const [items, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          referenceNumber: true,
          status: true,
          paymentMethod: true,
          currency: true,
          totalAmount: true,
          createdAt: true,
        },
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return successResponse(
      items.map((po) => ({
        ...po,
        totalAmount: toDecimal(po.totalAmount).toFixed(2),
      })),
      'Purchase orders retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Get('proforma-invoices')
  @ApiOperation({ summary: 'List customer proforma invoices' })
  async listProformas(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FinanceListQueryDto,
  ) {
    const customer = await this.actors.requireCustomerOrg(user.id);
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const where = {
      customerOrgId: customer.organizationId,
      deletedAt: null,
    };
    const [rows, total] = await Promise.all([
      this.prisma.proformaInvoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          customerOrg: {
            select: { id: true, name: true, legalName: true },
          },
          paymentSchedules: { orderBy: { sequence: 'asc' } },
        },
      }),
      this.prisma.proformaInvoice.count({ where }),
    ]);
    return successResponse(
      rows.map((pi) => this.proformas.toCustomerView(pi)),
      'Proforma invoices retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Get('proforma-invoices/:id')
  @ApiOperation({ summary: 'Get proforma invoice detail' })
  async getProforma(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const customer = await this.actors.requireCustomerOrg(user.id);
    const pi = await this.prisma.proformaInvoice.findFirst({
      where: {
        id,
        customerOrgId: customer.organizationId,
        deletedAt: null,
      },
      include: {
        customerOrg: {
          select: { id: true, name: true, legalName: true },
        },
        lines: { orderBy: { sequence: 'asc' } },
        paymentSchedules: { orderBy: { sequence: 'asc' } },
      },
    });
    if (!pi) throw new FinanceException('PROFORMA_NOT_FOUND');
    return successResponse(
      this.proformas.toCustomerView(pi),
      'Proforma invoice retrieved',
    );
  }

  @Get('proforma-invoices/:id/payment-status')
  @ApiOperation({ summary: 'Payment status for a proforma invoice' })
  async proformaPaymentStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const customer = await this.actors.requireCustomerOrg(user.id);
    const pi = await this.prisma.proformaInvoice.findFirst({
      where: {
        id,
        customerOrgId: customer.organizationId,
        deletedAt: null,
      },
      include: {
        paymentSchedules: { orderBy: { sequence: 'asc' } },
        payments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            referenceNumber: true,
            status: true,
            amount: true,
            utr: true,
          },
        },
      },
    });
    if (!pi) throw new FinanceException('PROFORMA_NOT_FOUND');
    return successResponse(
      {
        id: pi.id,
        piNumber: pi.piNumber,
        status: pi.status,
        totalAmount: toDecimal(pi.totalAmount).toFixed(2),
        paidAmount: toDecimal(pi.paidAmount).toFixed(2),
        remainingAmount: toDecimal(pi.remainingAmount).toFixed(2),
        schedules: pi.paymentSchedules.map((s) => ({
          id: s.id,
          type: s.type,
          status: s.status,
          amount: toDecimal(s.amount).toFixed(2),
          paidAmount: toDecimal(s.paidAmount).toFixed(2),
          remainingAmount: toDecimal(s.remainingAmount).toFixed(2),
        })),
        payments: pi.payments.map((p) => ({
          ...p,
          amount: toDecimal(p.amount).toFixed(2),
        })),
      },
      'Proforma payment status',
    );
  }

  @Get('purchase-orders/:id/proforma-invoice')
  @ApiOperation({ summary: 'Get PI for a purchase order' })
  async poProforma(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const customer = await this.actors.requireCustomerOrg(user.id);
    const po = await this.prisma.purchaseOrder.findFirst({
      where: {
        id,
        customerOrgId: customer.organizationId,
        deletedAt: null,
      },
    });
    if (!po) throw new FinanceException('PURCHASE_ORDER_NOT_FOUND');

    const pi = await this.prisma.proformaInvoice.findUnique({
      where: { purchaseOrderId: id },
      include: {
        customerOrg: {
          select: { id: true, name: true, legalName: true },
        },
        lines: true,
        paymentSchedules: { orderBy: { sequence: 'asc' } },
      },
    });
    if (!pi || pi.status === ProformaInvoiceStatus.CANCELLED) {
      throw new FinanceException('PROFORMA_NOT_FOUND');
    }
    return successResponse(
      this.proformas.toCustomerView(pi),
      'Proforma invoice retrieved',
    );
  }

  @Get('payments')
  @ApiOperation({ summary: 'List customer payments' })
  async listPayments(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FinanceListQueryDto,
  ) {
    const customer = await this.actors.requireCustomerOrg(user.id);
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.payments.listForCustomer(
      customer.organizationId,
      skip,
      take,
    );
    return successResponse(
      items,
      'Payments retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Get('payments/:id')
  @ApiOperation({ summary: 'Get payment detail' })
  async getPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const customer = await this.actors.requireCustomerOrg(user.id);
    return successResponse(
      await this.payments.findOneForCustomer(id, customer.organizationId),
      'Payment retrieved',
    );
  }

  @Post('payments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Initiate a payment' })
  async createPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaymentDto,
  ) {
    const customer = await this.actors.requireCustomerOrg(user.id);
    return successResponse(
      await this.payments.create({
        customerOrgId: customer.organizationId,
        actorUserId: user.id,
        purchaseOrderId: dto.purchaseOrderId,
        paymentScheduleId: dto.paymentScheduleId,
        amount: dto.amount,
        rail: dto.rail,
        note: dto.note,
        idempotencyKey: dto.idempotencyKey,
      }),
      'Payment initiated',
    );
  }

  @Post('payments/:id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit payment with UTR' })
  async submitPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitUtrDto,
  ) {
    const customer = await this.actors.requireCustomerOrg(user.id);
    return successResponse(
      await this.payments.submit(id, customer.organizationId, user.id, dto),
      'Payment submitted',
    );
  }

  @Post('payments/:id/utr')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit / update UTR for payment' })
  async submitUtr(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitUtrDto,
  ) {
    const customer = await this.actors.requireCustomerOrg(user.id);
    return successResponse(
      await this.payments.submitUtr(id, customer.organizationId, user.id, dto),
      'UTR submitted',
    );
  }

  @Get('payments/:id/status')
  @ApiOperation({ summary: 'Payment status' })
  async paymentStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const customer = await this.actors.requireCustomerOrg(user.id);
    return successResponse(
      await this.payments.getStatus(id, customer.organizationId),
      'Payment status',
    );
  }

  @Get('purchase-orders/:id/dispatch-clearance')
  @ApiOperation({
    summary: 'Check if payment is cleared for dispatch (customer read)',
  })
  async dispatchClearance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const customer = await this.actors.requireCustomerOrg(user.id);
    return successResponse(
      await this.dispatchGate.checkForPurchaseOrder(id, {
        customerOrgId: customer.organizationId,
      }),
      'Dispatch clearance',
    );
  }
}
