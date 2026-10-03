import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import {
  EntityOwnerType,
  ManagerAssignmentStatus,
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
  AdminDirectoryStatusFilter,
  AdminUsersQueryDto,
  UpdateUserRoleDto,
  UpdateUserStatusDto,
} from './admin-users.dto.js';

const userSelect = {
  id: true,
  email: true,
  phone: true,
  loginId: true,
  firstName: true,
  lastName: true,
  displayName: true,
  avatarUrl: true,
  status: true,
  emailVerified: true,
  phoneVerified: true,
  mustChangePassword: true,
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
  sellerProfile: {
    select: {
      id: true,
      status: true,
      organizationId: true,
      organization: { select: { name: true } },
    },
  },
  adminProfile: { select: { id: true, status: true } },
  managerAssignments: {
    orderBy: { assignedAt: 'desc' as const },
    take: 3,
    select: {
      id: true,
      status: true,
      isPrimary: true,
      title: true,
      sellerProfile: {
        select: {
          id: true,
          status: true,
          organization: { select: { name: true, gstin: true, pan: true } },
        },
      },
    },
  },
} satisfies Prisma.UserSelect;

function mapStatusFilter(
  status?: AdminUserStatusFilter | AdminDirectoryStatusFilter,
): UserStatus | undefined {
  if (!status || status === 'REVOKED') return undefined;
  if (status === 'INVITED' || status === 'PENDING') return UserStatus.PENDING;
  if (status === AdminUserStatusFilter.INACTIVE || status === 'INACTIVE') {
    return UserStatus.INACTIVE;
  }
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

    if (query.status === 'REVOKED') {
      where.managerAssignments = {
        some: { status: ManagerAssignmentStatus.REVOKED },
      };
      where.NOT = {
        managerAssignments: {
          some: { status: ManagerAssignmentStatus.ACTIVE },
        },
      };
    } else if (query.status) {
      where.status = mapStatusFilter(query.status);
    }
    if (query.role) {
      where.userRoles = { some: { role: { code: query.role } } };
    }
    if (query.sellerId) {
      where.managerAssignments = {
        some: {
          sellerProfileId: query.sellerId,
          ...(query.status === 'REVOKED'
            ? { status: ManagerAssignmentStatus.REVOKED }
            : { status: ManagerAssignmentStatus.ACTIVE }),
        },
      };
    }
    if (query.lastLoginFrom || query.lastLoginTo) {
      where.lastLoginAt = {};
      if (query.lastLoginFrom) {
        where.lastLoginAt.gte = new Date(query.lastLoginFrom);
      }
      if (query.lastLoginTo) {
        where.lastLoginAt.lte = new Date(query.lastLoginTo);
      }
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
        { loginId: { contains: q, mode: 'insensitive' } },
        {
          managerAssignments: {
            some: {
              status: ManagerAssignmentStatus.ACTIVE,
              sellerProfile: {
                organization: { name: { contains: q, mode: 'insensitive' } },
              },
            },
          },
        },
        {
          sellerProfile: {
            organization: { name: { contains: q, mode: 'insensitive' } },
          },
        },
      ];
    }

    const sortField =
      query.sortBy === 'lastLoginAt' || query.sortBy === 'displayName'
        ? query.sortBy
        : 'createdAt';
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: userSelect,
        orderBy: { [sortField]: query.sortOrder === 'asc' ? 'asc' : 'desc' },
        skip,
        take,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: items.map(presentListUser),
      meta: paginationMeta(page, limit, total),
    };
  }

  async exportRows(query: AdminUsersQueryDto) {
    const pageSize = 100;
    const first = await this.list({ ...query, page: 1, limit: pageSize });
    const pages = Math.min(first.meta.totalPages, 20);
    const items = [...first.items];
    for (let page = 2; page <= pages; page += 1) {
      const next = await this.list({ ...query, page, limit: pageSize });
      items.push(...next.items);
    }
    const listed = { items };
    const header = [
      'Name',
      'Email',
      'Phone',
      'Role',
      'Seller',
      'Status',
      'Last Login',
      'Created At',
    ];
    const lines = listed.items.map((row) =>
      [
        row.name,
        row.email,
        row.phone,
        row.role,
        row.seller?.name,
        row.status,
        row.lastLoginAt,
        row.createdAt,
      ]
        .map((value) => csvCell(value))
        .join(','),
    );
    return {
      filename: 'users.csv',
      csv: [header.join(','), ...lines].join('\n'),
    };
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
    actor: Pick<AuthenticatedUser, 'id' | 'roles'>,
  ) {
    const user = await this.findOne(id);
    const currentCodes = user.userRoles.map((ur) => ur.role.code);
    assertCanManageUser(actor, id, currentCodes);
    const next = mapStatusFilter(dto.status)!;
    if (user.status === next) return user;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.user.update({
        where: { id },
        data: { status: next },
        select: userSelect,
      });
      if (next !== UserStatus.ACTIVE) {
        await tx.authSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return row;
    });

    await this.audit.log({
      action: 'USER_STATUS_UPDATED',
      actorUserId: actor.id,
      entityType: EntityOwnerType.USER,
      entityId: id,
      previousData: { status: user.status },
      newData: { status: next },
    });

    return updated;
  }

  async updateRole(
    id: string,
    dto: UpdateUserRoleDto,
    actor: Pick<AuthenticatedUser, 'id' | 'roles'>,
  ) {
    const user = await this.findOne(id);
    const currentCodes = user.userRoles.map((ur) => ur.role.code);
    assertCanManageUser(actor, id, currentCodes);
    if (
      PRIVILEGED_ROLES.has(dto.role) &&
      !actor.roles.includes(RoleCode.SUPER_ADMIN)
    ) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_PERMISSION',
        message: 'Only a Super Admin can grant admin roles',
      });
    }
    if (
      dto.role === RoleCode.SELLER_MANAGER ||
      currentCodes.includes(RoleCode.SELLER_MANAGER)
    ) {
      throw new BadRequestException({
        code: 'INVALID_ROLE',
        message:
          'Seller Manager roles are managed from the Seller Manager actions, not the generic role editor',
      });
    }
    const role = await this.prisma.role.findUnique({
      where: { code: dto.role },
    });
    if (!role) throw new BadRequestException(`Role ${dto.role} not found`);

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
      actorUserId: actor.id,
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

