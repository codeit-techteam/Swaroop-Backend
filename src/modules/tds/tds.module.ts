import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/index.js';
import { GradeTdsService } from './grade-tds.service.js';

@Module({
  imports: [NotificationsModule],
  providers: [GradeTdsService],
  exports: [GradeTdsService],
})
export class TdsModule {}
