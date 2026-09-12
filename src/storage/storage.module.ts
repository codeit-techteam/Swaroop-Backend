import { Global, Module } from '@nestjs/common';
import { CloudflareR2Provider } from './providers/cloudflare-r2.provider.js';
import { NoopStorageProvider } from './providers/noop-storage.provider.js';
import { StorageService } from './storage.service.js';

@Global()
@Module({
  providers: [CloudflareR2Provider, NoopStorageProvider, StorageService],
  exports: [StorageService],
})
export class StorageModule {}
