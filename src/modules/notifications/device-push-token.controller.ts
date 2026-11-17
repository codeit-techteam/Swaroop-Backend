import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  UserRateLimit,
  UserRateLimitGuard,
} from '../../common/guards/user-rate-limit.guard.js';
import { successResponse } from '../../common/utils/response.util.js';
import { CurrentUser } from '../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../auth/index.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';
import { AdminNotificationsQueryDto } from '../admin/notifications/admin-notifications.dto.js';
import {
  RegisterDevicePushTokenDto,
  RevokeDevicePushTokenDto,
} from './device-push-token.dto.js';
import { DevicePushTokenService } from './device-push-token.service.js';
import { NotificationService } from './notification.service.js';

const DEVICE_LIMIT = {
  limitConfigKey: 'fcm.deviceRegisterLimit',
  defaultLimit: 30,
  windowMs: 10 * 60 * 1000,
} as const;

@ApiTags('Notifications')
@Controller({ path: 'notifications', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
export class NotificationsInboxController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @ApiOperation({
    summary: 'List in-app notifications for the authenticated user',
  })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AdminNotificationsQueryDto,
  ) {
    const { items, meta } = await this.notifications.listForUser(user.id, query);
    return successResponse(items, 'Notifications retrieved', meta);
  }
}

@ApiTags('Push tokens')
@Controller({ path: 'notifications/devices', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard, UserRateLimitGuard)
@ApiBearerAuth('bearer')
export class DevicePushTokenController {
  constructor(private readonly tokens: DevicePushTokenService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UserRateLimit({
    ...DEVICE_LIMIT,
    bucket: 'fcm-device-register',
    message: 'Too many device registration attempts. Try again later.',
  })
  @ApiOperation({
    summary: 'Register the native FCM token for this account and installation',
  })
  async register(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RegisterDevicePushTokenDto,
  ) {
    const row = await this.tokens.register(user.id, body);
    return successResponse(row, 'Push token registered');
  }

  @Post('revoke')
  @HttpCode(HttpStatus.OK)
  @UserRateLimit({
    ...DEVICE_LIMIT,
    bucket: 'fcm-device-revoke',
    message: 'Too many device revoke attempts. Try again later.',
  })
  @ApiOperation({
    summary: 'Revoke this device token for the signed-in account',
  })
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RevokeDevicePushTokenDto,
  ) {
    return successResponse(
      await this.tokens.revoke(user.id, body.token),
      'Push token revoked',
    );
  }
}
