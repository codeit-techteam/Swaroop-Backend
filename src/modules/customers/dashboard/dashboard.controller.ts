import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import { PaginationQueryDto } from '../../master-data/common/pagination.js';
import { DashboardService } from './dashboard.service.js';

@ApiTags('Customer Dashboard')
@Controller({ path: 'customer', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.CUSTOMER)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('dashboard/summary')
  @ApiOperation({ summary: 'Customer dashboard summary' })
  async summary(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.dashboardService.summary(user.id),
      'Dashboard summary',
    );
  }

  @Get('search')
  @ApiOperation({ summary: 'Search products, grades, and offers' })
  async search(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ) {
    const result = await this.dashboardService.search(
      user.id,
      query.q ?? query.search ?? '',
      query,
    );
    const { meta, ...data } = result;
    return successResponse(data, 'Search results', meta);
  }
}
