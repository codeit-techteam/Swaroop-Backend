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
  CreateSubcategoryDto,
  SubcategoryQueryDto,
  UpdateSubcategoryDto,
} from './subcategories.dto.js';
import { SubcategoriesService } from './subcategories.service.js';

@ApiTags('Master Data - Subcategories')
@Controller({ path: 'master-data/subcategories', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
export class SubcategoriesController {
  constructor(private readonly subcategoriesService: SubcategoriesService) {}

  @Post()
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create subcategory' })
  async create(@Body() dto: CreateSubcategoryDto) {
    const data = await this.subcategoriesService.create(dto);
    return successResponse(data, 'Subcategory created');
  }

  @Get()
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'List subcategories' })
  async findAll(@Query() query: SubcategoryQueryDto) {
    const { items, meta } = await this.subcategoriesService.findAll(query);
    return successResponse(items, 'Subcategories retrieved', meta);
  }

  @Get(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get subcategory by id' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.subcategoriesService.findOne(id);
    return successResponse(data, 'Subcategory retrieved');
  }

  @Patch(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update subcategory' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubcategoryDto,
  ) {
    const data = await this.subcategoriesService.update(id, dto);
    return successResponse(data, 'Subcategory updated');
  }

  @Delete(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete subcategory' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.subcategoriesService.softDelete(id);
    return successResponse(data, 'Subcategory deleted');
  }
}
