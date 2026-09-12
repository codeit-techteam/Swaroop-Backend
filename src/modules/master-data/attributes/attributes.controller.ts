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
  AttributeQueryDto,
  CreateAttributeDto,
  UpdateAttributeDto,
} from './attributes.dto.js';
import { AttributesService } from './attributes.service.js';

@ApiTags('Master Data - Attributes')
@Controller({ path: 'master-data/attributes', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
export class AttributesController {
  constructor(private readonly attributesService: AttributesService) {}

  @Post()
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create product attribute' })
  async create(@Body() dto: CreateAttributeDto) {
    return successResponse(
      await this.attributesService.create(dto),
      'Attribute created',
    );
  }

  @Get()
  @Roles(
    RoleCode.ADMIN,
    RoleCode.SUPER_ADMIN,
    RoleCode.CUSTOMER,
    RoleCode.SELLER,
  )
  @ApiOperation({ summary: 'List product attributes' })
  async findAll(@Query() query: AttributeQueryDto) {
    const { items, meta } = await this.attributesService.findAll(query);
    return successResponse(items, 'Attributes retrieved', meta);
  }

  @Get(':id')
  @Roles(
    RoleCode.ADMIN,
    RoleCode.SUPER_ADMIN,
    RoleCode.CUSTOMER,
    RoleCode.SELLER,
  )
  @ApiOperation({ summary: 'Get product attribute' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.attributesService.findOne(id),
      'Attribute retrieved',
    );
  }

  @Patch(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update product attribute' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAttributeDto,
  ) {
    return successResponse(
      await this.attributesService.update(id, dto),
      'Attribute updated',
    );
  }

  @Delete(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete product attribute' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.attributesService.softDelete(id),
      'Attribute deleted',
    );
  }
}
