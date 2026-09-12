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
import { CustomerProductQueryDto } from './products.dto.js';
import { ProductsService } from './products.service.js';

@ApiTags('Customer Products')
@Controller({ path: 'customer/products', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.CUSTOMER)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @ApiOperation({ summary: 'List marketplace products' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CustomerProductQueryDto,
  ) {
    const { items, meta } = await this.productsService.findAll(user.id, query);
    return successResponse(items, 'Products retrieved', meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get product detail' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.productsService.findOne(user.id, id),
      'Product retrieved',
    );
  }

  @Get(':id/offers')
  @ApiOperation({ summary: 'List offers for a product' })
  async listOffers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CustomerProductQueryDto,
  ) {
    const { items, meta } = await this.productsService.listOffers(
      user.id,
      id,
      query,
    );
    return successResponse(items, 'Product offers retrieved', meta);
  }
}
