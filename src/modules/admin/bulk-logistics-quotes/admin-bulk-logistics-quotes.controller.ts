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
import { ADMIN_OPS_ROLES } from '../common/admin-roles.js';
import {
  AdminBulkLogisticsQuoteNotesDto,
  AdminBulkLogisticsQuotesQueryDto,
} from './admin-bulk-logistics-quotes.dto.js';
import { AdminBulkLogisticsQuotesService } from './admin-bulk-logistics-quotes.service.js';

@ApiTags('Admin Bulk Logistics Quotes')
@Controller({ path: 'admin/bulk-logistics-quotes', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_OPS_ROLES)
export class AdminBulkLogisticsQuotesController {
  constructor(private readonly quotes: AdminBulkLogisticsQuotesService) {}

  @Get()
  @ApiOperation({ summary: 'List bulk logistics quote requests' })
  async list(@Query() query: AdminBulkLogisticsQuotesQueryDto) {
    const { items, meta } = await this.quotes.list(query);
    return successResponse(items, 'Bulk logistics quotes retrieved', meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Bulk logistics quote detail' })
  async getById(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.quotes.getById(id),
      'Bulk logistics quote retrieved',
    );
  }

  @Post(':id/start-review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start reviewing a bulk logistics quote' })
  async startReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.quotes.startReview(id, user.id),
      'Bulk logistics quote review started',
    );
  }

  @Post(':id/mark-quoted')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark bulk logistics quote as quoted' })
  async markQuoted(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminBulkLogisticsQuoteNotesDto,
  ) {
    return successResponse(
      await this.quotes.markQuoted(id, user.id, dto),
      'Bulk logistics quote marked as quoted',
    );
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close a bulk logistics quote request' })
  async close(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminBulkLogisticsQuoteNotesDto,
  ) {
    return successResponse(
      await this.quotes.close(id, user.id, dto),
      'Bulk logistics quote closed',
    );
  }
}
