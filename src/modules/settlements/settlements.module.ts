import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/index.js';

/**
 * Settlements boundary — re-exports payment/settlement services from PaymentsModule.
 */
@Module({
  imports: [PaymentsModule],
  exports: [PaymentsModule],
})
export class SettlementsModule {}
