import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  EntityOwnerType,
  ManagerAssignmentStatus,
  Prisma,
  UserStatus,
} from '../../../generated/prisma/client.js';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { CryptoService } from '../../auth/services/crypto.service.js';
import {
  MANAGER_PRESETS,
  SELLER_MANAGER_PERMISSIONS,
  assertAssignablePermissions,
  assertPasswordStrength,
  normalizeIndianMobile,
  splitDisplayName,
} from '../../sellers/managers/seller-access.js';
import type {
  CreateSellerManagerDto,
  UpdateManagerDto,
} from './admin-users.dto.js';

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 3;

@Injectable()
export class AdminManagerService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async onModuleInit() {
    await this.prisma.role.upsert({
      where: { code: RoleCode.SELLER_MANAGER },
      update: { name: 'Seller Manager' },
      create: {
        code: RoleCode.SELLER_MANAGER,
        name: 'Seller Manager',
        description: 'User assigned to operate one seller account',
        isSystem: true,
      },
    });
  }

  catalog() {
    return {
      permissions: SELLER_MANAGER_PERMISSIONS,
      presets: Object.entries(MANAGER_PRESETS).map(([id, preset]) => ({
        id,
        label: preset.label,
        permissions: preset.permissions,
      })),
    };
  }

  async create(dto: CreateSellerManagerDto, actorUserId: string) {
    if (dto.role !== RoleCode.SELLER_MANAGER) {
      throw new BadRequestException(
        'This endpoint only creates Seller Manager accounts',
      );
    }
    const email = dto.email.trim().toLowerCase();
    const phone = this.phone(dto.phone);
    const name = splitDisplayName(dto.name);
    let permissions: string[];
    try {
      permissions = assertAssignablePermissions(dto.permissions);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid permissions',
      );
    }

    const seller = await this.prisma.sellerProfile.findFirst({
      where: { id: dto.sellerId, deletedAt: null },
      include: { organization: true },
    });
    if (!seller) throw new NotFoundException('Seller not found');

    const duplicate = await this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        OR: [{ email }, { phone }],
      },
      select: { email: true, phone: true },
    });
    if (duplicate?.email === email) {
      throw new ConflictException('An account with this email already exists.');
    }
    if (duplicate?.phone === phone) {
      throw new ConflictException(
        'An account with this mobile number already exists.',
      );
    }

    const accessMethod = dto.accessMethod ?? 'INVITATION';
    let passwordHash: string | null = null;
    if (accessMethod === 'TEMPORARY_PASSWORD') {
      if (!dto.temporaryPassword) {
        throw new BadRequestException('Temporary password is required');
      }
      try {
        assertPasswordStrength(dto.temporaryPassword);
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : 'Weak password',
        );
      }
      passwordHash = await this.crypto.hashPassword(dto.temporaryPassword);
    }

    const role = await this.prisma.role.findUnique({
      where: { code: RoleCode.SELLER_MANAGER },
    });
    if (!role) {
      throw new BadRequestException('SELLER_MANAGER role is not configured');
    }

    const activePrimary = await this.prisma.sellerManagerAssignment.findFirst({
      where: {
        sellerProfileId: seller.id,
        status: ManagerAssignmentStatus.ACTIVE,
        isPrimary: true,
      },
      select: { id: true },
    });
    const isPrimary = dto.isPrimary ?? !activePrimary;
    const rawToken =
      accessMethod === 'INVITATION' ? this.crypto.generateSecureToken(32) : null;
    const tokenHash = rawToken ? this.crypto.hashToken(rawToken) : null;

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const loginId = await this.nextLoginId(tx);
        const user = await tx.user.create({
          data: {
            email,
            phone,
            loginId,
            firstName: name.firstName,
            lastName: name.lastName,
            displayName: name.displayName,
            passwordHash,
            mustChangePassword: accessMethod === 'TEMPORARY_PASSWORD',
            status:
              accessMethod === 'TEMPORARY_PASSWORD'
                ? UserStatus.ACTIVE
                : UserStatus.PENDING,
            emailVerified: false,
            phoneVerified: false,
          },
        });
        await tx.userRole.create({
          data: { userId: user.id, roleId: role.id },
        });
        if (isPrimary) {
          await tx.sellerManagerAssignment.updateMany({
            where: {
              sellerProfileId: seller.id,
              status: ManagerAssignmentStatus.ACTIVE,
              isPrimary: true,
            },
            data: { isPrimary: false },
          });
        }
        await tx.sellerManagerAssignment.create({
          data: {
            userId: user.id,
            sellerProfileId: seller.id,
            isPrimary,
            status: ManagerAssignmentStatus.ACTIVE,
            title: dto.title?.trim() || null,
            assignedById: actorUserId,
            assignedAt: new Date(),
          },
        });
        if (permissions.length) {
          await tx.userPermissionGrant.createMany({
            data: permissions.map((code) => ({
              id: randomUUID(),
              userId: user.id,
              code,
            })),
          });
        }
        if (tokenHash) {
          await tx.passwordResetToken.create({
            data: {
              userId: user.id,
              tokenHash,
              purpose: 'INVITATION',
              expiresAt: new Date(Date.now() + INVITE_TTL_MS),
            },
          });
        }
        await tx.auditLog.create({
          data: {
            action: 'MANAGER_CREATED',
            actorUserId,
            organizationId: seller.organizationId,
            entityType: EntityOwnerType.USER,
            entityId: user.id,
            newData: {
              loginId,
              email,
              sellerId: seller.id,
              permissions,
              accessMethod,
              isPrimary,
            },
          },
        });
        await tx.auditLog.create({
          data: {
            action: 'MANAGER_ASSIGNED_TO_SELLER',
            actorUserId,
            organizationId: seller.organizationId,
            entityType: EntityOwnerType.USER,
            entityId: user.id,
            metadata: { sellerId: seller.id, isPrimary },
          },
        });
        return user;
      });

      return {
        id: created.id,
        name: name.displayName,
        email,
        phone,
        loginId: created.loginId,
        role: RoleCode.SELLER_MANAGER,
        status: created.status,
        seller: {
          id: seller.id,
          name: seller.organization.name,
          gst: seller.organization.gstin,
          pan: seller.organization.pan,
          status: seller.status,
        },
        permissions,
        isPrimary,
        accessMethod,
        invitation:
          rawToken == null
            ? null
            : {
                token: rawToken,
                expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
                email,
                message:
                  'Share this one-time setup link securely. Email delivery is not configured, and the token will not be shown again.',
              },
        temporaryPassword:
          accessMethod === 'TEMPORARY_PASSWORD' ? dto.temporaryPassword : undefined,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'An account with this email, mobile number, or login ID already exists.',
        );
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateManagerDto, actorUserId: string) {
    const user = await this.requireManager(id);
    const data: Prisma.UserUpdateInput = {};
    if (dto.name) {
      const name = splitDisplayName(dto.name);
      data.displayName = name.displayName;
      data.firstName = name.firstName;
      data.lastName = name.lastName;
    }
    if (dto.phone) data.phone = this.phone(dto.phone);

    let permissions: string[] | undefined;
    if (dto.permissions) {
      try {
        permissions = assertAssignablePermissions(dto.permissions);
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : 'Invalid permissions',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(data).length) {
        await tx.user.update({ where: { id }, data });
      }
      if (permissions) {
        await tx.userPermissionGrant.deleteMany({ where: { userId: id } });
        if (permissions.length) {
          await tx.userPermissionGrant.createMany({
            data: permissions.map((code) => ({
              id: randomUUID(),
              userId: id,
              code,
            })),
          });
        }
      }
      if (dto.sellerId && dto.sellerId !== user.assignment?.sellerProfileId) {
        const seller = await tx.sellerProfile.findFirst({
          where: { id: dto.sellerId, deletedAt: null },
        });
        if (!seller) throw new NotFoundException('Seller not found');
        if (user.assignment) {
          await tx.sellerManagerAssignment.update({
            where: { id: user.assignment.id },
            data: {
              status: ManagerAssignmentStatus.INACTIVE,
              isPrimary: false,
              deactivatedAt: new Date(),
            },
          });
        }
        const primaryExists = await tx.sellerManagerAssignment.findFirst({
          where: {
            sellerProfileId: seller.id,
            status: ManagerAssignmentStatus.ACTIVE,
            isPrimary: true,
          },
        });
        await tx.sellerManagerAssignment.create({
          data: {
            userId: id,
            sellerProfileId: seller.id,
            isPrimary: dto.isPrimary ?? !primaryExists,
            status: ManagerAssignmentStatus.ACTIVE,
            assignedById: actorUserId,
            assignedAt: new Date(),
            title: dto.title,
          },
        });
        await tx.authSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      } else if (dto.isPrimary === true && user.assignment) {
        await this.setPrimaryTx(tx, id, user.assignment.sellerProfileId);
      }
      await tx.auditLog.create({
        data: {
          action: permissions
            ? 'MANAGER_PERMISSION_UPDATED'
            : dto.sellerId
              ? 'MANAGER_ASSIGNED_TO_SELLER'
              : 'MANAGER_UPDATED',
          actorUserId,
          entityType: EntityOwnerType.USER,
          entityId: id,
          newData: {
            name: dto.name,
            phone: dto.phone ? '[updated]' : undefined,
            sellerId: dto.sellerId,
            permissions,
          },
        },
      });
    });

    return this.detail(id);
  }

  async setPrimary(id: string, actorUserId: string) {
    const user = await this.requireManager(id);
    if (!user.assignment || user.assignment.status !== 'ACTIVE') {
      throw new BadRequestException('Manager has no active seller assignment');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.setPrimaryTx(tx, id, user.assignment!.sellerProfileId);
      await tx.auditLog.create({
        data: {
          action: 'MANAGER_UPDATED',
          actorUserId,
          entityType: EntityOwnerType.USER,
          entityId: id,
          metadata: {
            isPrimary: true,
            sellerId: user.assignment!.sellerProfileId,
          },
        },
      });
    });
    return this.detail(id);
  }

  async activate(id: string, actorUserId: string) {
    const user = await this.requireManager(id);
    if (!user.passwordHash) {
      throw new BadRequestException(
        'Manager must set a password from the invitation before the account can be activated',
      );
    }
    if (user.assignment?.status === 'REVOKED') {
      throw new BadRequestException(
        'Access was revoked. Assign the seller again before activating.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { status: UserStatus.ACTIVE },
      });
      if (user.assignment && user.assignment.status !== 'ACTIVE') {
        await tx.sellerManagerAssignment.update({
          where: { id: user.assignment.id },
          data: {
            status: ManagerAssignmentStatus.ACTIVE,
            deactivatedAt: null,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          action: 'MANAGER_ACTIVATED',
          actorUserId,
          entityType: EntityOwnerType.USER,
          entityId: id,
        },
      });
    });
    return this.detail(id);
  }

  async deactivate(id: string, actorUserId: string) {
    return this.closeAccess(id, actorUserId, 'deactivate');
  }

  async revoke(id: string, actorUserId: string) {
    return this.closeAccess(id, actorUserId, 'revoke');
  }

  async resetPassword(id: string, actorUserId: string) {
    await this.requireManager(id);
    const rawToken = this.crypto.generateSecureToken(32);
    const tokenHash = this.crypto.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.passwordResetToken.create({
        data: {
          userId: id,
          tokenHash,
          purpose: 'PASSWORD_RESET',
          expiresAt,
        },
      });
      await tx.authSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          action: 'MANAGER_PASSWORD_RESET_REQUESTED',
          actorUserId,
          entityType: EntityOwnerType.USER,
          entityId: id,
        },
      });
    });
    return {
      message:
        'Password reset link created. Existing sessions were signed out. The token is shown once.',
      token: rawToken,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async detail(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: managerInclude,
    });
    if (!user) throw new NotFoundException('User not found');
    const [loginCount, activity] = await Promise.all([
      this.prisma.authSession.count({ where: { userId: id } }),
      this.prisma.auditLog.findMany({
        where: {
          OR: [
            { actorUserId: id },
            { entityType: EntityOwnerType.USER, entityId: id },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          action: true,
          createdAt: true,
          actorUserId: true,
          metadata: true,
          newData: true,
        },
      }),
    ]);
    return presentManager(user, { loginCount, activity });
  }

  private async closeAccess(
    id: string,
    actorUserId: string,
    mode: 'deactivate' | 'revoke',
  ) {
    const user = await this.requireManager(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          status:
            mode === 'revoke' ? UserStatus.SUSPENDED : UserStatus.INACTIVE,
        },
      });
      if (user.assignment) {
        await tx.sellerManagerAssignment.update({
          where: { id: user.assignment.id },
          data: {
            status:
              mode === 'revoke'
                ? ManagerAssignmentStatus.REVOKED
                : ManagerAssignmentStatus.INACTIVE,
            isPrimary: false,
            deactivatedAt: new Date(),
          },
        });
      }
      await tx.authSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          action: mode === 'revoke' ? 'MANAGER_REVOKED' : 'MANAGER_DEACTIVATED',
          actorUserId,
          entityType: EntityOwnerType.USER,
          entityId: id,
          metadata: { sellerId: user.assignment?.sellerProfileId ?? null },
        },
      });
    });
    return this.detail(id);
  }

  private async setPrimaryTx(
    tx: Prisma.TransactionClient,
    userId: string,
    sellerProfileId: string,
  ) {
    await tx.sellerManagerAssignment.updateMany({
      where: {
        sellerProfileId,
        status: ManagerAssignmentStatus.ACTIVE,
        isPrimary: true,
        userId: { not: userId },
      },
      data: { isPrimary: false },
    });
    await tx.sellerManagerAssignment.updateMany({
      where: {
        userId,
        sellerProfileId,
        status: ManagerAssignmentStatus.ACTIVE,
      },
      data: { isPrimary: true },
    });
  }

  private async requireManager(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: {
        userRoles: { include: { role: true } },
        managerAssignments: {
          where: {
            status: {
              in: [
                ManagerAssignmentStatus.ACTIVE,
                ManagerAssignmentStatus.INACTIVE,
                ManagerAssignmentStatus.REVOKED,
              ],
            },
          },
          orderBy: { assignedAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const full = await this.prisma.user.findFirst({
      where: { id },
      select: { passwordHash: true },
    });
    const roles = user.userRoles.map((row) => row.role.code);
    if (!roles.includes(RoleCode.SELLER_MANAGER)) {
      throw new BadRequestException('User is not a Seller Manager');
    }
    return {
      ...user,
      passwordHash: full?.passwordHash ?? null,
      assignment: user.managerAssignments[0] ?? null,
    };
  }

  private phone(input: string) {
    try {
      return normalizeIndianMobile(input);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid mobile number',
      );
    }
  }

  private async nextLoginId(tx: Prisma.TransactionClient) {
    const rows = await tx.$queryRaw<Array<{ n: bigint }>>`
      SELECT nextval('seller_manager_login_seq') AS n
    `;
    const n = Number(rows[0]?.n ?? 0);
    if (!Number.isFinite(n) || n <= 0) {
      throw new BadRequestException('Could not allocate a login ID');
    }
    return `PTM-${String(n).padStart(6, '0')}`;
  }
}

const managerInclude = {
  userRoles: { include: { role: { select: { code: true, name: true } } } },
  permissionGrants: { select: { code: true } },
  managerAssignments: {
    orderBy: { assignedAt: 'desc' as const },
    include: {
      sellerProfile: {
        select: {
          id: true,
          status: true,
          organization: {
            select: {
              id: true,
              name: true,
              legalName: true,
              gstin: true,
              pan: true,
              status: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.UserInclude;

type ManagerRecord = Prisma.UserGetPayload<{ include: typeof managerInclude }>;

export function presentManager(
  user: ManagerRecord,
  extra?: {
    loginCount?: number;
    activity?: Array<{
      id: string;
      action: string;
      createdAt: Date;
      actorUserId: string | null;
      metadata: Prisma.JsonValue;
      newData: Prisma.JsonValue;
    }>;
  },
) {
  const assignment =
    user.managerAssignments.find((row) => row.status === 'ACTIVE') ??
    user.managerAssignments[0] ??
    null;
  const seller = assignment?.sellerProfile;
  return {
    id: user.id,
    name:
      user.displayName ||
      [user.firstName, user.lastName].filter(Boolean).join(' ') ||
      user.email,
    email: user.email,
    phone: user.phone,
    loginId: user.loginId,
    role:
      user.userRoles.find((row) => row.role.code === RoleCode.SELLER_MANAGER)
        ?.role.code ??
      user.userRoles[0]?.role.code ??
      null,
    roles: user.userRoles.map((row) => row.role.code),
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    seller: seller
      ? {
          id: seller.id,
          name: seller.organization.name,
          legalName: seller.organization.legalName,
          gst: seller.organization.gstin,
          pan: seller.organization.pan,
          status: seller.status,
          organizationStatus: seller.organization.status,
        }
      : null,
    assignment: assignment
      ? {
          id: assignment.id,
          status: assignment.status,
          isPrimary: assignment.isPrimary,
          title: assignment.title,
          assignedAt: assignment.assignedAt,
          deactivatedAt: assignment.deactivatedAt,
        }
      : null,
    permissions: user.permissionGrants.map((grant) => grant.code),
    loginCount: extra?.loginCount ?? null,
    activity: extra?.activity ?? [],
  };
}

export { managerInclude };
