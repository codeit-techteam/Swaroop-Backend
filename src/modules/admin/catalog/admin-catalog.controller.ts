import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { successResponse } from '../../../common/utils/response.util.js';
import { Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import { ADMIN_CORE_ROLES } from '../common/admin-roles.js';
import { AdminDashboardService } from '../dashboard/admin-dashboard.service.js';

@ApiTags('Admin Catalog')
@Controller({ path: 'admin/catalog', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_CORE_ROLES)
export class AdminCatalogController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Catalog counts from PostgreSQL' })
  async summary() {
    return successResponse(
      await this.dashboard.catalogSummary(),
      'Catalog summary',
    );
  }
}
