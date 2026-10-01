import { type CanActivate, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImportException } from '../domain/import.errors.js';

/** Applied to every user-facing Import controller (not Admin master data). */
@Injectable()
export class ImportFeatureGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    if (this.config.get<boolean>('import.enabled') === false) {
      throw new ImportException('IMPORT_FEATURE_DISABLED');
    }
    return true;
  }
}
