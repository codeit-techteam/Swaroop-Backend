import {
  Body,
  Controller,
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
  AdjustInventoryDto,
  CreateInventoryDto,
  InventoryQueryDto,
  ReserveInventoryDto,
  UpdateInventoryDto,
} from './inventory.dto.js';
import { InventoryService } from './inventory.service.js';

@ApiTags('Seller Inventory')
@Controller({ path: 'seller/inventory', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.SELLER)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post()
  @ApiOperation({ summary: 'Create inventory record' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInventoryDto,
  ) {
    return successResponse(
      await this.inventoryService.create(user.id, dto),
      'Inventory created',
    );
  }

  @Get()
  @ApiOperation({ summary: 'List inventory' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: InventoryQueryDto,
  ) {
    const { items, meta } = await this.inventoryService.findAll(user.id, query);
    return successResponse(items, 'Inventory retrieved', meta);
  }

  @Get('low-stock')
  @ApiOperation({ summary: 'List low-stock inventory' })
  async lowStock(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: InventoryQueryDto,
  ) {
    const { items, meta } = await this.inventoryService.lowStock(
      user.id,
      query,
    );
    return successResponse(items, 'Low stock inventory retrieved', meta);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Inventory summary for seller' })
  async summary(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.inventoryService.summary(user.id),
      'Inventory summary retrieved',
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get inventory by id' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.inventoryService.findOne(user.id, id),
      'Inventory retrieved',
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Patch inventory fields' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInventoryDto,
  ) {
    return successResponse(
      await this.inventoryService.update(user.id, id, dto),
      'Inventory updated',
    );
  }

  @Post(':id/adjust')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Adjust inventory qty with stock movement' })
  async adjust(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustInventoryDto,
  ) {
    return successResponse(
      await this.inventoryService.adjust(user.id, id, dto),
      'Inventory adjusted',
    );
  }

  @Post(':id/reserve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reserve inventory quantity transactionally' })
  async reserve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReserveInventoryDto,
  ) {
    return successResponse(
      await this.inventoryService.reserve(user.id, id, dto),
      'Inventory reserved',
    );
  }

  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Release previously reserved inventory' })
  async release(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReserveInventoryDto,
  ) {
    return successResponse(
      await this.inventoryService.release(user.id, id, dto),
      'Inventory released',
    );
  }
}
