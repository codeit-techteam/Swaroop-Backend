import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { successResponse } from '../../../common/utils/response.util.js';
import { Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import { AdminSearchQueryDto } from '../common/admin-query.dto.js';
import { ADMIN_CORE_ROLES } from '../common/admin-roles.js';
import { AdminSearchService } from './admin-search.service.js';

@ApiTags('Admin Search')
@Controller({ path: 'admin/search', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_CORE_ROLES)
export class AdminSearchController {
  constructor(private readonly search: AdminSearchService) {}

  @Get()
  @ApiOperation({ summary: 'Global admin search across key entities' })
  async searchAll(@Query() query: AdminSearchQueryDto) {
    return successResponse(await this.search.search(query.q), 'Search results');
  }
}
