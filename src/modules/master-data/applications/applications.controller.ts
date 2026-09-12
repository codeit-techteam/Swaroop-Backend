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
  ApplicationQueryDto,
  CreateApplicationDto,
  UpdateApplicationDto,
} from './applications.dto.js';
import { ApplicationsService } from './applications.service.js';

@ApiTags('Master Data - Applications')
@Controller({ path: 'master-data/applications', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Post()
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create application' })
  async create(@Body() dto: CreateApplicationDto) {
    const data = await this.applicationsService.create(dto);
    return successResponse(data, 'Application created');
  }

  @Get()
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'List applications' })
  async findAll(@Query() query: ApplicationQueryDto) {
    const { items, meta } = await this.applicationsService.findAll(query);
    return successResponse(items, 'Applications retrieved', meta);
  }

  @Get('active')
  @ApiOperation({ summary: 'List active applications' })
  async findActive() {
    const data = await this.applicationsService.findActive();
    return successResponse(data, 'Active applications retrieved');
  }

  @Get(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get application by id' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.applicationsService.findOne(id);
    return successResponse(data, 'Application retrieved');
  }

  @Patch(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update application' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApplicationDto,
  ) {
    const data = await this.applicationsService.update(id, dto);
    return successResponse(data, 'Application updated');
  }

  @Delete(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete application' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.applicationsService.softDelete(id);
    return successResponse(data, 'Application deleted');
  }
}
