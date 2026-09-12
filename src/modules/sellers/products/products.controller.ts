import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import {
  CreateProductDto,
  CreateProductMediaDto,
  ProductQueryDto,
  UpdateProductDto,
  UpdateProductStatusDto,
} from './products.dto.js';
import { ProductsService } from './products.service.js';

@ApiTags('Seller Products')
@Controller({ path: 'seller/products', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.SELLER)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @ApiOperation({ summary: 'Create seller product' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProductDto,
  ) {
    return successResponse(
      await this.productsService.create(user.id, dto),
      'Product created',
    );
  }

  @Get()
  @ApiOperation({ summary: 'List seller products' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ProductQueryDto,
  ) {
    const { items, meta } = await this.productsService.findAll(user.id, query);
    return successResponse(items, 'Products retrieved', meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get seller product' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.productsService.findOne(user.id, id),
      'Product retrieved',
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update seller product' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return successResponse(
      await this.productsService.update(user.id, id, dto),
      'Product updated',
    );
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish product → PENDING_REVIEW' })
  async publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.productsService.publish(user.id, id),
      'Product published for review',
    );
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate PENDING_REVIEW product → ACTIVE' })
  async activate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.productsService.activate(user.id, id),
      'Product activated',
    );
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unpublish product → PAUSED' })
  async unpublish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.productsService.unpublish(user.id, id),
      'Product unpublished',
    );
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update product status' })
  async updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductStatusDto,
  ) {
    return successResponse(
      await this.productsService.updateStatus(user.id, id, dto),
      'Product status updated',
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete product' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.productsService.softDelete(user.id, id),
      'Product deleted',
    );
  }

  @Post(':id/media')
  @ApiOperation({ summary: 'Add product media metadata' })
  async addMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateProductMediaDto,
  ) {
    return successResponse(
      await this.productsService.addMedia(user.id, id, dto),
      'Product media added',
    );
  }

  @Delete(':id/media/:mediaId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete product media' })
  async removeMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ) {
    return successResponse(
      await this.productsService.removeMedia(user.id, id, mediaId),
      'Product media deleted',
    );
  }
}
