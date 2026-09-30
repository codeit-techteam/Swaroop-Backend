import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { GoogleMapsClient } from './google-maps.client.js';
import { LocationsController } from './locations.controller.js';
import { LocationsService } from './locations.service.js';

@Module({
  imports: [AuthModule],
  controllers: [LocationsController],
  providers: [GoogleMapsClient, LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
