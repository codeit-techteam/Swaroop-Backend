import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
  CreateSellerManagerDto,
  UpdateManagerDto,
  UpdateUserRoleDto,
  UpdateUserStatusDto,
} from './admin-users.dto.js';
import { AdminManagerService } from './admin-manager.service.js';
import { AdminUsersService } from './admin-users.service.js';

@ApiTags('Admin Users')
@Controller({ path: 'admin/users', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_CORE_ROLES)
export class AdminUsersController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly managers: AdminManagerService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List users' })
  async list(@Query() query: AdminUsersQueryDto) {
    const { items, meta } = await this.users.list(query);
    return successResponse(items, 'Users retrieved', meta);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export users for the current filters' })
  async export(@Query() query: AdminUsersQueryDto) {
    return successResponse(
      await this.users.exportRows(query),
      'Users exported',
    );
  }

  @Get('permission-catalog')
  @ApiOperation({ summary: 'Seller Manager permission catalog and presets' })
  catalog() {
    return successResponse(
      this.managers.catalog(),
      'Permission catalog retrieved',
    );
  }

  @Post('managers')
  @ApiOperation({ summary: 'Create a Seller Manager assigned to one seller' })
  async createManager(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSellerManagerDto,
  ) {
    return successResponse(
      await this.managers.create(dto, user.id),
      'Seller Manager created',
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by id' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(await this.managers.detail(id), 'User retrieved');
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a Seller Manager' })
  async updateManager(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateManagerDto,
  ) {
    return successResponse(
      await this.managers.update(id, dto, user.id),
      'Seller Manager updated',
    );
  }

  @Post(':id/activate')
  @ApiOperation({ summary: 'Activate a Seller Manager' })
  async activate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.managers.activate(id, user.id),
      'Seller Manager activated',
    );
  }

  @Post(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate a Seller Manager and revoke sessions' })
  async deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.managers.deactivate(id, user.id),
      'Seller Manager deactivated',
    );
  }

  @Post(':id/revoke')
  @ApiOperation({ summary: 'Revoke Seller Manager access' })
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.managers.revoke(id, user.id),
      'Seller Manager access revoked',
    );
  }

  @Post(':id/reset-password')
  @ApiOperation({ summary: 'Issue a one-time password reset token' })
  async resetPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.managers.resetPassword(id, user.id),
      'Password reset created',
    );
  }

  @Post(':id/primary')
  @ApiOperation({ summary: 'Set this manager as the seller primary contact' })
  async setPrimary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.managers.setPrimary(id, user.id),
      'Primary manager updated',
    );
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
