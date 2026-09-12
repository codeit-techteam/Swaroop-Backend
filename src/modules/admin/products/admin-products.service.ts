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
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { AdminAuditService } from '../common/admin-audit.service.js';
import type {
  AdminCreateProductDto,
  AdminProductsQueryDto,
  AdminUpdateProductDto,
  AdminUpdateProductStatusDto,
} from './admin-products.dto.js';

const productInclude = {
  grade: {
    select: { id: true, code: true, name: true, displayName: true },
  },
  organization: {
    select: { id: true, name: true, legalName: true, code: true },
  },
  sellerProfile: { select: { id: true, status: true } },
} satisfies Prisma.ProductInclude;

@Injectable()
export class AdminProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  async list(query: AdminProductsQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.ProductWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.organizationId) where.organizationId = query.organizationId;
    if (query.gradeId) where.gradeId = query.gradeId;
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { brand: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { items, meta: paginationMeta(page, limit, total) };
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: productInclude,
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async create(dto: AdminCreateProductDto, actorUserId: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: dto.organizationId, deletedAt: null },
      include: { sellerProfile: true },
    });
    if (!org) throw new BadRequestException('Organization not found');
    if (!org.sellerProfile) {
      throw new BadRequestException(
        'organizationId must belong to a seller organization',
      );
    }

    const grade = await this.prisma.grade.findFirst({
      where: { id: dto.gradeId, deletedAt: null, status: GradeStatus.ACTIVE },
    });
    if (!grade) {
      throw new BadRequestException('Grade not found or inactive');
    }

    const product = await this.prisma.product.create({
      data: {
        organizationId: dto.organizationId,
        sellerProfileId: org.sellerProfile.id,
        gradeId: dto.gradeId,
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        brand: dto.brand,
        manufacturer: dto.manufacturer,
        description: dto.description,
        unit: dto.unit ?? 'MT',
        status: ProductStatus.ACTIVE,
      },
      include: productInclude,
    });

    await this.audit.log({
      action: 'ADMIN_PRODUCT_CREATED',
      actorUserId,
      organizationId: dto.organizationId,
      entityType: EntityOwnerType.PRODUCT,
      entityId: product.id,
      newData: { code: product.code, status: product.status },
    });

    return product;
  }

  async update(id: string, dto: AdminUpdateProductDto, actorUserId: string) {
    const existing = await this.findOne(id);
    const product = await this.prisma.product.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        brand: dto.brand,
        manufacturer: dto.manufacturer,
        description: dto.description,
        unit: dto.unit,
      },
      include: productInclude,
    });

    await this.audit.log({
      action: 'ADMIN_PRODUCT_UPDATED',
      actorUserId,
      organizationId: existing.organizationId,
      entityType: EntityOwnerType.PRODUCT,
      entityId: id,
      previousData: { name: existing.name },
      newData: { name: product.name },
    });

    return product;
  }

  async updateStatus(
    id: string,
    dto: AdminUpdateProductStatusDto,
    actorUserId: string,
  ) {
    const existing = await this.findOne(id);
    const product = await this.prisma.product.update({
      where: { id },
      data: { status: dto.status },
      include: productInclude,
    });

    await this.audit.log({
      action: 'ADMIN_PRODUCT_STATUS_UPDATED',
      actorUserId,
      organizationId: existing.organizationId,
      entityType: EntityOwnerType.PRODUCT,
      entityId: id,
      previousData: { status: existing.status },
      newData: { status: dto.status },
    });

    return product;
  }
}
