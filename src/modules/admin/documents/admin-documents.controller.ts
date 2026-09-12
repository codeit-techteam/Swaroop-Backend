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
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import { ADMIN_COMPLIANCE_ROLES } from '../common/admin-roles.js';
import { AdminExpiringQueryDto } from '../common/admin-query.dto.js';
import {
  AdminDocumentActionDto,
  AdminDocumentsQueryDto,
} from './admin-documents.dto.js';
import { AdminDocumentsService } from './admin-documents.service.js';

@ApiTags('Admin Documents')
@Controller({ path: 'admin/documents', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_COMPLIANCE_ROLES)
export class AdminDocumentsController {
  constructor(private readonly documents: AdminDocumentsService) {}

  @Get()
  @ApiOperation({ summary: 'List documents' })
  async list(@Query() query: AdminDocumentsQueryDto) {
    const { items, meta } = await this.documents.list(query);
    return successResponse(items, 'Documents retrieved', meta);
  }

  @Get('expiring')
  @ApiOperation({ summary: 'Documents expiring within N days' })
  async expiring(@Query() query: AdminExpiringQueryDto) {
    return successResponse(
      await this.documents.expiring(query.days),
      'Expiring documents',
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Document detail' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.documents.findOne(id),
      'Document retrieved',
    );
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'List document versions' })
  async versions(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.documents.versions(id),
      'Document versions',
    );
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Signed download URL' })
  async download(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.documents.download(id),
      'Download URL generated',
    );
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve/verify document' })
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminDocumentActionDto,
  ) {
    return successResponse(
      await this.documents.approve(id, user.id, dto),
      'Document approved',
    );
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject document' })
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminDocumentActionDto,
  ) {
    return successResponse(
      await this.documents.reject(id, user.id, dto),
      'Document rejected',
    );
  }
}
