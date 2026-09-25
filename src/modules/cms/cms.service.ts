import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CmsBannerPlacement,
  CmsBannerPlatform,
  CmsBannerStatus,
  EntityOwnerType,
  Prisma,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { paginationMeta, skipTake } from '../master-data/common/pagination.js';
import { sanitizeFileName } from '../documents/common/document-keys.js';
import type {
  CmsBannerQueryDto,
  CreateCmsBannerDto,
  CreateCmsMediaUploadDto,
  TrackCmsBannerDto,
  UpdateCmsBannerDto,
} from './cms.dto.js';
import {
  asMetadata,
  publicPlatformsFor,
  toPublicBanner,
  type CmsAudience,
} from './cms.mapper.js';

const ALLOWED_CREATIVE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

const MAX_BANNER_BYTES = 5 * 1024 * 1024;

@Injectable()
export class CmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private async withMediaUrl<T extends { mediaKey?: string | null }>(
    banner: T,
  ): Promise<T & { mediaUrl: string | null }> {
    return {
      ...banner,
      mediaUrl: await this.storage.resolveMediaUrl(banner.mediaKey),
    };
  }

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
    return this.withMediaUrl(banner);
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
    return {
      items: await Promise.all(items.map((item) => this.withMediaUrl(item))),
      meta: paginationMeta(page, limit, total),
    };
  }

  async findOne(id: string) {
    const banner = await this.prisma.cmsBanner.findFirst({
      where: { id, deletedAt: null },
    });
    if (!banner) throw new NotFoundException('Banner not found');
    return this.withMediaUrl(banner);
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
    return this.withMediaUrl(banner);
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

  async createMediaUpload(dto: CreateCmsMediaUploadDto) {
    const contentType = dto.contentType.toLowerCase();
    if (!ALLOWED_CREATIVE_TYPES.has(contentType)) {
      throw new BadRequestException(
        'Banner creative must be JPEG, PNG, WebP, GIF, or SVG.',
      );
    }
    if (dto.fileSizeBytes && dto.fileSizeBytes > MAX_BANNER_BYTES) {
      throw new BadRequestException('Banner creative must be 5 MB or smaller.');
    }

    this.storage.assertConfigured();
    const mediaKey = `cms/banners/${randomUUID()}-${sanitizeFileName(dto.fileName)}`;
    const uploadUrl = await this.storage.getSignedUrl({
      key: mediaKey,
      operation: 'put',
      contentType: dto.contentType,
      expiresInSeconds: 900,
    });
    const mediaUrl = await this.storage.resolveMediaUrl(mediaKey);

    return { mediaKey, uploadUrl, mediaUrl, contentType: dto.contentType };
  }

  async track(id: string, dto: TrackCmsBannerDto) {
    const banner = await this.prisma.cmsBanner.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!banner) throw new NotFoundException('Banner not found');

    const data =
      dto.event === 'CLICK'
        ? { clickCount: { increment: 1 } }
        : { impressionCount: { increment: 1 } };

    await this.prisma.cmsBanner.update({ where: { id }, data });
    return { id, event: dto.event, recorded: true };
  }

  async listPublic(audience: CmsAudience, query: CmsBannerQueryDto) {
    const now = new Date();
    const platforms = publicPlatformsFor(audience, query.platform);
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
          metadata: true,
        },
      }),
      this.prisma.cmsBanner.count({ where }),
    ]);

    const publicItems = await Promise.all(
      items.map(async (item) => {
        const meta = asMetadata(item.metadata);
        const mobileKey =
          typeof meta.mobileImage === 'string' ? meta.mobileImage : null;
        const [mediaUrl, mobileMediaUrl] = await Promise.all([
          this.storage.resolveMediaUrl(item.mediaKey),
          mobileKey && mobileKey !== item.mediaKey
            ? this.storage.resolveMediaUrl(mobileKey)
            : Promise.resolve(null),
        ]);
        return toPublicBanner(item, mediaUrl, mobileMediaUrl);
      }),
    );

    return { items: publicItems, meta: paginationMeta(page, limit, total) };
  }
}
