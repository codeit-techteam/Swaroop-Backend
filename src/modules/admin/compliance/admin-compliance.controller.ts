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
  AdminExpiringQueryDto,
  AdminListQueryDto,
  AdminReasonDto,
} from '../common/admin-query.dto.js';
import { ADMIN_COMPLIANCE_ROLES } from '../common/admin-roles.js';
import { AdminComplianceService } from './admin-compliance.service.js';

@ApiTags('Admin Compliance')
@Controller({ path: 'admin/compliance', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_COMPLIANCE_ROLES)
export class AdminComplianceController {
  constructor(private readonly compliance: AdminComplianceService) {}

  @Get()
  @ApiOperation({ summary: 'Compliance overview by seller' })
  async list(@Query() query: AdminListQueryDto) {
    const { items, meta } = await this.compliance.list(query);
    return successResponse(items, 'Compliance overview', meta);
  }

  @Get('expiring')
  @ApiOperation({ summary: 'Documents expiring within N days' })
  async expiring(@Query() query: AdminExpiringQueryDto) {
    return successResponse(
      await this.compliance.expiring(query),
      'Expiring documents',
    );
  }

  @Get(':entityType/:entityId')
  @ApiOperation({ summary: 'Compliance detail for seller or document' })
  async detail(
    @Param('entityType') entityType: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
  ) {
    return successResponse(
      await this.compliance.entityDetail(entityType, entityId),
      'Compliance detail',
    );
  }

  @Post(':entityType/:entityId/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entityType') entityType: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Body() dto: AdminReasonDto,
  ) {
    return successResponse(
      await this.compliance.approve(entityType, entityId, user.id, dto),
      'Compliance approved',
    );
  }

  @Post(':entityType/:entityId/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entityType') entityType: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Body() dto: AdminReasonDto,
  ) {
    return successResponse(
      await this.compliance.reject(entityType, entityId, user.id, dto),
      'Compliance rejected',
    );
  }
}
