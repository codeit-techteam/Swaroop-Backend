import {
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
import { NotificationService } from '../../notifications/notification.service.js';
import { ADMIN_CORE_ROLES } from '../common/admin-roles.js';
import { AdminNotificationsQueryDto } from './admin-notifications.dto.js';

@ApiTags('Admin Notifications')
@Controller({ path: 'admin/notifications', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_CORE_ROLES)
export class AdminNotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'List notifications for current admin' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AdminNotificationsQueryDto,
  ) {
    const { items, meta } = await this.notifications.listForUser(
      user.id,
      query,
    );
    return successResponse(items, 'Notifications retrieved', meta);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread notification count' })
  async unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.notifications.unreadCount(user.id),
      'Unread count',
    );
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all notifications read' })
  async markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.notifications.markAllRead(user.id),
      'All notifications marked read',
    );
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark notification read' })
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.notifications.markRead(user.id, id),
      'Notification marked read',
    );
  }
}
