import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { successResponse } from '../../../common/utils/response.util.js';
import { Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import { AdminDateRangeQueryDto } from '../common/admin-query.dto.js';
import { ADMIN_CORE_ROLES } from '../common/admin-roles.js';
import { AdminReportsService } from './admin-reports.service.js';

@ApiTags('Admin Reports')
@Controller({ path: 'admin/reports', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_CORE_ROLES)
export class AdminReportsController {
  constructor(private readonly reports: AdminReportsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Platform overview report' })
  async overview(@Query() query: AdminDateRangeQueryDto) {
    return successResponse(
      await this.reports.overview(query),
      'Overview report',
    );
  }

  @Get('sales')
  async sales(@Query() query: AdminDateRangeQueryDto) {
    return successResponse(await this.reports.sales(query), 'Sales report');
  }

  @Get('procurement')
  async procurement(@Query() query: AdminDateRangeQueryDto) {
    return successResponse(
      await this.reports.procurement(query),
      'Procurement report',
    );
  }

  @Get('payments')
  async payments(@Query() query: AdminDateRangeQueryDto) {
    return successResponse(
      await this.reports.payments(query),
      'Payments report',
    );
  }

  @Get('logistics')
  async logistics(@Query() query: AdminDateRangeQueryDto) {
    return successResponse(
      await this.reports.logistics(query),
      'Logistics report',
    );
  }

  @Get('sellers')
  async sellers(@Query() query: AdminDateRangeQueryDto) {
    return successResponse(await this.reports.sellers(query), 'Sellers report');
  }

  @Get('customers')
  async customers(@Query() query: AdminDateRangeQueryDto) {
    return successResponse(
      await this.reports.customers(query),
      'Customers report',
    );
  }

  @Get('inventory')
  @ApiOperation({ summary: 'Inventory snapshot report' })
  async inventory(@Query() query: AdminDateRangeQueryDto) {
    return successResponse(
      await this.reports.inventory(query),
      'Inventory report',
    );
  }

  @Get('settlements')
  @ApiOperation({ summary: 'Settlements report' })
  async settlements(@Query() query: AdminDateRangeQueryDto) {
    return successResponse(
      await this.reports.settlements(query),
      'Settlements report',
    );
  }
}
