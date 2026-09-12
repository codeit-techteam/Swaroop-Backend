import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { successResponse } from '../../../common/utils/response.util.js';
import { Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import { ADMIN_CORE_ROLES } from '../common/admin-roles.js';
import { AdminDashboardService } from './admin-dashboard.service.js';

@ApiTags('Admin Dashboard')
@Controller({ path: 'admin/dashboard', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_CORE_ROLES)
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Admin control center dashboard summary' })
  async summary() {
    return successResponse(await this.dashboard.summary(), 'Dashboard summary');
  }
}
