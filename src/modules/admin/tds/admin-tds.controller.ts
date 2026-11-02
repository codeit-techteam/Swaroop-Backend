import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  TdsRequestStatus,
  TdsSourceKind,
  TdsVerificationStatus,
} from '../../../generated/prisma/client.js';
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import { ADMIN_CORE_ROLES } from '../common/admin-roles.js';
import { GradeTdsService } from '../../tds/grade-tds.service.js';
import { isAllowedTdsMime, mimeFromFilename } from '../../tds/tds-normalize.js';

const MAX_TDS_UPLOAD_BYTES = 25 * 1024 * 1024;

type UploadedTdsFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

class AdminTdsListQuery {
  @IsOptional() page?: string;
  @IsOptional() limit?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() producer?: string;
  @IsOptional() @IsEnum(TdsVerificationStatus) status?: TdsVerificationStatus;
  @IsOptional() @IsEnum(TdsSourceKind) sourceKind?: TdsSourceKind;
}

class ApproveDto {
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

class RejectDto {
  @IsString() @MaxLength(2000) reason!: string;
}

class MapGradeDto {
  @IsUUID() gradeId!: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

class UpdateRequestDto {
  @IsOptional() @IsEnum(TdsRequestStatus) status?: TdsRequestStatus;
  @IsOptional() @IsString() @MaxLength(4000) adminNotes?: string;
  @IsOptional() @IsUUID() assignedToUserId?: string;
  @IsOptional() @IsUUID() fulfilledDocumentId?: string;
}

@ApiTags('Admin TDS Library')
@Controller({ path: 'admin/tds', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_CORE_ROLES)
export class AdminTdsController {
  constructor(private readonly tds: GradeTdsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'TDS library dashboard counters' })
  async dashboard() {
    return successResponse(await this.tds.adminDashboard(), 'TDS dashboard');
  }

  @Get('documents')
  async list(@Query() query: AdminTdsListQuery) {
    const { items, meta } = await this.tds.adminList({
      page: Number(query.page) || 1,
      limit: Number(query.limit) || 20,
      q: query.q,
      category: query.category,
      producer: query.producer,
      status: query.status,
      sourceKind: query.sourceKind,
    });
    return successResponse(items, 'TDS documents', meta);
  }

  @Post('documents/upload')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Upload a TDS for a marketplace product (or grade). Optional approveNow=true publishes immediately to customers/sellers.',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_TDS_UPLOAD_BYTES, files: 1 },
    }),
  )
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedTdsFile | undefined,
    @Body('productId') productId?: string,
    @Body('gradeId') gradeId?: string,
    @Body('notes') notes?: string,
    @Body('approveNow') approveNow?: string,
  ) {
    const publish = approveNow === 'true' || approveNow === '1';
    const saved = await this.runUpload(user.id, file, {
      productId: productId?.trim() || undefined,
      gradeId: gradeId?.trim() || undefined,
      notes: notes?.trim() || undefined,
      approveNow: publish,
    });
    return successResponse(
      saved,
      publish
        ? 'TDS uploaded and published'
        : 'TDS uploaded (pending review)',
    );
  }

  @Post('documents/:id/replace')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Replace the file for an existing TDS document (creates a revision)',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_TDS_UPLOAD_BYTES, files: 1 },
    }),
  )
  async replace(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedTdsFile | undefined,
    @Body('productId') productId?: string,
    @Body('gradeId') gradeId?: string,
    @Body('notes') notes?: string,
    @Body('approveNow') approveNow?: string,
  ) {
    const saved = await this.runUpload(user.id, file, {
      id,
      productId: productId?.trim() || undefined,
      gradeId: gradeId?.trim() || undefined,
      notes: notes?.trim() || undefined,
      approveNow: approveNow === 'true' || approveNow === '1',
    });
    return successResponse(saved, 'TDS file replaced');
  }

  @Get('documents/:id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(await this.tds.adminGet(id), 'TDS document');
  }

  @Get('documents/:id/preview')
  async preview(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.tds.adminPreviewUrl(id),
      'TDS preview URL',
    );
  }

  @Post('documents/:id/approve')
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ApproveDto,
  ) {
    return successResponse(
      await this.tds.adminApprove(id, user.id, body.notes),
      'TDS approved',
    );
  }

  @Post('documents/:id/reject')
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RejectDto,
  ) {
    return successResponse(
      await this.tds.adminReject(id, user.id, body.reason),
      'TDS rejected',
    );
  }

  @Post('documents/:id/map-grade')
  async mapGrade(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: MapGradeDto,
  ) {
    return successResponse(
      await this.tds.adminMapGrade(id, body.gradeId, body.notes),
      'TDS mapped',
    );
  }

  @Get('requests')
  async listRequests(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: TdsRequestStatus,
  ) {
    const { items, meta } = await this.tds.adminListRequests({
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      status,
    });
    return successResponse(items, 'TDS requests', meta);
  }

  @Post('requests/:id')
  async updateRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateRequestDto,
  ) {
    return successResponse(
      await this.tds.adminUpdateRequest(id, body),
      'TDS request updated',
    );
  }

  private async runUpload(
    adminUserId: string,
    file: UploadedTdsFile | undefined,
    meta: {
      id?: string;
      productId?: string;
      gradeId?: string;
      notes?: string;
      approveNow?: boolean;
    },
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Upload a PDF or image in the "file" field');
    }
    const mime = file.mimetype || mimeFromFilename(file.originalname);
    if (!isAllowedTdsMime(mime)) {
      throw new BadRequestException(
        'Only PDF, JPEG, PNG, or WebP TDS files are accepted',
      );
    }
    if (!meta.productId && !meta.gradeId && !meta.id) {
      throw new BadRequestException(
        'Select a marketplace product (productId) or gradeId',
      );
    }
    return this.tds.adminUploadReplace({
      id: meta.id,
      productId: meta.productId,
      gradeId: meta.gradeId,
      fileName: file.originalname,
      mimeType: mime,
      body: file.buffer,
      adminUserId,
      notes: meta.notes,
      approveNow: meta.approveNow,
    });
  }
}
