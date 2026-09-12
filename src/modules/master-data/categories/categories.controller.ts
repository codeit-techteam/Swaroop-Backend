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
import { SubcategoriesService } from '../subcategories/subcategories.service.js';
import {
  CategoryQueryDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './categories.dto.js';
import { CategoriesService } from './categories.service.js';

@ApiTags('Master Data - Categories')
@Controller({ path: 'master-data/categories', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly subcategoriesService: SubcategoriesService,
  ) {}

  @Post()
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create grade category' })
  async create(@Body() dto: CreateCategoryDto) {
    const data = await this.categoriesService.create(dto);
    return successResponse(data, 'Category created');
  }

  @Get()
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'List grade categories' })
  async findAll(@Query() query: CategoryQueryDto) {
    const { items, meta } = await this.categoriesService.findAll(query);
    return successResponse(items, 'Categories retrieved', meta);
  }

  @Get('active')
  @ApiOperation({ summary: 'List active grade categories' })
  async findActive() {
    const data = await this.categoriesService.findActive();
    return successResponse(data, 'Active categories retrieved');
  }

  @Get(':categoryId/subcategories')
  @ApiOperation({ summary: 'List subcategories for a category' })
  async findSubcategories(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
  ) {
    const data = await this.subcategoriesService.findByCategory(categoryId);
    return successResponse(data, 'Subcategories retrieved');
  }

  @Get(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get grade category by id' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.categoriesService.findOne(id);
    return successResponse(data, 'Category retrieved');
  }

  @Patch(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update grade category' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    const data = await this.categoriesService.update(id, dto);
    return successResponse(data, 'Category updated');
  }

  @Delete(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete grade category' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.categoriesService.softDelete(id);
    return successResponse(data, 'Category deleted');
  }
}
