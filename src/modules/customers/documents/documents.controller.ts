import {
  Body,
  Controller,
  Get,
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
  CreateCustomerDocumentDto,
  CustomerDocumentQueryDto,
  ReplaceCustomerDocumentDto,
} from './documents.dto.js';
import { CustomerDocumentsService } from './documents.service.js';

@ApiTags('Customer Documents')
@Controller({ path: 'customer/documents', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.CUSTOMER)
export class CustomerDocumentsController {
  constructor(private readonly documents: CustomerDocumentsService) {}

  @Get()
  @ApiOperation({ summary: 'List customer documents' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CustomerDocumentQueryDto,
  ) {
    const { items, meta } = await this.documents.list(user.id, query);
    return successResponse(items, 'Documents retrieved', meta);
  }

  @Post()
  @ApiOperation({ summary: 'Create document metadata (storage optional)' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCustomerDocumentDto,
  ) {
    return successResponse(
      await this.documents.create(user.id, dto),
      'Document created',
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get document' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.documents.get(user.id, id),
      'Document retrieved',
    );
  }

  @Post(':id/replace')
  @ApiOperation({ summary: 'Replace document (versioned)' })
  async replace(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceCustomerDocumentDto,
  ) {
    return successResponse(
      await this.documents.replace(user.id, id, dto),
      'Document replaced',
    );
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Signed download URL (requires storage)' })
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.documents.download(user.id, id),
      'Download URL',
    );
  }

  @Get(':id/upload-url')
  @ApiOperation({ summary: 'Signed upload URL (requires storage)' })
  async uploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.documents.uploadUrl(user.id, id),
      'Upload URL',
    );
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'List document versions' })
  async versions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.documents.versions(user.id, id),
      'Document versions',
    );
  }
}
