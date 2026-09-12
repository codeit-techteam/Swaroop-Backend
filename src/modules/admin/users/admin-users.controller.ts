import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import { ADMIN_CORE_ROLES } from '../common/admin-roles.js';
import {
  AdminUsersQueryDto,
  UpdateUserRoleDto,
  UpdateUserStatusDto,
} from './admin-users.dto.js';
import { AdminUsersService } from './admin-users.service.js';

@ApiTags('Admin Users')
@Controller({ path: 'admin/users', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_CORE_ROLES)
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: 'List users' })
  async list(@Query() query: AdminUsersQueryDto) {
    const { items, meta } = await this.users.list(query);
    return successResponse(items, 'Users retrieved', meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by id' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(await this.users.findOne(id), 'User retrieved');
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update user status' })
  async updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return successResponse(
      await this.users.updateStatus(id, dto, user.id),
      'User status updated',
    );
  }

  @Patch(':id/role')
  @ApiOperation({ summary: 'Update primary user role' })
  async updateRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRoleDto,
  ) {
    return successResponse(
      await this.users.updateRole(id, dto, user.id),
      'User role updated',
    );
  }
}
