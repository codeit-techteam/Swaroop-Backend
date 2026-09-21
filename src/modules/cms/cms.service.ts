import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CmsBannerPlacement,
  CmsBannerPlatform,
  CmsBannerStatus,
  EntityOwnerType,
  Prisma,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { paginationMeta, skipTake } from '../master-data/common/pagination.js';
import type {
  CmsBannerQueryDto,
  CreateCmsBannerDto,
  UpdateCmsBannerDto,
} from './cms.dto.js';

@Injectable()
export class CmsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCmsBannerDto, actorUserId?: string) {
    const banner = await this.prisma.cmsBanner.create({
      data: {
        title: dto.title,
        subtitle: dto.subtitle,
        placement: dto.placement ?? CmsBannerPlacement.HOME_HERO,
        platform: dto.platform ?? CmsBannerPlatform.ALL,
        status: dto.status ?? CmsBannerStatus.DRAFT,
        displayOrder: dto.displayOrder ?? 0,
        startAt: dto.startAt ? new Date(dto.startAt) : undefined,
        endAt: dto.endAt ? new Date(dto.endAt) : undefined,
        mediaKey: dto.mediaKey,
        targetRoute: dto.targetRoute,
        createdById: actorUserId,
        metadata: dto.metadata as Prisma.InputJsonValue | undefined,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        action: 'CMS_BANNER_CREATED',
        actorUserId,
        entityType: EntityOwnerType.CMS,
        entityId: banner.id,
        newData: { title: banner.title, status: banner.status },
      },
    });
    return banner;
  }

  async list(query: CmsBannerQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.CmsBannerWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.placement) where.placement = query.placement;
    if (query.platform) where.platform = query.platform;

    const [items, total] = await Promise.all([
      this.prisma.cmsBanner.findMany({
        where,
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      this.prisma.cmsBanner.count({ where }),
    ]);
    return { items, meta: paginationMeta(page, limit, total) };
  }

  async findOne(id: string) {
    const banner = await this.prisma.cmsBanner.findFirst({
      where: { id, deletedAt: null },
    });
    if (!banner) throw new NotFoundException('Banner not found');
    return banner;
  }

  async update(id: string, dto: UpdateCmsBannerDto, actorUserId?: string) {
    await this.findOne(id);
    const banner = await this.prisma.cmsBanner.update({
      where: { id },
      data: {
        title: dto.title,
        subtitle: dto.subtitle,
        placement: dto.placement,
        platform: dto.platform,
        status: dto.status,
        displayOrder: dto.displayOrder,
        startAt: dto.startAt ? new Date(dto.startAt) : undefined,
        endAt: dto.endAt ? new Date(dto.endAt) : undefined,
        mediaKey: dto.mediaKey,
        targetRoute: dto.targetRoute,
        metadata: dto.metadata as Prisma.InputJsonValue | undefined,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        action: 'CMS_BANNER_UPDATED',
        actorUserId,
        entityType: EntityOwnerType.CMS,
        entityId: id,
        newData: { title: banner.title, status: banner.status },
      },
    });
    return banner;
  }

  async remove(id: string, actorUserId?: string) {
    await this.findOne(id);
    await this.prisma.cmsBanner.update({
      where: { id },
      data: { deletedAt: new Date(), status: CmsBannerStatus.ARCHIVED },
    });
    await this.prisma.auditLog.create({
      data: {
        action: 'CMS_BANNER_DELETED',
        actorUserId,
        entityType: EntityOwnerType.CMS,
        entityId: id,
      },
    });
    return { id, deleted: true };
  }

  async listPublic(audience: 'CUSTOMER' | 'SELLER', query: CmsBannerQueryDto) {
    const now = new Date();
    const platforms =
      audience === 'CUSTOMER'
        ? [
            CmsBannerPlatform.ALL,
            CmsBannerPlatform.CUSTOMER_APP,
            CmsBannerPlatform.CUSTOMER_WEB,
          ]
        : [
            CmsBannerPlatform.ALL,
            CmsBannerPlatform.SELLER_APP,
            CmsBannerPlatform.SELLER_WEB,
          ];
    const where: Prisma.CmsBannerWhereInput = {
      deletedAt: null,
      status: CmsBannerStatus.ACTIVE,
      platform: { in: platforms },
      AND: [
        { OR: [{ startAt: null }, { startAt: { lte: now } }] },
        { OR: [{ endAt: null }, { endAt: { gte: now } }] },
      ],
    };
    if (query.placement) where.placement = query.placement;

    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const [items, total] = await Promise.all([
      this.prisma.cmsBanner.findMany({
        where,
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
        skip,
        take,
        select: {
          id: true,
          title: true,
          subtitle: true,
          placement: true,
          platform: true,
          displayOrder: true,
          startAt: true,
          endAt: true,
          mediaKey: true,
          targetRoute: true,
        },
      }),
      this.prisma.cmsBanner.count({ where }),
    ]);
    return { items, meta: paginationMeta(page, limit, total) };
  }
}
