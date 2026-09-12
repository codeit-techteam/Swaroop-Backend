import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { successResponse } from '../../../common/utils/response.util.js';
import { Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import { ADMIN_CORE_ROLES } from '../../admin/common/admin-roles.js';
import {
  AnalyticsQueryDto,
  AnalyticsTopQueryDto,
  AnalyticsTrendQueryDto,
} from '../dto/analytics-query.dto.js';
import {
  ProcurementAnalyticsService,
  SalesAnalyticsService,
} from '../services/sales-procurement-analytics.service.js';
import {
  CatalogInventoryAnalyticsService,
  LogisticsSettlementAnalyticsService,
  OverviewAnalyticsService,
  PartyAnalyticsService,
  PaymentAnalyticsService,
} from '../services/domain-analytics.service.js';

@ApiTags('Admin - Analytics')
@Controller({ path: 'admin/analytics', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_CORE_ROLES)
export class AdminAnalyticsController {
  constructor(
    private readonly overview: OverviewAnalyticsService,
    private readonly sales: SalesAnalyticsService,
    private readonly procurement: ProcurementAnalyticsService,
    private readonly payments: PaymentAnalyticsService,
    private readonly parties: PartyAnalyticsService,
    private readonly catalog: CatalogInventoryAnalyticsService,
    private readonly logistics: LogisticsSettlementAnalyticsService,
  ) {}

  @Get('overview')
  @ApiTags('Admin - Analytics')
  @ApiOperation({
    summary: 'Centralized analytics overview for Admin dashboard',
    description:
      'Default period: start of current UTC month → now when from/to omitted.',
  })
  @ApiResponse({ status: 200, description: 'Overview metrics from PostgreSQL' })
  async getOverview(@Query() query: AnalyticsQueryDto) {
    const data = await this.overview.overview(query);
    return successResponse(data, 'Analytics overview', data.meta);
  }

  @Get('sales')
  @ApiTags('Admin - Sales Analytics')
  @ApiOperation({
    summary: 'Sales analytics (GMV from confirmed+ purchase orders)',
  })
  async getSales(@Query() query: AnalyticsTrendQueryDto) {
    const data = await this.sales.sales(query);
    return successResponse(data, 'Sales analytics', data.meta);
  }

  @Get('gmv')
  @ApiTags('Admin - Sales Analytics')
  @ApiOperation({ summary: 'GMV trends and top performers' })
  async getGmv(@Query() query: AnalyticsTopQueryDto & AnalyticsTrendQueryDto) {
    const data = await this.sales.gmv(query);
    return successResponse(data, 'GMV analytics', data.meta);
  }

  @Get('procurement')
  @ApiTags('Admin - Procurement Analytics')
  async getProcurement(@Query() query: AnalyticsQueryDto) {
    const data = await this.procurement.procurement(query);
    return successResponse(data, 'Procurement analytics', data.meta);
  }

  @Get('purchase-requests')
  @ApiTags('Admin - Procurement Analytics')
  async getPurchaseRequests(@Query() query: AnalyticsQueryDto) {
    const data = await this.procurement.purchaseRequests(query);
    return successResponse(data, 'Purchase request analytics', data.meta);
  }

  @Get('purchase-orders')
  @ApiTags('Admin - Procurement Analytics')
  async getPurchaseOrders(@Query() query: AnalyticsQueryDto) {
    const data = await this.procurement.purchaseOrders(query);
    return successResponse(data, 'Purchase order analytics', data.meta);
  }

  @Get('payments')
  @ApiTags('Admin - Payment Analytics')
  async getPayments(@Query() query: AnalyticsQueryDto) {
    const data = await this.payments.payments(query);
    return successResponse(data, 'Payment analytics', data.meta);
  }

  @Get('payment-clearance')
  @ApiTags('Admin - Payment Analytics')
  @ApiOperation({
    summary: 'Dispatch payment clearance (mirrors schedule gate rules)',
  })
  async getPaymentClearance(@Query() query: AnalyticsQueryDto) {
    const data = await this.payments.paymentClearance(query);
    return successResponse(data, 'Payment clearance analytics', data.meta);
  }

  @Get('sellers')
  @ApiTags('Admin - Seller Analytics')
  async getSellers(@Query() query: AnalyticsQueryDto) {
    const data = await this.parties.sellers(query);
    return successResponse(data, 'Seller performance', data.meta);
  }

  @Get('customers')
  @ApiTags('Admin - Customer Analytics')
  async getCustomers(@Query() query: AnalyticsQueryDto) {
    const data = await this.parties.customers(query);
    return successResponse(data, 'Customer performance', data.meta);
  }

  @Get('grades')
  @ApiTags('Admin - Sales Analytics')
  async getGrades(@Query() query: AnalyticsQueryDto) {
    const data = await this.catalog.grades(query);
    return successResponse(data, 'Grade analytics', data.meta);
  }

  @Get('products')
  @ApiTags('Admin - Sales Analytics')
  async getProducts(@Query() query: AnalyticsQueryDto) {
    const data = await this.catalog.products(query);
    return successResponse(data, 'Product analytics', data.meta);
  }

  @Get('inventory')
  @ApiTags('Admin - Inventory Analytics')
  async getInventory(@Query() query: AnalyticsQueryDto) {
    const data = await this.catalog.inventory(query);
    return successResponse(data, 'Inventory analytics');
  }

  @Get('logistics')
  @ApiTags('Admin - Logistics Analytics')
  async getLogistics(@Query() query: AnalyticsQueryDto) {
    const data = await this.logistics.logistics(query);
    return successResponse(data, 'Logistics analytics', data.meta);
  }

  @Get('delivery')
  @ApiTags('Admin - Logistics Analytics')
  async getDelivery(@Query() query: AnalyticsQueryDto) {
    const data = await this.logistics.delivery(query);
    return successResponse(data, 'Delivery analytics', data.meta);
  }

  @Get('settlements')
  @ApiTags('Admin - Settlement Analytics')
  async getSettlements(@Query() query: AnalyticsQueryDto) {
    const data = await this.logistics.settlements(query);
    return successResponse(data, 'Settlement analytics', data.meta);
  }

  @Get('finance')
  @ApiTags('Admin - Settlement Analytics')
  async getFinance(@Query() query: AnalyticsQueryDto) {
    const data = await this.overview.finance(query);
    return successResponse(data, 'Finance summary', data.meta);
  }

  @Get('operational-status')
  @ApiOperation({ summary: 'PR → PO → Payment → Dispatch → Delivery pipeline' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async getOperationalStatus(@Query() query: AnalyticsQueryDto) {
    const data = await this.overview.operationalStatus(query);
    return successResponse(data, 'Operational status', data.meta);
  }
}
