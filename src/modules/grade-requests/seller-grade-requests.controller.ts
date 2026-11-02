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
import { SellerGradeRequestsService } from './seller-grade-requests.service.js';
import {
  CreateGradeRequestDto,
  SellerGradeRequestQueryDto,
  GradeRequestCancelDto,
  GradeRequestDocumentDto,
  GradeRequestRespondDto,
} from './grade-requests.dto.js';

/**
 * Seller-only: a seller creates and manages THEIR OWN grade requests. Customer
 * requests are never reachable from here (blind-marketplace rule) — every query
 * is scoped to requesterType SELLER + the caller's sellerProfileId.
 */
@ApiTags('Seller Grade Requests')
@Controller({ path: 'seller/grade-requests', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
// SELLER also admits Seller Managers (RolesGuard), gated per-route by permission.
@Roles(RoleCode.SELLER)
export class SellerGradeRequestsController {
  constructor(private readonly requests: SellerGradeRequestsService) {}

  @Get('prefill')
  @ApiOperation({
    summary: 'Company/contact/default-address data to prefill the form',
  })
  async prefill(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.requests.prefill(user.id),
      'Grade request prefill retrieved',
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Request a grade that is not in the catalogue' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateGradeRequestDto,
  ) {
    return successResponse(
      await this.requests.create(user.id, dto),
      'Grade request submitted',
    );
  }

  @Get()
  @ApiOperation({ summary: 'List own new-grade requests' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SellerGradeRequestQueryDto,
  ) {
    const { items, meta } = await this.requests.list(user.id, query);
    return successResponse(items, 'Grade requests retrieved', meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Own grade request with seller-visible timeline' })
  async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.requests.getOne(user.id, id),
      'Grade request retrieved',
    );
  }

  @Post(':id/respond')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Provide the additional information that was requested',
  })
  async respond(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GradeRequestRespondDto,
  ) {
    return successResponse(
      await this.requests.respond(user.id, id, dto),
      'Response submitted',
    );
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an open grade request' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GradeRequestCancelDto,
  ) {
    return successResponse(
      await this.requests.cancel(user.id, id, dto),
      'Grade request cancelled',
    );
  }

  @Post(':id/documents')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Register a supporting document (datasheet/spec). Returns a signed upload URL when storage is configured.',
  })
  async createDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GradeRequestDocumentDto,
  ) {
    return successResponse(
      await this.requests.createDocument(user.id, id, dto),
      'Document registered',
    );
  }

  @Post(':id/documents/:documentId/upload-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Fresh signed upload URL for a registered document',
  })
  async uploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return successResponse(
      await this.requests.documentUploadUrl(user.id, id, documentId),
      'Upload URL generated',
    );
  }

  @Get(':id/documents/:documentId/download')
  @ApiOperation({ summary: 'Signed download URL for an attached document' })
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return successResponse(
      await this.requests.downloadDocument(user.id, id, documentId),
      'Download URL generated',
    );
  }
}
