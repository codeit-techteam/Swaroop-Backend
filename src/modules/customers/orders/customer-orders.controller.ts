import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import { CustomerOrdersQueryDto } from './customer-orders.dto.js';
import { CustomerOrdersService } from './customer-orders.service.js';

@ApiTags('Customer Orders')
@Controller({ path: 'customer/orders', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.CUSTOMER)
export class CustomerOrdersController {
  constructor(private readonly orders: CustomerOrdersService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Order summary counts for the authenticated customer',
  })
  async summary(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.orders.summary(user.id),
      'Order summary retrieved',
    );
  }

  @Get()
  @ApiOperation({
    summary:
      'List customer orders (PurchaseOrder projection). Supports ACTIVE/COMPLETED/CANCELLED filters.',
  })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CustomerOrdersQueryDto,
  ) {
    const { items, meta } = await this.orders.list(user.id, query);
    return successResponse(items, 'Orders retrieved', meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get customer order detail (own orders only)' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.orders.findOne(user.id, id),
      'Order retrieved',
    );
  }

  @Get(':id/timeline')
  @ApiOperation({
    summary: 'Order timeline from persisted PR/PO/payment/dispatch events',
  })
  async timeline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.orders.timeline(user.id, id),
      'Order timeline retrieved',
    );
  }

  @Get(':id/progress')
  @ApiOperation({
    summary: 'Backend-derived order progress percentage and stage',
  })
  async progress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.orders.progress(user.id, id),
      'Order progress retrieved',
    );
  }
}
