import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { AuthModule } from '../auth/index.js';
import { DatabaseModule } from '../../database/database.module.js';
import { NotificationsModule } from '../notifications/index.js';
import { AdminSupportController } from './admin-support.controller.js';
import { CustomerSupportController } from './customer-support.controller.js';
import { SellerSupportController } from './seller-support.controller.js';
import { SupportService } from './support.service.js';

@Module({
  imports: [AuthModule, DatabaseModule, AuditModule, NotificationsModule],
  controllers: [
    CustomerSupportController,
    SellerSupportController,
    AdminSupportController,
  ],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
