import {
  BadRequestException,
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
import { successResponse } from '../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../auth/index.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';
import { ADMIN_CORE_ROLES } from '../admin/common/admin-roles.js';
import { PaginationQueryDto } from '../master-data/common/pagination.js';
import { GradeImportService } from './grade-import.service.js';
import { SourceOneCsvError } from './source-one/source-one-csv.js';

const MAX_CSV_BYTES = 5 * 1024 * 1024;

type UploadedCsv = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

@ApiTags('Admin Grade Master Import')
@Controller({ version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_CORE_ROLES)
export class AdminGradeImportsController {
  constructor(private readonly imports: GradeImportService) {}

  @Post('admin/grades/import')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Import a Source.One grade master CSV (form field "file"; ?dryRun=true to validate only)',
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_CSV_BYTES, files: 1 } }),
  )
  async import(
    @UploadedFile() file: UploadedCsv | undefined,
    @Query('dryRun') dryRun: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException(
        'Upload the Source.One CSV in the "file" field',
      );
    }
    if (!/\.csv$/i.test(file.originalname)) {
      throw new BadRequestException('Only .csv files are accepted');
    }
    try {
      const summary = await this.imports.run({
        csv: file.buffer.toString('utf8'),
        fileName: file.originalname,
        trigger: 'ADMIN',
        actorUserId: user.id,
        dryRun: dryRun === 'true',
      });
      return successResponse(
        summary,
        summary.dryRun ? 'Grade master validated' : 'Grade master imported',
      );
    } catch (error) {
      if (error instanceof SourceOneCsvError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Get('admin/grade-imports')
  @ApiOperation({ summary: 'Grade master import history' })
  async list(@Query() query: PaginationQueryDto) {
    const { items, meta } = await this.imports.listBatches(
      query.page,
      query.limit,
    );
    return successResponse(items, 'Grade imports retrieved', meta);
  }

  @Get('admin/grade-imports/:id')
  @ApiOperation({
    summary: 'Grade master import detail with validation report',
  })
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.imports.getBatch(id),
      'Grade import retrieved',
    );
  }
}
