import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityOwnerType, Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { AdminListQueryDto } from '../common/admin-query.dto.js';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class AdminAuditLogsQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: EntityOwnerType })
  @IsOptional()
  @IsEnum(EntityOwnerType)
  entityType?: EntityOwnerType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional({ description: 'Exact action code filter' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  action?: string;
}

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'refreshToken',
  'accessToken',
  'secret',
  'otp',
  'authorization',
  'apiKey',
  'accessKeyId',
  'secretAccessKey',
  'R2_SECRET_ACCESS_KEY',
  'R2_ACCESS_KEY_ID',
  'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
  'JWT_SECRET',
]);

function scrub(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = scrub(v);
    }
  }
  return out;
}

@Injectable()
export class AdminAuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AdminAuditLogsQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.AuditLogWhereInput = {};
    if (query.entityType) where.entityType = query.entityType;
    if (query.actorUserId) where.actorUserId = query.actorUserId;
    if (query.entityId) where.entityId = query.entityId;
    if (query.action?.trim()) {
      where.action = query.action.trim();
    } else if (query.search?.trim()) {
      where.action = { contains: query.search.trim(), mode: 'insensitive' };
    }
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          actor: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        ...row,
        previousData: scrub(row.previousData),
        newData: scrub(row.newData),
        metadata: scrub(row.metadata),
      })),
      meta: paginationMeta(page, limit, total),
    };
  }

  async findOne(id: string) {
    const row = await this.prisma.auditLog.findUnique({
      where: { id },
      include: {
        actor: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        organization: {
          select: { id: true, name: true, legalName: true },
        },
      },
    });
    if (!row) throw new NotFoundException('Audit log not found');
    return {
      ...row,
      previousData: scrub(row.previousData),
      newData: scrub(row.newData),
      metadata: scrub(row.metadata),
    };
  }
}
