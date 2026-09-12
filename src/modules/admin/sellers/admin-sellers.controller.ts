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
import { ADMIN_CORE_ROLES } from '../common/admin-roles.js';
import {
  AdminSellerActionDto,
  AdminSellersQueryDto,
} from './admin-sellers.dto.js';
import { AdminSellersService } from './admin-sellers.service.js';

@ApiTags('Admin Sellers')
@Controller({ path: 'admin/sellers', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_CORE_ROLES)
export class AdminSellersController {
  constructor(private readonly sellers: AdminSellersService) {}

  @Get()
  @ApiOperation({ summary: 'List sellers' })
  async list(@Query() query: AdminSellersQueryDto) {
    const { items, meta } = await this.sellers.list(query);
    return successResponse(items, 'Sellers retrieved', meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Seller detail' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(await this.sellers.findOne(id), 'Seller retrieved');
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve seller' })
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminSellerActionDto,
  ) {
    return successResponse(
      await this.sellers.approve(id, user.id, dto),
      'Seller approved',
    );
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject seller' })
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminSellerActionDto,
  ) {
    return successResponse(
      await this.sellers.reject(id, user.id, dto),
      'Seller rejected',
    );
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend seller' })
  async suspend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminSellerActionDto,
  ) {
    return successResponse(
      await this.sellers.suspend(id, user.id, dto),
      'Seller suspended',
    );
  }
}
