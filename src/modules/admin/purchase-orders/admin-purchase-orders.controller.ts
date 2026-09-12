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
import { AdminPurchaseOrdersService } from './admin-purchase-orders.service.js';

@ApiTags('Admin Purchase Orders')
@Controller({ path: 'admin/purchase-orders', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_CORE_ROLES)
export class AdminPurchaseOrdersController {
  constructor(private readonly purchaseOrders: AdminPurchaseOrdersService) {}

  @Get()
  @ApiOperation({ summary: 'List purchase orders' })
  async list(@Query() query: AdminListQueryDto) {
    const { items, meta } = await this.purchaseOrders.list(query);
    return successResponse(items, 'Purchase orders retrieved', meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Purchase order detail' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.purchaseOrders.findOne(id),
      'Purchase order retrieved',
    );
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: 'Purchase order composed timeline' })
  async timeline(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.purchaseOrders.timeline(id),
      'Purchase order timeline',
    );
  }
}
