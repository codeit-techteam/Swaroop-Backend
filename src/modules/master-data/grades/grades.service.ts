import { BadRequestException, Injectable } from '@nestjs/common';
import {
  EntityOwnerType,
  GradeImportStatus,
  GradeStatus,
  MasterStatus,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { AdminAuditService } from '../../admin/common/admin-audit.service.js';
import {
  paginationMeta,
  resolveSearch,
  skipTake,
} from '../common/pagination.js';
import { assertFound, handlePrismaUnique } from '../common/prisma-helpers.js';
import type {
  CreateGradeDto,
  GradeFacetQueryDto,
  GradeQueryDto,
  UpdateGradeDto,
  UpdateGradeStatusDto,
  UpdateGradeVisibilityDto,
} from './grades.dto.js';

const gradeInclude = {
  category: true,
  subcategory: true,
  gradeApplications: { include: { application: true } },
} satisfies Prisma.GradeInclude;

const SORTABLE = [
  'code',
  'name',
  'displayName',
  'gradeNo',
  'manufacturer',
  'gradeGroup',
  'sortOrder',
  'createdAt',
  'updatedAt',
];

/** Source.One columns are owned by the CSV import, not by manual edits. */
const SOURCE_MANAGED_FIELDS = ['code', 'categoryId', 'subcategoryId'] as const;

/** Grade No., manufacturer, category, grade group, full name, code and labels. */
export function gradeSearch(q: string): Prisma.GradeWhereInput[] {
  const contains = { contains: q, mode: 'insensitive' as const };
  return [
    { gradeNo: contains },
    { manufacturer: contains },
    { gradeGroup: contains },
    { fullGradeName: contains },
    { code: contains },
    { name: contains },
    { displayName: contains },
    { category: { code: contains } },
    { category: { name: contains } },
  ];
}

type Scope = 'admin' | 'customer' | 'seller';

function scopeWhere(scope: Scope): Prisma.GradeWhereInput {
  if (scope === 'customer') {
    return {
      deletedAt: null,
      status: GradeStatus.ACTIVE,
      customerVisible: true,
    };
  }
  if (scope === 'seller') {
    return { deletedAt: null, status: GradeStatus.ACTIVE, sellerVisible: true };
  }
  return { deletedAt: null };
}

@Injectable()
export class GradesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  private async logChange(
    action: string,
    actorUserId: string | undefined,
    gradeId: string,
    previousData: Record<string, unknown>,
    newData: Record<string, unknown>,
  ) {
    await this.audit.log({
      action,
      actorUserId,
      entityType: EntityOwnerType.GRADE,
      entityId: gradeId,
      previousData,
      newData,
    });
  }

  async create(dto: CreateGradeDto, actorUserId?: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await assertFound(
          await tx.gradeCategory.findFirst({
            where: { id: dto.categoryId, deletedAt: null },
          }),
          'Category not found',
        );

        if (dto.subcategoryId) {
          await assertFound(
            await tx.subcategory.findFirst({
              where: {
                id: dto.subcategoryId,
                categoryId: dto.categoryId,
                deletedAt: null,
              },
            }),
            'Subcategory not found for category',
          );
        }

        const applicationIds = await this.resolveApplicationIds(
          tx,
          dto.applicationCodes,
        );

        const grade = await tx.grade.create({
          data: {
            code: dto.code.trim().toUpperCase(),
            name: dto.name.trim(),
            displayName: (dto.displayName ?? dto.name).trim(),
            categoryId: dto.categoryId,
            subcategoryId: dto.subcategoryId,
            description: dto.description,
            applications: dto.applicationCodes ?? [],
            status: dto.status ?? GradeStatus.ACTIVE,
            customerVisible: dto.customerVisible ?? true,
            sellerVisible: dto.sellerVisible ?? true,
            sortOrder: dto.sortOrder ?? 0,
            hsnCode: dto.hsnCode,
            createdById: actorUserId,
            updatedById: actorUserId,
            gradeApplications: applicationIds.length
              ? {
                  create: applicationIds.map((applicationId) => ({
                    applicationId,
                  })),
                }
              : undefined,
          },
          include: gradeInclude,
        });

        return this.mapGrade(grade);
      });
    } catch (error) {
      handlePrismaUnique(error, 'Grade code already exists');
    }
  }

  async findAll(query: GradeQueryDto, mode: Scope) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.GradeWhereInput = scopeWhere(mode);

    if (mode === 'admin') {
      if (query.status) where.status = query.status;
      if (query.customerVisible !== undefined) {
        where.customerVisible = query.customerVisible;
      }
      if (query.sellerVisible !== undefined) {
        where.sellerVisible = query.sellerVisible;
      }
    }

    if (mode === 'admin' && query.source) where.source = query.source;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.category) {
      where.category = { code: query.category.trim().toUpperCase() };
    }
    if (query.subcategoryId) where.subcategoryId = query.subcategoryId;
    if (query.gradeGroup) {
      where.gradeGroup = {
        equals: query.gradeGroup.trim(),
        mode: 'insensitive',
      };
    }
    if (query.manufacturer) {
      where.manufacturer = {
        equals: query.manufacturer.trim(),
        mode: 'insensitive',
      };
    }
    if (query.inTodaysDelhiPriceList !== undefined) {
      where.inTodaysDelhiPriceList = query.inTodaysDelhiPriceList;
    }
    const q = resolveSearch(query);
    if (q) where.OR = gradeSearch(q);

    const sortBy = SORTABLE.includes(query.sortBy ?? '')
      ? (query.sortBy as string)
      : 'sortOrder';
    const sortOrder = query.sortOrder === 'desc' ? 'desc' : 'asc';

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.grade.count({ where }),
      this.prisma.grade.findMany({
        where,
        include: gradeInclude,
        orderBy: [
          { [sortBy]: sortOrder },
          { displayName: 'asc' },
          { id: 'asc' },
        ],
        skip,
        take,
      }),
    ]);

    return {
      items: rows.map((g) => this.mapGrade(g, mode !== 'admin')),
      meta: paginationMeta(page, limit, total),
    };
  }

  async findOne(id: string, consumer = false) {
    const grade = assertFound(
      await this.prisma.grade.findFirst({
        where: { id, deletedAt: null },
        include: gradeInclude,
      }),
      'Grade not found',
    );
    return this.mapGrade(grade, consumer);
  }

  private async loadForChange(id: string) {
    return assertFound(
      await this.prisma.grade.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          source: true,
          code: true,
          name: true,
          displayName: true,
          description: true,
          categoryId: true,
          subcategoryId: true,
          status: true,
          customerVisible: true,
          sellerVisible: true,
          sortOrder: true,
          hsnCode: true,
        },
      }),
      'Grade not found',
    );
  }

  async update(id: string, dto: UpdateGradeDto, actorUserId?: string) {
    const before = await this.loadForChange(id);
    if (before.source) {
      const locked = SOURCE_MANAGED_FIELDS.filter(
        (field) => dto[field] !== undefined && dto[field] !== before[field],
      );
      if (locked.length) {
        throw new BadRequestException(
          `${locked.join(', ')} of ${before.source} grades are managed by the grade master import`,
        );
      }
    }
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        if (dto.categoryId) {
          await assertFound(
            await tx.gradeCategory.findFirst({
              where: { id: dto.categoryId, deletedAt: null },
            }),
            'Category not found',
          );
        }
        if (dto.subcategoryId) {
          await assertFound(
            await tx.subcategory.findFirst({
              where: { id: dto.subcategoryId, deletedAt: null },
            }),
            'Subcategory not found',
          );
        }

        if (dto.applicationCodes) {
          const applicationIds = await this.resolveApplicationIds(
            tx,
            dto.applicationCodes,
          );
          await tx.gradeApplication.deleteMany({ where: { gradeId: id } });
          if (applicationIds.length) {
            await tx.gradeApplication.createMany({
              data: applicationIds.map((applicationId) => ({
                gradeId: id,
                applicationId,
              })),
            });
          }
        }

        const grade = await tx.grade.update({
          where: { id },
          data: {
            code: dto.code?.trim().toUpperCase(),
            name: dto.name?.trim(),
            displayName: dto.displayName?.trim(),
            categoryId: dto.categoryId,
            subcategoryId: dto.subcategoryId,
            description: dto.description,
            applications: dto.applicationCodes,
            status: dto.status,
            customerVisible: dto.customerVisible,
            sellerVisible: dto.sellerVisible,
            sortOrder: dto.sortOrder,
            hsnCode: dto.hsnCode,
            updatedById: actorUserId,
          },
          include: gradeInclude,
        });
        return this.mapGrade(grade);
      });
      const { id: _id, source: _source, ...previous } = before;
      const changed = Object.fromEntries(
        Object.entries(previous).filter(
          ([key, value]) =>
            (updated as Record<string, unknown>)[key] !== undefined &&
            JSON.stringify((updated as Record<string, unknown>)[key]) !==
              JSON.stringify(value),
        ),
      );
      if (Object.keys(changed).length) {
        await this.logChange(
          'GRADE_UPDATED',
          actorUserId,
          id,
          changed,
          Object.fromEntries(
            Object.keys(changed).map((key) => [
              key,
              (updated as Record<string, unknown>)[key],
            ]),
          ),
        );
      }
      return updated;
    } catch (error) {
      handlePrismaUnique(error, 'Grade code already exists');
    }
  }

  async updateStatus(
    id: string,
    dto: UpdateGradeStatusDto,
    actorUserId?: string,
  ) {
    const before = await this.loadForChange(id);
    const grade = await this.prisma.grade.update({
      where: { id },
      data: { status: dto.status, updatedById: actorUserId },
      include: gradeInclude,
    });
    if (before.status !== dto.status) {
      await this.logChange(
        dto.status === GradeStatus.ACTIVE
          ? 'GRADE_ACTIVATED'
          : 'GRADE_DEACTIVATED',
        actorUserId,
        id,
        { status: before.status },
        { status: dto.status },
      );
    }
    return this.mapGrade(grade);
  }

  async updateVisibility(
    id: string,
    dto: UpdateGradeVisibilityDto,
    actorUserId?: string,
  ) {
    const before = await this.loadForChange(id);
    const grade = await this.prisma.grade.update({
      where: { id },
      data: {
        customerVisible: dto.customerVisible,
        sellerVisible: dto.sellerVisible,
        updatedById: actorUserId,
      },
      include: gradeInclude,
    });
    if (
      dto.customerVisible !== undefined &&
      dto.customerVisible !== before.customerVisible
    ) {
      await this.logChange(
        'CUSTOMER_VISIBILITY_CHANGED',
        actorUserId,
        id,
        { customerVisible: before.customerVisible },
        { customerVisible: dto.customerVisible },
      );
    }
    if (
      dto.sellerVisible !== undefined &&
      dto.sellerVisible !== before.sellerVisible
    ) {
      await this.logChange(
        'SELLER_VISIBILITY_CHANGED',
        actorUserId,
        id,
        { sellerVisible: before.sellerVisible },
        { sellerVisible: dto.sellerVisible },
      );
    }
    return this.mapGrade(grade);
  }

  async softDelete(id: string, actorUserId?: string) {
    const before = await this.loadForChange(id);
    await this.prisma.grade.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: GradeStatus.INACTIVE,
        updatedById: actorUserId,
      },
    });
    await this.logChange(
      'GRADE_DELETED',
      actorUserId,
      id,
      { status: before.status, deletedAt: null },
      { status: GradeStatus.INACTIVE, deleted: true },
    );
    return { id, deleted: true };
  }

  /**
   * Category / Grade Group / Manufacturer options with counts for filters and
   * selectors. Consumer scopes only count ACTIVE grades visible to that role.
   */
  async facets(scope: Scope, query: GradeFacetQueryDto) {
    const base = scopeWhere(scope);
    const categoryFilter: Prisma.GradeWhereInput = query.categoryId
      ? { categoryId: query.categoryId }
      : query.category
        ? { category: { code: query.category.trim().toUpperCase() } }
        : {};
    const search = query.search?.trim();

    const [byCategory, byGroup, byManufacturer] = await Promise.all([
      this.prisma.grade.groupBy({
        by: ['categoryId'],
        where: base,
        _count: { _all: true },
      }),
      this.prisma.grade.groupBy({
        by: ['gradeGroup'],
        where: { ...base, ...categoryFilter, gradeGroup: { not: null } },
        _count: { _all: true },
        orderBy: { gradeGroup: 'asc' },
      }),
      this.prisma.grade.groupBy({
        by: ['manufacturer'],
        where: {
          ...base,
          ...categoryFilter,
          manufacturer: search
            ? { contains: search, mode: 'insensitive' }
            : { not: null },
        },
        _count: { _all: true },
        orderBy: { manufacturer: 'asc' },
      }),
    ]);

    const categories = await this.prisma.gradeCategory.findMany({
      where: { id: { in: byCategory.map((c) => c.categoryId) } },
      select: {
        id: true,
        code: true,
        name: true,
        displayName: true,
        sortOrder: true,
      },
    });
    const counts = new Map(
      byCategory.map((c) => [c.categoryId, c._count._all]),
    );

    return {
      categories: categories
        .map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          displayName: c.displayName ?? c.name,
          gradeCount: counts.get(c.id) ?? 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      gradeGroups: byGroup.map((g) => ({
        name: g.gradeGroup!,
        gradeCount: g._count._all,
      })),
      manufacturers: byManufacturer.map((m) => ({
        name: m.manufacturer!,
        gradeCount: m._count._all,
      })),
    };
  }

  /** Admin KPI cards for the Grade Master. */
  async stats() {
    const live = { deletedAt: null };
    const [
      total,
      active,
      customerVisible,
      sellerVisible,
      inDelhiPriceList,
      sourceOne,
      categories,
      manufacturers,
      lastImport,
    ] = await Promise.all([
      this.prisma.grade.count({ where: live }),
      this.prisma.grade.count({
        where: { ...live, status: GradeStatus.ACTIVE },
      }),
      this.prisma.grade.count({ where: { ...live, customerVisible: true } }),
      this.prisma.grade.count({ where: { ...live, sellerVisible: true } }),
      this.prisma.grade.count({
        where: { ...live, inTodaysDelhiPriceList: true },
      }),
      this.prisma.grade.count({ where: { ...live, source: { not: null } } }),
      this.prisma.grade.groupBy({ by: ['categoryId'], where: live }),
      this.prisma.grade.groupBy({
        by: ['manufacturer'],
        where: { ...live, manufacturer: { not: null } },
      }),
      this.prisma.gradeImportBatch.findFirst({
        where: { status: GradeImportStatus.COMPLETED },
        orderBy: { completedAt: 'desc' },
        select: {
          id: true,
          fileName: true,
          completedAt: true,
          insertedRows: true,
          updatedRows: true,
          totalRows: true,
        },
      }),
    ]);
    return {
      total,
      active,
      inactive: total - active,
      customerVisible,
      sellerVisible,
      inTodaysDelhiPriceList: inDelhiPriceList,
      sourceOne,
      categories: categories.length,
      manufacturers: manufacturers.length,
      lastImport,
    };
  }

  async linkApplication(gradeId: string, applicationId: string) {
    await this.findOne(gradeId);
    await assertFound(
      await this.prisma.application.findFirst({
        where: {
          id: applicationId,
          deletedAt: null,
          status: MasterStatus.ACTIVE,
        },
      }),
      'Application not found',
    );
    try {
      await this.prisma.gradeApplication.create({
        data: { gradeId, applicationId },
      });
    } catch (error) {
      handlePrismaUnique(error, 'Application already linked to grade');
    }
    return this.findOne(gradeId);
  }

  async unlinkApplication(gradeId: string, applicationId: string) {
    await this.prisma.gradeApplication.deleteMany({
      where: { gradeId, applicationId },
    });
    return this.findOne(gradeId);
  }

  private async resolveApplicationIds(
    tx: Prisma.TransactionClient,
    codes?: string[],
  ) {
    if (!codes?.length) return [] as string[];
    const normalized = codes.map((c) => c.trim()).filter(Boolean);
    const apps = await tx.application.findMany({
      where: {
        OR: [
          {
            code: {
              in: normalized.map((c) => c.toUpperCase().replace(/\s+/g, '_')),
            },
          },
          { name: { in: normalized, mode: 'insensitive' } },
        ],
        deletedAt: null,
      },
    });
    return apps.map((a) => a.id);
  }

  private mapGrade(
    grade: Prisma.GradeGetPayload<{ include: typeof gradeInclude }>,
    consumer = false,
  ) {
    const base = {
      id: grade.id,
      code: grade.code,
      name: grade.name,
      displayName: grade.displayName ?? grade.name,
      description: grade.description,
      status: grade.status,
      customerVisible: grade.customerVisible,
      sellerVisible: grade.sellerVisible,
      sortOrder: grade.sortOrder,
      categoryId: grade.categoryId,
      subcategoryId: grade.subcategoryId,
      gradeGroup: grade.gradeGroup,
      gradeNo: grade.gradeNo,
      manufacturer: grade.manufacturer,
      fullGradeName: grade.fullGradeName,
      inTodaysDelhiPriceList: grade.inTodaysDelhiPriceList,
      source: grade.source,
      category: {
        id: grade.category.id,
        code: grade.category.code,
        name: grade.category.name,
        displayName: grade.category.displayName ?? grade.category.name,
      },
      subcategory: grade.subcategory
        ? {
            id: grade.subcategory.id,
            code: grade.subcategory.code,
            name: grade.subcategory.name,
          }
        : null,
      applications: grade.gradeApplications.map((ga) => ({
        id: ga.application.id,
        code: ga.application.code,
        name: ga.application.name,
      })),
    };

    if (consumer) {
      return base;
    }

    return {
      ...base,
      priceTodayRsKg: grade.priceTodayRsKg?.toFixed(2) ?? null,
      producerPriceRsKg: grade.producerPriceRsKg?.toFixed(2) ?? null,
      producerPriceType: grade.producerPriceType,
      sourceReference: grade.sourceReference,
      version: grade.version,
      lastImportedAt: grade.lastImportedAt,
      importBatchId: grade.importBatchId,
      hsnCode: grade.hsnCode,
      metadata: grade.metadata,
      createdById: grade.createdById,
      updatedById: grade.updatedById,
      createdAt: grade.createdAt,
      updatedAt: grade.updatedAt,
    };
  }
}
