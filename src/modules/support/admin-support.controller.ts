import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { successResponse } from '../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../auth/index.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';
import { ADMIN_SUPPORT_ROLES } from '../admin/common/admin-roles.js';
import {
  ReplySupportTicketDto,
  SupportTicketsQueryDto,
  UpdateSupportTicketStatusDto,
} from './support.dto.js';
import { SupportService } from './support.service.js';

@ApiTags('Admin Support')
@Controller({ path: 'admin/support/tickets', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_SUPPORT_ROLES)
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @ApiOperation({ summary: 'List all support tickets' })
  async list(@Query() query: SupportTicketsQueryDto) {
    const { items, meta } = await this.support.listAdmin(query);
    return successResponse(items, 'Support tickets retrieved', meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a support ticket' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.support.getAdmin(id),
      'Support ticket retrieved',
    );
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update ticket status / assignment' })
  async updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupportTicketStatusDto,
  ) {
    return successResponse(
      await this.support.updateAdmin(
        id,
        {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
        },
        dto,
      ),
      'Support ticket updated',
    );
  }

  @Post(':id/reply')
  @ApiOperation({ summary: 'Reply to a support ticket as agent' })
  async reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplySupportTicketDto,
  ) {
    return successResponse(
      await this.support.replyAdmin(
        id,
        {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
        },
        dto,
      ),
      'Reply added',
    );
  }
}
