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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { successResponse } from '../../../common/utils/response.util.js';
import { Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import {
  CreateLocationDto,
  LocationQueryDto,
  UpdateLocationDto,
} from './locations.dto.js';
import { LocationsService } from './locations.service.js';

@ApiTags('Master Data - Locations')
@Controller({ path: 'master-data/locations', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Post()
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create location' })
  async create(@Body() dto: CreateLocationDto) {
    return successResponse(
      await this.locationsService.create(dto),
      'Location created',
    );
  }

  @Get()
  @Roles(
    RoleCode.ADMIN,
    RoleCode.SUPER_ADMIN,
    RoleCode.CUSTOMER,
    RoleCode.SELLER,
  )
  @ApiOperation({ summary: 'List locations' })
  async findAll(@Query() query: LocationQueryDto) {
    const { items, meta } = await this.locationsService.findAll(query);
    return successResponse(items, 'Locations retrieved', meta);
  }

  @Get('countries')
  @Roles(
    RoleCode.ADMIN,
    RoleCode.SUPER_ADMIN,
    RoleCode.CUSTOMER,
    RoleCode.SELLER,
  )
  @ApiOperation({ summary: 'List countries' })
  async countries() {
    return successResponse(
      await this.locationsService.findCountries(),
      'Countries retrieved',
    );
  }

  @Get('states')
  @Roles(
    RoleCode.ADMIN,
    RoleCode.SUPER_ADMIN,
    RoleCode.CUSTOMER,
    RoleCode.SELLER,
  )
  @ApiQuery({ name: 'countryId', required: true })
  @ApiOperation({ summary: 'List states for a country' })
  async states(@Query('countryId', ParseUUIDPipe) countryId: string) {
    return successResponse(
      await this.locationsService.findStates(countryId),
      'States retrieved',
    );
  }

  @Get('cities')
  @Roles(
    RoleCode.ADMIN,
    RoleCode.SUPER_ADMIN,
    RoleCode.CUSTOMER,
    RoleCode.SELLER,
  )
  @ApiQuery({ name: 'stateId', required: true })
  @ApiOperation({ summary: 'List cities for a state' })
  async cities(@Query('stateId', ParseUUIDPipe) stateId: string) {
    return successResponse(
      await this.locationsService.findCities(stateId),
      'Cities retrieved',
    );
  }

  @Get(':id')
  @Roles(
    RoleCode.ADMIN,
    RoleCode.SUPER_ADMIN,
    RoleCode.CUSTOMER,
    RoleCode.SELLER,
  )
  @ApiOperation({ summary: 'Get location' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.locationsService.findOne(id),
      'Location retrieved',
    );
  }

  @Patch(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update location' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return successResponse(
      await this.locationsService.update(id, dto),
      'Location updated',
    );
  }

  @Delete(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete location' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.locationsService.softDelete(id),
      'Location deleted',
    );
  }
}
