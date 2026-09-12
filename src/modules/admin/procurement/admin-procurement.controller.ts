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
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import {
  AdminCancelDto,
  AdminNoteDto,
  AdminProcurementPrQueryDto,
} from './admin-procurement.dto.js';
import { AdminProcurementService } from './admin-procurement.service.js';

@ApiTags('Admin Procurement')
@Controller({ path: 'admin/procurement', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
export class AdminProcurementController {
  constructor(private readonly adminProcurement: AdminProcurementService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Procurement workbench summary counts' })
  async summary() {
    return successResponse(
      await this.adminProcurement.summary(),
      'Procurement summary',
    );
  }

  @Get('purchase-requests')
  @ApiOperation({ summary: 'List purchase requests with full identity' })
  async list(@Query() query: AdminProcurementPrQueryDto) {
    const { items, meta } = await this.adminProcurement.list(query);
    return successResponse(items, 'Purchase requests retrieved', meta);
  }

  @Get('purchase-requests/:id')
  @ApiOperation({ summary: 'PR detail with customer + seller org identity' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.adminProcurement.findOne(id),
      'Purchase request retrieved',
    );
  }

  @Get('purchase-requests/:id/timeline')
  @ApiOperation({ summary: 'PR event timeline' })
  async timeline(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.adminProcurement.timeline(id),
      'Purchase request timeline',
    );
  }

  @Get('purchase-requests/:id/negotiation')
  @ApiOperation({ summary: 'Full negotiation history (admin identities)' })
  async negotiation(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.adminProcurement.negotiationHistory(id),
      'Negotiation history',
    );
  }

  @Post('purchase-requests/:id/notes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add admin note to PR timeline' })
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

  @Post('purchase-requests/:id/mark-review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark PR for admin review' })
  async markReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.adminProcurement.markReview(id, user.id),
      'Marked for review',
    );
  }

  @Post('purchase-requests/:id/escalate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Escalate PR priority' })
  async escalate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.adminProcurement.escalate(id, user.id),
      'Purchase request escalated',
    );
  }

  @Post('purchase-requests/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel PR (not allowed if converted to order)' })
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
