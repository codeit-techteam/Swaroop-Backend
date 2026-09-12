import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { successResponse } from '../../../common/utils/response.util.js';
import { Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import { ADMIN_CORE_ROLES } from '../common/admin-roles.js';
import {
  AdminAuditLogsQueryDto,
  AdminAuditLogsService,
} from './admin-audit-logs.service.js';

@ApiTags('Admin Audit')
@Controller({ path: 'admin/audit-logs', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_CORE_ROLES)
export class AdminAuditLogsController {
  constructor(private readonly auditLogs: AdminAuditLogsService) {}

  @Get()
  @ApiOperation({ summary: 'List audit logs' })
  async list(@Query() query: AdminAuditLogsQueryDto) {
    const { items, meta } = await this.auditLogs.list(query);
    return successResponse(items, 'Audit logs retrieved', meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Audit log detail' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.auditLogs.findOne(id),
      'Audit log retrieved',
    );
  }
}
