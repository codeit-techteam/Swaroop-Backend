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
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import {
  CreateGradeDto,
  GradeQueryDto,
  UpdateGradeDto,
  UpdateGradeStatusDto,
  UpdateGradeVisibilityDto,
} from '../../master-data/grades/grades.dto.js';
import { GradesService } from '../../master-data/grades/grades.service.js';
import { ADMIN_CORE_ROLES } from '../common/admin-roles.js';

@ApiTags('Admin Grades')
@Controller({ path: 'admin/grades', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_CORE_ROLES)
export class AdminGradesController {
  constructor(private readonly grades: GradesService) {}

  @Post()
  @ApiOperation({ summary: 'Create grade (admin alias)' })
  async create(
    @Body() dto: CreateGradeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return successResponse(
      await this.grades.create(dto, user.id),
      'Grade created',
    );
  }

  @Get()
  @ApiOperation({ summary: 'List grades (admin alias)' })
  async findAll(@Query() query: GradeQueryDto) {
    const { items, meta } = await this.grades.findAll(query, 'admin');
    return successResponse(items, 'Grades retrieved', meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get grade (admin alias)' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.grades.findOne(id, false),
      'Grade retrieved',
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update grade (admin alias)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGradeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return successResponse(
      await this.grades.update(id, dto, user.id),
      'Grade updated',
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete grade (admin alias)' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return successResponse(
      await this.grades.softDelete(id, user.id),
      'Grade deleted',
    );
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update grade status (admin alias)' })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGradeStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return successResponse(
      await this.grades.updateStatus(id, dto, user.id),
      'Grade status updated',
    );
  }

  @Patch(':id/visibility')
  @ApiOperation({ summary: 'Update grade visibility (admin alias)' })
  async updateVisibility(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGradeVisibilityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return successResponse(
      await this.grades.updateVisibility(id, dto, user.id),
      'Grade visibility updated',
    );
  }
}
