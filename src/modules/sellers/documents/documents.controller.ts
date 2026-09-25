import {
  Body,
  Controller,
  Delete,
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
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import {
  DocumentQueryDto,
  RegisterDocumentDto,
  ReplaceDocumentDto,
  UploadDocumentDto,
} from './documents.dto.js';
import { DocumentsService } from './documents.service.js';

@ApiTags('Seller Documents')
@Controller({ path: 'seller/documents', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.SELLER)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  @ApiOperation({ summary: 'List seller documents' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DocumentQueryDto,
  ) {
    const { items, meta } = await this.documentsService.list(user.id, query);
    return successResponse(items, 'Documents retrieved', meta);
  }

  @Post('upload')
  @ApiOperation({ summary: 'Create document metadata + signed upload URL' })
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UploadDocumentDto,
  ) {
    return successResponse(
      await this.documentsService.upload(user.id, dto),
      'Document upload created',
    );
  }

  @Post('register')
  @ApiOperation({ summary: 'Register document after completed R2 upload' })
  async register(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterDocumentDto,
  ) {
    return successResponse(
      await this.documentsService.register(user.id, dto),
      'Document registered',
    );
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm R2 upload and submit document for admin review',
  })
  async confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.documentsService.submitForReview(user.id, id),
      'Document submitted for admin review',
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get document' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.documentsService.get(user.id, id),
      'Document retrieved',
    );
  }

  @Post(':id/replace')
  @ApiOperation({ summary: 'Replace document (versioned)' })
  async replace(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceDocumentDto,
  ) {
    return successResponse(
      await this.documentsService.replace(user.id, id, dto),
      'Document replaced',
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete document' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.documentsService.remove(user.id, id),
      'Document deleted',
    );
  }

  @Get(':id/upload-url')
  @ApiOperation({
    summary: 'Signed upload URL (requires storage configured)',
  })
  async uploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.documentsService.uploadUrl(user.id, id),
      'Upload URL',
    );
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Signed download URL' })
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.documentsService.download(user.id, id),
      'Download URL',
    );
  }

  @Get(':id/preview')
  @ApiOperation({ summary: 'Signed preview URL' })
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.documentsService.preview(user.id, id),
      'Preview URL',
    );
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'List document versions' })
  async versions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.documentsService.versions(user.id, id),
      'Document versions',
    );
  }
}
