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
import { Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import {
  CreateWarehouseDto,
  UpdateWarehouseDto,
  WarehouseQueryDto,
} from './warehouses.dto.js';
import { WarehousesService } from './warehouses.service.js';

@ApiTags('Master Data - Warehouses')
@Controller({ path: 'master-data/warehouses', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
export class WarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  @Post()
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create warehouse' })
  async create(@Body() dto: CreateWarehouseDto) {
    return successResponse(
      await this.warehousesService.create(dto),
      'Warehouse created',
    );
  }

  @Get()
  @Roles(
    RoleCode.ADMIN,
    RoleCode.SUPER_ADMIN,
    RoleCode.CUSTOMER,
    RoleCode.SELLER,
  )
  @ApiOperation({ summary: 'List warehouses' })
  async findAll(@Query() query: WarehouseQueryDto) {
    const { items, meta } = await this.warehousesService.findAll(query);
    return successResponse(items, 'Warehouses retrieved', meta);
  }

  @Get(':id')
  @Roles(
    RoleCode.ADMIN,
    RoleCode.SUPER_ADMIN,
    RoleCode.CUSTOMER,
    RoleCode.SELLER,
  )
  @ApiOperation({ summary: 'Get warehouse' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.warehousesService.findOne(id),
      'Warehouse retrieved',
    );
  }

  @Patch(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update warehouse' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWarehouseDto,
  ) {
    return successResponse(
      await this.warehousesService.update(id, dto),
      'Warehouse updated',
    );
  }

  @Delete(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete warehouse' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.warehousesService.softDelete(id),
      'Warehouse deleted',
    );
  }
}
