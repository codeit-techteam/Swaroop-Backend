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
import {
  AdminCancelDto,
  AdminNoteDto,
  AdminProcurementPrQueryDto,
} from '../procurement/admin-procurement.dto.js';
import { AdminProcurementService } from '../procurement/admin-procurement.service.js';
import { ADMIN_CORE_ROLES } from '../common/admin-roles.js';

/**
 * Thin alias of AdminProcurementService under /admin/purchase-requests.
 * Canonical workbench remains at /admin/procurement/*.
 */
@ApiTags('Admin Purchase Requests')
@Controller({ path: 'admin/purchase-requests', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_CORE_ROLES)
export class AdminPurchaseRequestsController {
  constructor(private readonly adminProcurement: AdminProcurementService) {}

  @Get()
  @ApiOperation({ summary: 'List purchase requests (alias)' })
  async list(@Query() query: AdminProcurementPrQueryDto) {
    const { items, meta } = await this.adminProcurement.list(query);
    return successResponse(items, 'Purchase requests retrieved', meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'PR detail (alias)' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.adminProcurement.findOne(id),
      'Purchase request retrieved',
    );
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: 'PR timeline (alias)' })
  async timeline(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.adminProcurement.timeline(id),
      'Purchase request timeline',
    );
  }

  @Get(':id/negotiation')
  @ApiOperation({ summary: 'PR negotiation (alias)' })
  async negotiation(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.adminProcurement.negotiationHistory(id),
      'Negotiation history',
    );
  }

  @Post(':id/notes')
  @HttpCode(HttpStatus.OK)
  async addNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminNoteDto,
  ) {
    return successResponse(
      await this.adminProcurement.addNote(id, user.id, dto),
      'Note added',
    );
  }

  @Post(':id/mark-review')
  @HttpCode(HttpStatus.OK)
  async markReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.adminProcurement.markReview(id, user.id),
      'Marked for review',
    );
  }

  @Post(':id/escalate')
  @HttpCode(HttpStatus.OK)
  async escalate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.adminProcurement.escalate(id, user.id),
      'Purchase request escalated',
    );
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCancelDto,
  ) {
    return successResponse(
      await this.adminProcurement.cancel(id, user.id, dto),
      'Purchase request cancelled',
    );
  }
}
