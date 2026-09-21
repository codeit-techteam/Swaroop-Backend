import { Injectable } from '@nestjs/common';
import {
  GradeStatus,
  MasterStatus,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  resolveSearch,
  skipTake,
} from '../common/pagination.js';
import { assertFound, handlePrismaUnique } from '../common/prisma-helpers.js';
import type {
  CreateGradeDto,
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

@Injectable()
export class GradesService {
  constructor(private readonly prisma: PrismaService) {}

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

  async findAll(query: GradeQueryDto, mode: 'admin' | 'customer' | 'seller') {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.GradeWhereInput = {
      deletedAt: null,
    };

    if (mode === 'customer') {
      where.status = GradeStatus.ACTIVE;
      where.customerVisible = true;
    } else if (mode === 'seller') {
      where.status = GradeStatus.ACTIVE;
      where.sellerVisible = true;
    } else {
      if (query.status) where.status = query.status;
      if (query.customerVisible !== undefined) {
        where.customerVisible = query.customerVisible;
      }
      if (query.sellerVisible !== undefined) {
        where.sellerVisible = query.sellerVisible;
      }
    }

    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.subcategoryId) where.subcategoryId = query.subcategoryId;
    if (resolveSearch(query)) {
      const q = resolveSearch(query)!;
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { displayName: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }

    const sortBy = [
      'code',
      'name',
      'sortOrder',
      'createdAt',
      'updatedAt',
    ].includes(query.sortBy ?? '')
      ? (query.sortBy as string)
      : 'sortOrder';
    const sortOrder = query.sortOrder === 'desc' ? 'desc' : 'asc';

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.grade.count({ where }),
      this.prisma.grade.findMany({
        where,
        include: gradeInclude,
        orderBy: { [sortBy]: sortOrder },
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

  async update(id: string, dto: UpdateGradeDto, actorUserId?: string) {
    await this.findOne(id);
    try {
      return await this.prisma.$transaction(async (tx) => {
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
    } catch (error) {
      handlePrismaUnique(error, 'Grade code already exists');
    }
  }

  async updateStatus(
    id: string,
    dto: UpdateGradeStatusDto,
    actorUserId?: string,
  ) {
    await this.findOne(id);
    const grade = await this.prisma.grade.update({
      where: { id },
      data: { status: dto.status, updatedById: actorUserId },
      include: gradeInclude,
    });
    return this.mapGrade(grade);
  }

  async updateVisibility(
    id: string,
    dto: UpdateGradeVisibilityDto,
    actorUserId?: string,
  ) {
    await this.findOne(id);
    const grade = await this.prisma.grade.update({
      where: { id },
      data: {
        customerVisible: dto.customerVisible,
        sellerVisible: dto.sellerVisible,
        updatedById: actorUserId,
      },
      include: gradeInclude,
    });
    return this.mapGrade(grade);
  }

  async softDelete(id: string, actorUserId?: string) {
    await this.findOne(id);
    await this.prisma.grade.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: GradeStatus.INACTIVE,
        updatedById: actorUserId,
      },
    });
    return { id, deleted: true };
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
      hsnCode: grade.hsnCode,
      metadata: grade.metadata,
      createdById: grade.createdById,
      updatedById: grade.updatedById,
      createdAt: grade.createdAt,
      updatedAt: grade.updatedAt,
    };
  }
}
