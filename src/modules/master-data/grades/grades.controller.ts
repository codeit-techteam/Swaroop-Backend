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
  CreateGradeDto,
  GradeQueryDto,
  UpdateGradeDto,
  UpdateGradeStatusDto,
  UpdateGradeVisibilityDto,
} from './grades.dto.js';
import { GradesService } from './grades.service.js';

@ApiTags('Master Data - Grades')
@Controller({ path: 'master-data/grades', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
export class GradesController {
  constructor(private readonly gradesService: GradesService) {}

  @Post()
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create grade' })
  async create(
    @Body() dto: CreateGradeDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const data = await this.gradesService.create(dto, user?.id);
    return successResponse(data, 'Grade created');
  }

  @Get()
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'List grades (admin)' })
  async findAll(@Query() query: GradeQueryDto) {
    const { items, meta } = await this.gradesService.findAll(query, 'admin');
    return successResponse(items, 'Grades retrieved', meta);
  }

  @Get('customer')
  @Roles(RoleCode.CUSTOMER, RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'List grades visible to customers' })
  async findCustomer(@Query() query: GradeQueryDto) {
    const { items, meta } = await this.gradesService.findAll(query, 'customer');
    return successResponse(items, 'Grades retrieved', meta);
  }

  @Get('seller')
  @Roles(RoleCode.SELLER, RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'List grades visible to sellers' })
  async findSeller(@Query() query: GradeQueryDto) {
    const { items, meta } = await this.gradesService.findAll(query, 'seller');
    return successResponse(items, 'Grades retrieved', meta);
  }

  @Get(':id')
  @Roles(
    RoleCode.ADMIN,
    RoleCode.SUPER_ADMIN,
    RoleCode.CUSTOMER,
    RoleCode.SELLER,
  )
  @ApiOperation({ summary: 'Get grade by id' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const isAdmin = (user?.roles ?? []).some(
      (r) => r === RoleCode.ADMIN || r === RoleCode.SUPER_ADMIN,
    );
    const data = await this.gradesService.findOne(id, !isAdmin);
    return successResponse(data, 'Grade retrieved');
  }

  @Patch(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update grade' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGradeDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const data = await this.gradesService.update(id, dto, user?.id);
    return successResponse(data, 'Grade updated');
  }

  @Delete(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete grade' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const data = await this.gradesService.softDelete(id, user?.id);
    return successResponse(data, 'Grade deleted');
  }

  @Patch(':id/status')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update grade status' })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGradeStatusDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const data = await this.gradesService.updateStatus(id, dto, user?.id);
    return successResponse(data, 'Grade status updated');
  }

  @Patch(':id/visibility')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update grade visibility' })
  async updateVisibility(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGradeVisibilityDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const data = await this.gradesService.updateVisibility(id, dto, user?.id);
    return successResponse(data, 'Grade visibility updated');
  }

  @Post(':gradeId/applications/:applicationId')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Link application to grade' })
  async linkApplication(
    @Param('gradeId', ParseUUIDPipe) gradeId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ) {
    const data = await this.gradesService.linkApplication(
      gradeId,
      applicationId,
    );
    return successResponse(data, 'Application linked');
  }

  @Delete(':gradeId/applications/:applicationId')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlink application from grade' })
  async unlinkApplication(
    @Param('gradeId', ParseUUIDPipe) gradeId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ) {
    const data = await this.gradesService.unlinkApplication(
      gradeId,
      applicationId,
    );
    return successResponse(data, 'Application unlinked');
  }
}
