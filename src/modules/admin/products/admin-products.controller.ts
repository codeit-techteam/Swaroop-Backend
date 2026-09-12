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
  AdminCreateProductDto,
  AdminProductsQueryDto,
  AdminUpdateProductDto,
  AdminUpdateProductStatusDto,
} from './admin-products.dto.js';
import { AdminProductsService } from './admin-products.service.js';

@ApiTags('Admin Products')
@Controller({ path: 'admin/products', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_CORE_ROLES)
export class AdminProductsController {
  constructor(private readonly products: AdminProductsService) {}

  @Get()
  @ApiOperation({ summary: 'List all products' })
  async list(@Query() query: AdminProductsQueryDto) {
    const { items, meta } = await this.products.list(query);
    return successResponse(items, 'Products retrieved', meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Product detail' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.products.findOne(id),
      'Product retrieved',
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create product for a seller org' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AdminCreateProductDto,
  ) {
    return successResponse(
      await this.products.create(dto, user.id),
      'Product created',
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update product' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateProductDto,
  ) {
    return successResponse(
      await this.products.update(id, dto, user.id),
      'Product updated',
    );
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update product status' })
  async updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateProductStatusDto,
  ) {
    return successResponse(
      await this.products.updateStatus(id, dto, user.id),
      'Product status updated',
    );
  }
}
