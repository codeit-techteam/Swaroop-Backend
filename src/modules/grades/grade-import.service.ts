import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { GradeImportStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { paginationMeta, skipTake } from '../master-data/common/pagination.js';
import { assertFound } from '../master-data/common/prisma-helpers.js';
import { SOURCE_ONE, sha256 } from './source-one/source-one-csv.js';
import { BUNDLED_SOURCE_ONE_CSV } from './source-one/source-one-files.js';
import {
  type GradeImportOptions,
  importSourceOneGrades,
} from './source-one/source-one-importer.js';

@Injectable()
export class GradeImportService {
  private readonly logger = new Logger(GradeImportService.name);

  constructor(private readonly prisma: PrismaService) {}

  run(options: GradeImportOptions) {
    return importSourceOneGrades(this.prisma, options);
  }

  /**
   * Imports the CSV shipped with the release once per file version (sha256).
   * Re-deploys of the same file do nothing; a new committed export is synced
   * on the next deploy without touching Admin-managed fields.
   */
  async importBundledIfNew() {
    const csv = readFileSync(
      join(process.cwd(), BUNDLED_SOURCE_ONE_CSV),
      'utf8',
    );
    const done = await this.prisma.gradeImportBatch.findFirst({
      where: {
        source: SOURCE_ONE,
        fileSha256: sha256(csv),
        status: GradeImportStatus.COMPLETED,
      },
      select: { id: true },
    });
    if (done) return null;

    const summary = await this.run({
      csv,
      fileName: BUNDLED_SOURCE_ONE_CSV.split('/').pop()!,
      trigger: 'BUNDLED',
    });
    this.logger.log(
      `Source.One grade master imported ${JSON.stringify(summary)}`,
    );
    return summary;
  }

  async listBatches(page?: number, limit?: number) {
    const paging = skipTake(page, limit);
    const [total, items] = await this.prisma.$transaction([
      this.prisma.gradeImportBatch.count(),
      this.prisma.gradeImportBatch.findMany({
        orderBy: { startedAt: 'desc' },
        skip: paging.skip,
        take: paging.take,
        omit: { report: true },
      }),
    ]);
    return { items, meta: paginationMeta(paging.page, paging.limit, total) };
  }

  async getBatch(id: string) {
    return assertFound(
      await this.prisma.gradeImportBatch.findUnique({ where: { id } }),
      'Grade import not found',
    );
  }
}
