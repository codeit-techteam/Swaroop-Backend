import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration.js';
import { GradeImportService } from './grade-import.service.js';

/**
 * Loads the bundled Source.One grade master once per file version.
 * Disable with GRADE_MASTER_BUNDLED_IMPORT=false (then use the Admin import
 * or `npm run import:grades`).
 */
@Injectable()
export class GradeMasterBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(GradeMasterBootstrap.name);

  constructor(
    private readonly imports: GradeImportService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    if (this.config.get<AppConfig['app']>('app')?.env === 'test') return;
    if (this.config.get<boolean>('gradeMaster.bundledImport') === false) return;

    void this.imports.importBundledIfNew().catch((error: unknown) => {
      this.logger.error(
        'Bundled Source.One grade import failed',
        error instanceof Error ? error.stack : String(error),
      );
    });
  }
}
