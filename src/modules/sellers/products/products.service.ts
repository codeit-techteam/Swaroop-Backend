import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EntityOwnerType,
  GradeStatus,
  Prisma,
  ProductStatus,
  SellerStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { handlePrismaUnique } from '../../master-data/common/prisma-helpers.js';
import { SellerAuditService } from '../common/seller-audit.service.js';
import {
  SellerContext,
  SellerContextService,
} from '../common/seller-context.service.js';
import type {
  CreateProductDto,
  CreateProductMediaDto,
  ProductQueryDto,
  UpdateProductDto,
  UpdateProductStatusDto,
} from './products.dto.js';

const productInclude = {
  grade: {
    select: {
      id: true,
      code: true,
      name: true,
      displayName: true,
      status: true,
    },
  },
  media: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.ProductInclude;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellerContext: SellerContextService,
    private readonly audit: SellerAuditService,
  ) {}

  private async ctx(userId: string) {
    return this.sellerContext.requireSeller(userId);
  }

  private async assertOwnedProduct(ctx: SellerContext, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, organizationId: ctx.organizationId, deletedAt: null },
      include: productInclude,
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  private async assertActiveGrade(gradeId: string) {
    const grade = await this.prisma.grade.findFirst({
      where: {
        id: gradeId,
        deletedAt: null,
        status: GradeStatus.ACTIVE,
      },
    });
    if (!grade) {
      throw new BadRequestException(
        'Grade not found or inactive. Select an ACTIVE grade from Grade Master.',
      );
    }
    return grade;
  }

  async create(userId: string, dto: CreateProductDto) {
    const ctx = await this.ctx(userId);
    await this.assertActiveGrade(dto.gradeId);

    try {
      const product = await this.prisma.product.create({
        data: {
          organizationId: ctx.organizationId,
          sellerProfileId: ctx.sellerProfileId,
          gradeId: dto.gradeId,
          code: dto.code.trim().toUpperCase(),
          name: dto.name.trim(),
          brand: dto.brand,
          manufacturer: dto.manufacturer,
          description: dto.description,
          technicalSpecs: dto.technicalSpecs as Prisma.InputJsonValue,
          mfi: dto.mfi,
          density: dto.density,
          packaging: dto.packaging,
          unit: dto.unit ?? 'MT',
          countryOfOrigin: dto.countryOfOrigin,
          supplyOrigin: dto.supplyOrigin,
          status: ProductStatus.DRAFT,
          metadata: dto.metadata as Prisma.InputJsonValue,
          media: dto.media?.length
            ? {
                create: dto.media.map((m) => ({
                  type: m.type,
                  storageKey: m.storageKey,
                  fileName: m.fileName,
                  mimeType: m.mimeType,
                  fileSizeBytes:
                    m.fileSizeBytes != null
                      ? BigInt(m.fileSizeBytes)
                      : undefined,
                  sortOrder: m.sortOrder ?? 0,
                  metadata: m.metadata as Prisma.InputJsonValue,
                })),
              }
            : undefined,
        },
        include: productInclude,
      });

      await this.audit.log({
        action: 'PRODUCT_CREATED',
        actorUserId: userId,
        organizationId: ctx.organizationId,
        entityType: EntityOwnerType.PRODUCT,
        entityId: product.id,
        newData: { code: product.code, status: product.status },
      });

      return this.serialize(product);
    } catch (error) {
      handlePrismaUnique(error, 'Product code already exists for this seller');
    }
  }

  async findAll(userId: string, query: ProductQueryDto) {
    const ctx = await this.ctx(userId);
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.ProductWhereInput = {
      organizationId: ctx.organizationId,
      deletedAt: null,
    };
    if (query.status) where.status = query.status;
    if (query.gradeId) where.gradeId = query.gradeId;
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { brand: { contains: q, mode: 'insensitive' } },
      ];
    }

    const orderByField = query.sortBy === 'name' ? 'name' : 'createdAt';
    const [total, items] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: {
          [orderByField]: query.sortOrder === 'asc' ? 'asc' : 'desc',
        },
        skip,
        take,
      }),
    ]);

    return {
      items: items.map((p) => this.serialize(p)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async findOne(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    return this.serialize(await this.assertOwnedProduct(ctx, id));
  }

  async update(userId: string, id: string, dto: UpdateProductDto) {
    const ctx = await this.ctx(userId);
    const existing = await this.assertOwnedProduct(ctx, id);
    if (dto.gradeId) await this.assertActiveGrade(dto.gradeId);

    try {
      const product = await this.prisma.$transaction(async (tx) => {
        if (dto.media) {
          await tx.productMedia.updateMany({
            where: { productId: id, deletedAt: null },
            data: { deletedAt: new Date() },
          });
          if (dto.media.length) {
            await tx.productMedia.createMany({
              data: dto.media.map((m) => ({
                productId: id,
                type: m.type,
                storageKey: m.storageKey,
                fileName: m.fileName,
                mimeType: m.mimeType,
                fileSizeBytes:
                  m.fileSizeBytes != null ? BigInt(m.fileSizeBytes) : null,
                sortOrder: m.sortOrder ?? 0,
                metadata: m.metadata as Prisma.InputJsonValue,
              })),
            });
          }
        }

        return tx.product.update({
          where: { id },
          data: {
            gradeId: dto.gradeId,
            code: dto.code?.trim().toUpperCase(),
            name: dto.name?.trim(),
            brand: dto.brand,
            manufacturer: dto.manufacturer,
            description: dto.description,
            technicalSpecs:
              dto.technicalSpecs === undefined
                ? undefined
                : (dto.technicalSpecs as Prisma.InputJsonValue),
            mfi: dto.mfi,
            density: dto.density,
            packaging: dto.packaging,
            unit: dto.unit,
            countryOfOrigin: dto.countryOfOrigin,
            supplyOrigin: dto.supplyOrigin,
            metadata:
              dto.metadata === undefined
                ? undefined
                : (dto.metadata as Prisma.InputJsonValue),
          },
          include: productInclude,
        });
      });

      await this.audit.log({
        action: 'PRODUCT_UPDATED',
        actorUserId: userId,
        organizationId: ctx.organizationId,
        entityType: EntityOwnerType.PRODUCT,
        entityId: id,
        previousData: { code: existing.code, status: existing.status },
        newData: { code: product.code, status: product.status },
      });

      return this.serialize(product);
    } catch (error) {
      handlePrismaUnique(error, 'Product code already exists for this seller');
    }
  }

  async publish(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    const product = await this.assertOwnedProduct(ctx, id);
    if (ctx.status !== SellerStatus.APPROVED) {
      throw new BadRequestException(
        'Only APPROVED sellers can publish products',
      );
    }
    if (
      product.status !== ProductStatus.DRAFT &&
      product.status !== ProductStatus.PAUSED &&
      product.status !== ProductStatus.REJECTED
    ) {
      throw new BadRequestException(
        `Cannot publish product in status ${product.status}`,
      );
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: { status: ProductStatus.PENDING_REVIEW },
      include: productInclude,
    });

    await this.audit.log({
      action: 'PRODUCT_PUBLISHED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.PRODUCT,
      entityId: id,
      previousData: { status: product.status },
      newData: { status: updated.status },
    });

    return this.serialize(updated);
  }

  async activate(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    const product = await this.assertOwnedProduct(ctx, id);
    if (ctx.status !== SellerStatus.APPROVED) {
      throw new BadRequestException(
        'Only APPROVED sellers can activate products',
      );
    }
    if (product.status !== ProductStatus.PENDING_REVIEW) {
      throw new BadRequestException(
        'Only PENDING_REVIEW products can be activated',
      );
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: { status: ProductStatus.ACTIVE },
      include: productInclude,
    });

    await this.audit.log({
      action: 'PRODUCT_ACTIVATED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.PRODUCT,
      entityId: id,
      previousData: { status: product.status },
      newData: { status: updated.status },
    });

    return this.serialize(updated);
  }

  async unpublish(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    const product = await this.assertOwnedProduct(ctx, id);
    if (
      product.status !== ProductStatus.ACTIVE &&
      product.status !== ProductStatus.PENDING_REVIEW
    ) {
      throw new BadRequestException(
        `Cannot unpublish product in status ${product.status}`,
      );
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: { status: ProductStatus.PAUSED },
      include: productInclude,
    });

    await this.audit.log({
      action: 'PRODUCT_UNPUBLISHED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.PRODUCT,
      entityId: id,
      previousData: { status: product.status },
      newData: { status: updated.status },
    });

    return this.serialize(updated);
  }

  async updateStatus(userId: string, id: string, dto: UpdateProductStatusDto) {
    const ctx = await this.ctx(userId);
    const product = await this.assertOwnedProduct(ctx, id);
    const updated = await this.prisma.product.update({
      where: { id },
      data: { status: dto.status },
      include: productInclude,
    });

    await this.audit.log({
      action: 'PRODUCT_STATUS_UPDATED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.PRODUCT,
      entityId: id,
      previousData: { status: product.status },
      newData: { status: updated.status },
    });

    return this.serialize(updated);
  }

  async softDelete(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    await this.assertOwnedProduct(ctx, id);
    const updated = await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), status: ProductStatus.ARCHIVED },
      include: productInclude,
    });

    await this.audit.log({
      action: 'PRODUCT_DELETED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.PRODUCT,
      entityId: id,
    });

    return this.serialize(updated);
  }

  async addMedia(
    userId: string,
    productId: string,
    dto: CreateProductMediaDto,
  ) {
    const ctx = await this.ctx(userId);
    await this.assertOwnedProduct(ctx, productId);
    const media = await this.prisma.productMedia.create({
      data: {
        productId,
        type: dto.type,
        storageKey: dto.storageKey,
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        fileSizeBytes:
          dto.fileSizeBytes != null ? BigInt(dto.fileSizeBytes) : undefined,
        sortOrder: dto.sortOrder ?? 0,
        metadata: dto.metadata as Prisma.InputJsonValue,
      },
    });
    return this.serializeMedia(media);
  }

  async removeMedia(userId: string, productId: string, mediaId: string) {
    const ctx = await this.ctx(userId);
    await this.assertOwnedProduct(ctx, productId);
    const media = await this.prisma.productMedia.findFirst({
      where: { id: mediaId, productId, deletedAt: null },
    });
    if (!media) throw new NotFoundException('Product media not found');
    await this.prisma.productMedia.update({
      where: { id: mediaId },
      data: { deletedAt: new Date() },
    });
    return { id: mediaId, deleted: true };
  }

  private serialize(
    product: Prisma.ProductGetPayload<{ include: typeof productInclude }>,
  ) {
    return {
      ...product,
      media: product.media.map((m) => this.serializeMedia(m)),
    };
  }

  private serializeMedia(media: {
    id: string;
    productId: string;
    type: string;
    storageKey: string;
    fileName: string | null;
    mimeType: string | null;
    fileSizeBytes: bigint | null;
    sortOrder: number;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
  }) {
    return {
      ...media,
      fileSizeBytes:
        media.fileSizeBytes != null ? Number(media.fileSizeBytes) : null,
    };
  }
}
