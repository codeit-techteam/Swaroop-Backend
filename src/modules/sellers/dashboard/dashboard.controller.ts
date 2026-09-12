import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import { DashboardService } from './dashboard.service.js';

@ApiTags('Seller Dashboard')
@Controller({ path: 'seller/dashboard', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.SELLER)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Seller dashboard summary' })
  async summary(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.dashboardService.summary(user.id),
      'Dashboard summary',
    );
  }
}

@ApiTags('Seller Dashboard')
@Controller({ path: 'seller', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.SELLER)
export class DashboardAliasController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('dashboard-summary')
  @ApiOperation({ summary: 'Seller dashboard summary (alias)' })
  async summaryAlias(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.dashboardService.summary(user.id),
      'Dashboard summary',
    );
  }
}
