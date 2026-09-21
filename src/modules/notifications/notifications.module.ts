import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import {
  CustomerNotificationsController,
  SellerNotificationsController,
} from './actor-notifications.controller.js';
import { NotificationService } from './notification.service.js';

@Module({
  imports: [AuthModule],
  controllers: [CustomerNotificationsController, SellerNotificationsController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationsModule {}
