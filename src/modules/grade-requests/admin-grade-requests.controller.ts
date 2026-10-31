import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '../../common/enums/domain.enums.js';
import { successResponse } from '../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../auth/index.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';
import { AdminGradeRequestsService } from './admin-grade-requests.service.js';
import {
  AdminAssignDto,
  AdminCreateGradeFromRequestDto,
  AdminGradeRequestQueryDto,
  AdminMapGradeDto,
  AdminNoteDto,
  AdminRequestInfoDto,
  AdminStatusDto,
} from './grade-requests.dto.js';

const actorOf = (user: AuthenticatedUser) => ({
  id: user.id,
  roles: user.roles,
});

@ApiTags('Admin Grade Requests')
@Controller({ path: 'admin/grade-requests', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(
  RoleCode.ADMIN,
  RoleCode.SUPER_ADMIN,
  RoleCode.PROCUREMENT_MANAGER,
  RoleCode.OPERATIONS_MANAGER,
)
export class AdminGradeRequestsController {
  constructor(private readonly requests: AdminGradeRequestsService) {}

  @Get()
  @ApiOperation({ summary: 'List/search new-grade requests' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AdminGradeRequestQueryDto,
  ) {
    const { items, meta } = await this.requests.list(query, actorOf(user));
    return successResponse(items, 'Grade requests retrieved', meta);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Counts by status (workbench KPIs)' })
  async summary() {
    return successResponse(
      await this.requests.summary(),
      'Grade request summary retrieved',
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Request detail incl. internal notes and decision history',
  })
  async getById(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.requests.getById(id),
      'Grade request retrieved',
    );
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign the request (defaults to the caller)' })
  async assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminAssignDto,
  ) {
    return successResponse(
      await this.requests.assign(id, dto, actorOf(user)),
      'Grade request assigned',
    );
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update status (validated transitions)' })
  async status(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminStatusDto,
  ) {
    return successResponse(
      await this.requests.changeStatus(id, dto, actorOf(user)),
      'Grade request status updated',
    );
  }

  @Post(':id/request-info')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ask the customer for additional information' })
  async requestInfo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminRequestInfoDto,
  ) {
    return successResponse(
      await this.requests.requestInfo(id, dto, actorOf(user)),
      'Additional information requested',
    );
  }

  @Post(':id/notes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Add an internal note (never shown to the customer)',
  })
  async note(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminNoteDto,
  ) {
    return successResponse(
      await this.requests.addNote(id, dto, actorOf(user)),
      'Note added',
    );
  }

  @Post(':id/map-grade')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Map the request to an existing catalogue grade' })
  async mapGrade(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminMapGradeDto,
  ) {
    return successResponse(
      await this.requests.mapGrade(id, dto, actorOf(user)),
      'Grade mapped',
    );
  }

  /** Creating catalogue data is restricted to core admins. */
  @Post(':id/create-grade')
  @HttpCode(HttpStatus.CREATED)
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'Create an UNPUBLISHED catalogue grade from the request (publish separately in Grade Master)',
  })
  async createGrade(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCreateGradeFromRequestDto,
  ) {
    return successResponse(
      await this.requests.createGrade(id, dto, actorOf(user)),
      'Grade created (unpublished)',
    );
  }

  @Get(':id/documents/:documentId/download')
  @ApiOperation({ summary: 'Short-lived signed download URL (audited)' })
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Query('disposition') disposition?: string,
  ) {
    return successResponse(
      await this.requests.downloadDocument(
        id,
        documentId,
        actorOf(user),
        disposition === 'inline' ? 'inline' : 'attachment',
      ),
      'Download URL generated',
    );
  }
}
