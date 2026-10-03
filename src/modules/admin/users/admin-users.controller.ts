import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
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
import {
  AdminManagerService,
  type ManagerActor,
} from './admin-manager.service.js';
import { AdminUsersService } from './admin-users.service.js';

function actorOf(user: AuthenticatedUser, req: Request): ManagerActor {
  const forwarded = req.headers['x-forwarded-for'];
  const requestId = req.headers['x-request-id'] ?? (req as { id?: unknown }).id;
  return {
    id: user.id,
    ipAddress:
      typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : req.ip,
    userAgent: req.headers['user-agent'],
    requestId: requestId == null ? undefined : String(requestId),
  };
}

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
    @Req() req: Request,
    @Body() dto: CreateSellerManagerDto,
  ) {
    return successResponse(
      await this.managers.create(dto, actorOf(user, req)),
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
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateManagerDto,
  ) {
    return successResponse(
      await this.managers.update(id, dto, actorOf(user, req)),
      'Seller Manager updated',
    );
  }

  @Post(':id/activate')
  @ApiOperation({ summary: 'Activate a Seller Manager' })
  async activate(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.managers.activate(id, actorOf(user, req)),
      'Seller Manager activated',
    );
  }

  @Post(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate a Seller Manager and revoke sessions' })
  async deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.managers.deactivate(id, actorOf(user, req)),
      'Seller Manager deactivated',
    );
  }

  @Post(':id/revoke')
  @ApiOperation({ summary: 'Revoke Seller Manager access' })
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.managers.revoke(id, actorOf(user, req)),
      'Seller Manager access revoked',
    );
  }

  @Post(':id/reset-password')
  @ApiOperation({
    summary:
      'Issue a one-time link: a new invitation if no password was set, otherwise a password reset',
  })
  async resetPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.managers.resetPassword(id, actorOf(user, req)),
      'One-time access link created',
    );
  }

  @Post(':id/primary')
  @ApiOperation({ summary: 'Set this manager as the seller primary contact' })
  async setPrimary(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.managers.setPrimary(id, actorOf(user, req)),
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
      await this.users.updateStatus(id, dto, user),
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
      await this.users.updateRole(id, dto, user),
      'User role updated',
    );
  }
}
