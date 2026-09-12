import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EntityOwnerType,
  Prisma,
  UserStatus,
} from '../../../generated/prisma/client.js';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { AdminAuditService } from '../common/admin-audit.service.js';
import { AdminUserStatusFilter } from '../common/admin-query.dto.js';
import type {
  AdminUsersQueryDto,
  UpdateUserRoleDto,
  UpdateUserStatusDto,
} from './admin-users.dto.js';

const userSelect = {
  id: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  displayName: true,
  avatarUrl: true,
  status: true,
  emailVerified: true,
  phoneVerified: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  userRoles: {
    select: {
      id: true,
      organizationId: true,
      assignedAt: true,
      role: { select: { id: true, code: true, name: true } },
    },
  },
  customerProfile: { select: { id: true, status: true, organizationId: true } },
  sellerProfile: { select: { id: true, status: true, organizationId: true } },
  adminProfile: { select: { id: true, status: true } },
} satisfies Prisma.UserSelect;

function mapStatusFilter(
  status?: AdminUserStatusFilter,
): UserStatus | undefined {
  if (!status) return undefined;
  if (status === AdminUserStatusFilter.INACTIVE) return UserStatus.INACTIVE;
  return status as unknown as UserStatus;
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  async list(query: AdminUsersQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.UserWhereInput = { deletedAt: null };

    if (query.status) {
      where.status = mapStatusFilter(query.status);
    }
    if (query.role) {
      where.userRoles = { some: { role: { code: query.role } } };
    }
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { displayName: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: userSelect,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, meta: paginationMeta(page, limit, total) };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: userSelect,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateStatus(
    id: string,
    dto: UpdateUserStatusDto,
    actorUserId: string,
  ) {
    const user = await this.findOne(id);
    const next = mapStatusFilter(dto.status)!;
    if (user.status === next) return user;

    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: next },
      select: userSelect,
    });

    await this.audit.log({
      action: 'USER_STATUS_UPDATED',
      actorUserId,
      entityType: EntityOwnerType.USER,
      entityId: id,
      previousData: { status: user.status },
      newData: { status: next },
    });

    return updated;
  }

  async updateRole(id: string, dto: UpdateUserRoleDto, actorUserId: string) {
    const user = await this.findOne(id);
    const role = await this.prisma.role.findUnique({
      where: { code: dto.role },
    });
    if (!role) throw new BadRequestException(`Role ${dto.role} not found`);

    const currentCodes = user.userRoles.map((ur) => ur.role.code);
    const removingSuperAdmin =
      currentCodes.includes(RoleCode.SUPER_ADMIN) &&
      dto.role !== RoleCode.SUPER_ADMIN;

    if (removingSuperAdmin) {
      const superAdminCount = await this.prisma.userRole.count({
        where: { role: { code: RoleCode.SUPER_ADMIN } },
      });
      if (superAdminCount <= 1) {
        throw new BadRequestException(
          'Cannot remove the last SUPER_ADMIN role assignment',
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.create({
        data: {
          userId: id,
          roleId: role.id,
          organizationId: dto.organizationId ?? null,
        },
      });
      return tx.user.findFirstOrThrow({
        where: { id },
        select: userSelect,
      });
    });

    await this.audit.log({
      action: 'USER_ROLE_UPDATED',
      actorUserId,
      entityType: EntityOwnerType.USER,
      entityId: id,
      previousData: { roles: currentCodes },
      newData: {
        roles: [dto.role],
        organizationId: dto.organizationId ?? null,
      },
    });

    return updated;
  }
}
