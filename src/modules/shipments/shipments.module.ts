import { Module } from '@nestjs/common';
import { LogisticsModule } from '../logistics/index.js';

/**
 * Shipments boundary — Phase 9 logistics APIs live in LogisticsModule.
 */
@Module({
  imports: [LogisticsModule],
  exports: [LogisticsModule],
})
export class ShipmentsModule {}
