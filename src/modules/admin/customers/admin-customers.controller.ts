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
  AdminCustomerActionDto,
  AdminCustomersQueryDto,
} from './admin-customers.dto.js';
import { AdminCustomersService } from './admin-customers.service.js';

@ApiTags('Admin Customers')
@Controller({ path: 'admin/customers', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_CORE_ROLES)
export class AdminCustomersController {
  constructor(private readonly customers: AdminCustomersService) {}

  @Get()
  @ApiOperation({ summary: 'List customers' })
  async list(@Query() query: AdminCustomersQueryDto) {
    const { items, meta } = await this.customers.list(query);
    return successResponse(items, 'Customers retrieved', meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Customer detail' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.customers.findOne(id),
      'Customer retrieved',
    );
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend customer' })
  async suspend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCustomerActionDto,
  ) {
    return successResponse(
      await this.customers.suspend(id, user.id, dto),
      'Customer suspended',
    );
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate customer' })
  async activate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCustomerActionDto,
  ) {
    return successResponse(
      await this.customers.activate(id, user.id, dto),
      'Customer activated',
    );
  }
}
