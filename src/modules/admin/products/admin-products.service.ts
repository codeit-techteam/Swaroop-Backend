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
    select: {
      id: true,
      code: true,
      name: true,
      displayName: true,
      gradeNo: true,
      manufacturer: true,
      gradeGroup: true,
    },
  },
  organization: {
    select: { id: true, name: true, legalName: true, code: true },
  },
  sellerProfile: { select: { id: true, status: true } },
} satisfies Prisma.ProductInclude;

/** Turn filenames / codes into searchable tokens: ABS_EXTRUSION_SR101_TDS.pdf → ["SR101", ...] */
function searchTokensFromQuery(raw: string): string[] {
  const cleaned = raw
    .replace(/\.(pdf|png|jpe?g|webp)$/i, '')
    .replace(/[_\-/]+/g, ' ')
    .replace(/\b(TDS|TECHNICAL|DATA|SHEET|DOCUMENT)\b/gi, ' ')
    .trim();
  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  // Prefer distinctive grade-like tokens (letters+digits) first.
  tokens.sort((a, b) => {
    const score = (t: string) =>
      (/[A-Z]/i.test(t) && /\d/.test(t) ? 0 : t.length >= 4 ? 1 : 2);
    return score(a) - score(b) || b.length - a.length;
  });
  return [...new Set(tokens)].slice(0, 6);
}

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
      const tokens = searchTokensFromQuery(q);
      const phrases = [q, ...tokens].filter(Boolean);
      const fieldMatchers = (term: string): Prisma.ProductWhereInput[] => [
        { code: { contains: term, mode: 'insensitive' } },
        { name: { contains: term, mode: 'insensitive' } },
        { brand: { contains: term, mode: 'insensitive' } },
        { manufacturer: { contains: term, mode: 'insensitive' } },
        {
          grade: {
            is: {
              OR: [
                { code: { contains: term, mode: 'insensitive' } },
                { name: { contains: term, mode: 'insensitive' } },
                { displayName: { contains: term, mode: 'insensitive' } },
                { gradeNo: { contains: term, mode: 'insensitive' } },
                { manufacturer: { contains: term, mode: 'insensitive' } },
                { gradeGroup: { contains: term, mode: 'insensitive' } },
              ],
            },
          },
        },
      ];
      where.OR = phrases.flatMap((term) => fieldMatchers(term));
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