type ListedUser = Prisma.UserGetPayload<{ select: typeof userSelect }>;

function presentListUser(user: ListedUser) {
  const assignment =
    user.managerAssignments.find((row) => row.status === 'ACTIVE') ??
    user.managerAssignments[0] ??
    null;
  const sellerName =
    assignment?.sellerProfile.organization.name ??
    user.sellerProfile?.organization.name ??
    null;
  const sellerId =
    assignment?.sellerProfile.id ?? user.sellerProfile?.id ?? null;
  const role =
    user.userRoles.find((row) => row.role.code === 'SELLER_MANAGER')?.role
      .code ??
    user.userRoles[0]?.role.code ??
    null;
  return {
    id: user.id,
    name:
      user.displayName ||
      [user.firstName, user.lastName].filter(Boolean).join(' ') ||
      user.email ||
      'User',
    email: user.email,
    phone: user.phone,
    loginId: user.loginId,
    role,
    roles: user.userRoles.map((row) => row.role.code),
    status: user.status,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    seller: sellerId
      ? {
          id: sellerId,
          name: sellerName,
          gst: assignment?.sellerProfile.organization.gstin ?? null,
          pan: assignment?.sellerProfile.organization.pan ?? null,
          status:
            assignment?.sellerProfile.status ?? user.sellerProfile?.status,
        }
      : null,
    assignmentStatus: assignment?.status ?? null,
    isPrimary: assignment?.isPrimary ?? false,
  };
}

const PRIVILEGED_ROLES = new Set<string>([
  RoleCode.ADMIN,
  RoleCode.SUPER_ADMIN,
]);

export function assertCanManageUser(
  actor: Pick<AuthenticatedUser, 'id' | 'roles'>,
  targetUserId: string,
  targetRoles: string[],
) {
  if (actor.id === targetUserId) {
    throw new ForbiddenException({
      code: 'INSUFFICIENT_PERMISSION',
      message: 'You cannot change your own role or status',
    });
  }
  const targetPrivileged = targetRoles.some((code) =>
    PRIVILEGED_ROLES.has(code),
  );
  if (targetPrivileged && !actor.roles.includes(RoleCode.SUPER_ADMIN)) {
    throw new ForbiddenException({
      code: 'INSUFFICIENT_PERMISSION',
      message: 'Only a Super Admin can change another admin account',
    });
  }
}

function csvCell(value: unknown) {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
