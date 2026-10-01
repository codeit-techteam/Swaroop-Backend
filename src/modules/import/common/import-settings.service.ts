import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type ImportSettings,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  DEFAULT_MATCH_WEIGHTS,
  DEFAULT_MIN_MATCH_SCORE,
  type MatchWeights,
} from '../domain/import.constants.js';
import { normalizeWeights } from '../domain/import-matching.js';

export type ResolvedImportSettings = {
  matchWeights: MatchWeights;
  minMatchScore: number;
  allowCustomGrade: boolean;
  nearExpiryHours: number;
  negotiationTtlHours: number;
  notificationChannels: string[];
  updatedAt: Date | null;
  updatedById: string | null;
};

const SETTINGS_ID = 'default';

@Injectable()
export class ImportSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<ResolvedImportSettings> {
    const row = await this.prisma.importSettings.upsert({
      where: { id: SETTINGS_ID },
      update: {},
      create: {
        id: SETTINGS_ID,
        matchWeights: DEFAULT_MATCH_WEIGHTS as unknown as Prisma.InputJsonValue,
        minMatchScore: DEFAULT_MIN_MATCH_SCORE,
      },
    });
    return this.resolve(row);
  }

  async update(
    patch: Partial<Omit<ResolvedImportSettings, 'updatedAt' | 'updatedById'>>,
    actorUserId: string,
  ) {
    await this.get();
    const row = await this.prisma.importSettings.update({
      where: { id: SETTINGS_ID },
      data: {
        ...(patch.matchWeights
          ? {
              matchWeights:
                patch.matchWeights as unknown as Prisma.InputJsonValue,
            }
          : {}),
        ...(patch.minMatchScore !== undefined
          ? { minMatchScore: patch.minMatchScore }
          : {}),
        ...(patch.allowCustomGrade !== undefined
          ? { allowCustomGrade: patch.allowCustomGrade }
          : {}),
        ...(patch.nearExpiryHours !== undefined
          ? { nearExpiryHours: patch.nearExpiryHours }
          : {}),
        ...(patch.negotiationTtlHours !== undefined
          ? { negotiationTtlHours: patch.negotiationTtlHours }
          : {}),
        ...(patch.notificationChannels
          ? { notificationChannels: patch.notificationChannels }
          : {}),
        updatedById: actorUserId,
      },
    });
    return this.resolve(row);
  }

  private resolve(row: ImportSettings): ResolvedImportSettings {
    return {
      matchWeights: normalizeWeights(row.matchWeights),
      minMatchScore: row.minMatchScore,
      allowCustomGrade: row.allowCustomGrade,
      nearExpiryHours: row.nearExpiryHours,
      negotiationTtlHours: row.negotiationTtlHours,
      notificationChannels: row.notificationChannels,
      updatedAt: row.updatedAt,
      updatedById: row.updatedById,
    };
  }
}
