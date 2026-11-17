import { Module } from '@nestjs/common';
import { UserRateLimitGuard } from '../../common/guards/user-rate-limit.guard.js';
import { AuthModule } from '../auth/index.js';
import {
  CustomerNotificationsController,
  SellerNotificationsController,
} from './actor-notifications.controller.js';
import {
  DevicePushTokenController,
  NotificationsInboxController,
} from './device-push-token.controller.js';
import { DevicePushTokenService } from './device-push-token.service.js';
import { FcmDispatcher } from './fcm.dispatcher.js';
import { FirebaseMessagingService } from './firebase-messaging.service.js';
import { NotificationService } from './notification.service.js';

@Module({
  imports: [AuthModule],
  controllers: [
    CustomerNotificationsController,
    SellerNotificationsController,
    NotificationsInboxController,
    DevicePushTokenController,
  ],
  providers: [
    NotificationService,
    DevicePushTokenService,
    FirebaseMessagingService,
    FcmDispatcher,
    UserRateLimitGuard,
  ],
  exports: [NotificationService, FirebaseMessagingService],
})
export class NotificationsModule {}
