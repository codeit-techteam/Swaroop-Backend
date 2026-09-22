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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import {
  PatchProductDocumentDto,
  ReplaceProductDocumentDto,
  UploadProductDocumentDto,
} from './product-documents.dto.js';
import { ProductDocumentsService } from './product-documents.service.js';

@ApiTags('Seller Product Documents')
@Controller({ path: 'seller/products/:productId/documents', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.SELLER)
export class ProductDocumentsController {
  constructor(private readonly productDocuments: ProductDocumentsService) {}

  @Get()
  @ApiOperation({ summary: 'List product technical documents' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return successResponse(
      await this.productDocuments.listForProduct(user.id, productId),
      'Product documents retrieved',
    );
  }

  @Post()
  @ApiOperation({
    summary: 'Upload product document metadata + signed PUT URL',
  })
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UploadProductDocumentDto,
  ) {
    return successResponse(
      await this.productDocuments.uploadForProduct(user.id, productId, dto),
      'Product document upload created',
    );
  }

  @Get(':documentId')
  @ApiOperation({ summary: 'Get product document' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return successResponse(
      await this.productDocuments.getForProduct(
        user.id,
        productId,
        documentId,
      ),
      'Product document retrieved',
    );
  }

  @Patch(':documentId')
  @ApiOperation({ summary: 'Update product document metadata' })
  async patch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: PatchProductDocumentDto,
  ) {
    return successResponse(
      await this.productDocuments.patchForProduct(
        user.id,
        productId,
        documentId,
        dto,
      ),
      'Product document updated',
    );
  }

  @Post(':documentId/replace')
  @ApiOperation({ summary: 'Replace product document (new version)' })
  async replace(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: ReplaceProductDocumentDto,
  ) {
    return successResponse(
      await this.productDocuments.replaceForProduct(
        user.id,
        productId,
        documentId,
        dto,
      ),
      'Product document replaced',
    );
  }

  @Delete(':documentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive product document' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return successResponse(
      await this.productDocuments.archiveForProduct(
        user.id,
        productId,
        documentId,
      ),
      'Product document archived',
    );
  }

  @Get(':documentId/download')
  @ApiOperation({ summary: 'Signed download URL for seller' })
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return successResponse(
      await this.productDocuments.downloadForProduct(
        user.id,
        productId,
        documentId,
      ),
      'Download URL',
    );
  }

  @Get(':documentId/upload-url')
  @ApiOperation({ summary: 'Refresh signed upload URL' })
  async uploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return successResponse(
      await this.productDocuments.uploadUrlForProduct(
        user.id,
        productId,
        documentId,
      ),
      'Upload URL',
    );
  }

  @Get(':documentId/versions')
  @ApiOperation({ summary: 'List document version history' })
  async versions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return successResponse(
      await this.productDocuments.versionsForProduct(
        user.id,
        productId,
        documentId,
      ),
      'Document versions',
    );
  }
}
