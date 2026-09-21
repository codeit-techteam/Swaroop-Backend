import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { AdminCmsController } from './admin-cms.controller.js';
import { CmsService } from './cms.service.js';
import {
  CustomerCmsController,
  SellerCmsController,
} from './public-cms.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [AdminCmsController, CustomerCmsController, SellerCmsController],
  providers: [CmsService],
  exports: [CmsService],
})
export class CmsModule {}
