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
import { AdminListQueryDto } from '../common/admin-query.dto.js';
import { ADMIN_CORE_ROLES } from '../common/admin-roles.js';
import { AdminOrdersService } from './admin-orders.service.js';

@ApiTags('Admin Orders')
@Controller({ path: 'admin/orders', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_CORE_ROLES)
export class AdminOrdersController {
  constructor(private readonly orders: AdminOrdersService) {}

  @Get()
  @ApiOperation({ summary: 'List orders' })
  async list(@Query() query: AdminListQueryDto) {
    const { items, meta } = await this.orders.list(query);
    return successResponse(items, 'Orders retrieved', meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Order detail' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(await this.orders.findOne(id), 'Order retrieved');
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: 'Order status timeline' })
  async timeline(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(await this.orders.timeline(id), 'Order timeline');
  }
}
