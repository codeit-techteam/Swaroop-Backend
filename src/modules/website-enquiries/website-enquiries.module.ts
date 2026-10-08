import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { AuthModule } from '../auth/index.js';
import { DatabaseModule } from '../../database/database.module.js';
import { NotificationsModule } from '../notifications/index.js';
import { AdminWebsiteEnquiriesController } from './admin-website-enquiries.controller.js';
import { PublicWebsiteEnquiriesController } from './public-website-enquiries.controller.js';
import { WebsiteEnquiriesService } from './website-enquiries.service.js';

@Module({
  imports: [AuthModule, DatabaseModule, AuditModule, NotificationsModule],
  controllers: [
    PublicWebsiteEnquiriesController,
    AdminWebsiteEnquiriesController,
  ],
  providers: [WebsiteEnquiriesService],
})
export class WebsiteEnquiriesModule {}
