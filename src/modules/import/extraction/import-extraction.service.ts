import { Injectable } from '@nestjs/common';
import type {
  ImportListingSource,
  ImportSide,
} from '../../../generated/prisma/client.js';

/**
 * Contract for future free-text / WhatsApp intake ("Need 500 MT PVC K67 CFR
 * Mundra..."). No vendor is wired: the default implementation reports that
 * extraction is unavailable so callers fall back to the structured form.
 * Extracted values are only ever used to pre-fill a DRAFT that the user reviews;
 * they never publish on their own.
 */
export type ExtractedField<T = string> = {
  value: T;
  /** 0..1 */
  confidence: number;
};

export type ImportExtractionResult = {
  available: boolean;
  source: ImportListingSource;
  side: ImportSide | null;
  rawInput: string;
  fields: Partial<Record<string, ExtractedField<string | number>>>;
  warnings: string[];
};

export abstract class ImportExtractor {
  abstract extract(
    rawInput: string,
    source: ImportListingSource,
  ): Promise<ImportExtractionResult>;
}

@Injectable()
export class UnavailableImportExtractor extends ImportExtractor {
  async extract(
    rawInput: string,
    source: ImportListingSource,
  ): Promise<ImportExtractionResult> {
    return {
      available: false,
      source,
      side: null,
      rawInput,
      fields: {},
      warnings: [
        'Automatic extraction is not configured. Fill the form manually.',
      ],
    };
  }
}
