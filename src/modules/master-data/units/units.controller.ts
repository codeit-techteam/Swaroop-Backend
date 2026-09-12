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
import { CreateUnitDto, UnitQueryDto, UpdateUnitDto } from './units.dto.js';
import { UnitsService } from './units.service.js';

@ApiTags('Master Data - Units')
@Controller({ path: 'master-data/units', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
export class UnitsController {
  constructor(private readonly unitsService: UnitsService) {}

  @Post()
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create unit' })
  async create(@Body() dto: CreateUnitDto) {
    return successResponse(await this.unitsService.create(dto), 'Unit created');
  }

  @Get()
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'List units' })
  async findAll(@Query() query: UnitQueryDto) {
    const { items, meta } = await this.unitsService.findAll(query);
    return successResponse(items, 'Units retrieved', meta);
  }

  @Get('active')
  @Roles(
    RoleCode.ADMIN,
    RoleCode.SUPER_ADMIN,
    RoleCode.CUSTOMER,
    RoleCode.SELLER,
  )
  @ApiOperation({ summary: 'List active units' })
  async findActive() {
    return successResponse(
      await this.unitsService.findActive(),
      'Units retrieved',
    );
  }

  @Get(':id')
  @Roles(
    RoleCode.ADMIN,
    RoleCode.SUPER_ADMIN,
    RoleCode.CUSTOMER,
    RoleCode.SELLER,
  )
  @ApiOperation({ summary: 'Get unit' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.unitsService.findOne(id),
      'Unit retrieved',
    );
  }

  @Patch(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update unit' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUnitDto,
  ) {
    return successResponse(
      await this.unitsService.update(id, dto),
      'Unit updated',
    );
  }

  @Delete(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete unit' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.unitsService.softDelete(id),
      'Unit deleted',
    );
  }
}
