import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
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
  MANAGER_ASSIGNABLE_SELLER_STATUSES,
  MANAGER_PRESETS,
  ManagerErrorCode,
  SELLER_MANAGER_PERMISSIONS,
  assertAssignablePermissions,
  assertPasswordStrength,
  isSellerAssignable,
  normalizeIndianMobile,
  splitDisplayName,
} from '../../sellers/managers/seller-access.js';
import type {
  CreateSellerManagerDto,
  UpdateManagerDto,
} from './admin-users.dto.js';

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 3;

export type ManagerActor = {
  id: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
};

function fail(
  Exception:
    | typeof BadRequestException
    | typeof ConflictException
    | typeof NotFoundException,
  code: ManagerErrorCode,
  message: string,
): never {
  throw new Exception({ code, message });
}

@Injectable()
export class AdminManagerService implements OnModuleInit {
  private readonly logger = new Logger(AdminManagerService.name);

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
      role: RoleCode.SELLER_MANAGER,
      permissions: SELLER_MANAGER_PERMISSIONS,
      presets: Object.entries(MANAGER_PRESETS).map(([id, preset]) => ({
        id,
        label: preset.label,
        permissions: preset.permissions,
      })),
      defaultPreset: 'OPERATIONS',
      assignableSellerStatuses: MANAGER_ASSIGNABLE_SELLER_STATUSES,
      invitationTtlHours: INVITE_TTL_MS / 3_600_000,
    };
  }

  async create(dto: CreateSellerManagerDto, actor: ManagerActor) {
    if (dto.role !== RoleCode.SELLER_MANAGER) {
      fail(
        BadRequestException,
        ManagerErrorCode.INVALID_ROLE,
        'This endpoint only creates Seller Manager accounts',
      );
    }
    const email = dto.email.trim().toLowerCase();
    const phone = this.phone(dto.phone);
    const name = splitDisplayName(dto.name);
    if (name.displayName.length < 2) {
      throw new BadRequestException('Full name is required');
    }
    const permissions = this.permissions(dto.permissions);

    const seller = await this.requireAssignableSeller(
      this.prisma,
      dto.sellerId,
    );

    const duplicate = await this.prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] },
      select: { email: true, phone: true },
    });
    if (duplicate?.email === email) {
      fail(
        ConflictException,
        ManagerErrorCode.EMAIL_ALREADY_EXISTS,
        'This email is already registered.',
      );
    }
    if (duplicate?.phone === phone) {
      fail(
        ConflictException,
        ManagerErrorCode.MOBILE_ALREADY_EXISTS,
        'This mobile number is already registered.',
      );
    }

    const accessMethod = dto.accessMethod ?? 'INVITATION';
    let passwordHash: string | null = null;
    if (accessMethod === 'TEMPORARY_PASSWORD') {
      if (!dto.temporaryPassword) {
        fail(
          BadRequestException,
          ManagerErrorCode.WEAK_PASSWORD,
          'Temporary password is required',
        );
      }
      try {
        assertPasswordStrength(dto.temporaryPassword);
      } catch (error) {
        fail(
          BadRequestException,
          ManagerErrorCode.WEAK_PASSWORD,
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

    const rawToken =
      accessMethod === 'INVITATION'
        ? this.crypto.generateSecureToken(32)
        : null;
    const tokenHash = rawToken ? this.crypto.hashToken(rawToken) : null;
    const inviteExpiresAt = new Date(Date.now() + INVITE_TTL_MS);

    let created: { id: string; loginId: string | null; status: UserStatus };
    let isPrimary: boolean;
    try {
      ({ created, isPrimary } = await this.prisma.$transaction(async (tx) => {
        const activePrimary = await tx.sellerManagerAssignment.findFirst({
          where: {
            sellerProfileId: seller.id,
            status: ManagerAssignmentStatus.ACTIVE,
            isPrimary: true,
          },
          select: { id: true },
        });
        const primary = dto.isPrimary ?? !activePrimary;
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
          select: { id: true, loginId: true, status: true },
        });
        await tx.userRole.create({
          data: { userId: user.id, roleId: role.id },
        });
        if (primary) {
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
            isPrimary: primary,
            status: ManagerAssignmentStatus.ACTIVE,
            title: dto.title?.trim() || null,
            assignedById: actor.id,
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
              expiresAt: inviteExpiresAt,
            },
          });
        }
        await tx.auditLog.create({
          data: {
            ...this.auditBase(actor, seller.organizationId, user.id),
            action: 'SELLER_MANAGER_CREATED',
            newData: {
              loginId,
              email,
              role: RoleCode.SELLER_MANAGER,
              sellerId: seller.id,
              sellerName: seller.organization.name,
              permissions,
              accessMethod,
              isPrimary: primary,
            },
          },
        });
        await tx.auditLog.create({
          data: {
            ...this.auditBase(actor, seller.organizationId, user.id),
            action: 'MANAGER_ASSIGNED_TO_SELLER',
            newData: { sellerId: seller.id, isPrimary: primary },
          },
        });
        if (tokenHash) {
          await tx.auditLog.create({
            data: {
              ...this.auditBase(actor, seller.organizationId, user.id),
              action: 'MANAGER_INVITATION_CREATED',
              newData: { expiresAt: inviteExpiresAt.toISOString() },
            },
          });
        }
        return { created: user, isPrimary: primary };
      }));
    } catch (error) {
      this.rethrowUniqueViolation(error);
      throw error;
    }

    this.logger.log({
      event: 'seller_manager.created',
      managerId: created.id,
      sellerId: seller.id,
      actorUserId: actor.id,
      requestId: actor.requestId,
      accessMethod,
      permissionCount: permissions.length,
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
        code: seller.organization.code,
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
              expiresAt: inviteExpiresAt.toISOString(),
              email,
              delivery: 'MANUAL' as const,
              message:
                'Email delivery is not configured. Share this one-time setup link with the manager securely. It will not be shown again.',
            },
    };
  }

  async update(id: string, dto: UpdateManagerDto, actor: ManagerActor) {
    const user = await this.requireManager(id);
    const data: Prisma.UserUpdateInput = {};
    if (dto.name) {
      const name = splitDisplayName(dto.name);
      data.displayName = name.displayName;
      data.firstName = name.firstName;
      data.lastName = name.lastName;
    }
    if (dto.phone) {
      const phone = this.phone(dto.phone);
      if (phone !== user.phone) {
        const taken = await this.prisma.user.findFirst({
          where: { phone, id: { not: id } },
          select: { id: true },
        });
        if (taken) {
          fail(
            ConflictException,
            ManagerErrorCode.MOBILE_ALREADY_EXISTS,
            'This mobile number is already registered.',
          );
        }
        data.phone = phone;
      }
    }

    const permissions = dto.permissions
      ? this.permissions(dto.permissions)
      : undefined;
    const previousPermissions = user.permissionGrants.map((row) => row.code);
    const reassigning =
      Boolean(dto.sellerId) &&
      (dto.sellerId !== user.assignment?.sellerProfileId ||
        user.assignment?.status !== ManagerAssignmentStatus.ACTIVE);

    try {
      await this.prisma.$transaction(async (tx) => {
        if (Object.keys(data).length) {
          await tx.user.update({ where: { id }, data });
          await tx.auditLog.create({
            data: {
              ...this.auditBase(actor, null, id),
              action: 'MANAGER_UPDATED',
              newData: {
                name: dto.name,
                phone: data.phone ? '[updated]' : undefined,
              },
            },
          });
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
          await tx.auditLog.create({
            data: {
              ...this.auditBase(actor, null, id),
              action: 'MANAGER_PERMISSION_UPDATED',
              previousData: { permissions: previousPermissions },
              newData: { permissions },
            },
          });
        }
        if (reassigning && dto.sellerId) {
          const seller = await this.requireAssignableSeller(tx, dto.sellerId);
          if (user.assignment?.status === ManagerAssignmentStatus.ACTIVE) {
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
              assignedById: actor.id,
              assignedAt: new Date(),
              title: dto.title ?? user.assignment?.title ?? null,
            },
          });
          // Old seller access ends now: every session must sign in again.
          await tx.authSession.updateMany({
            where: { userId: id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          await tx.auditLog.create({
            data: {
              ...this.auditBase(actor, seller.organizationId, id),
              action: 'MANAGER_ASSIGNED_TO_SELLER',
              previousData: {
                sellerId: user.assignment?.sellerProfileId ?? null,
              },
              newData: { sellerId: seller.id },
            },
          });
        } else if (dto.isPrimary === true && user.assignment) {
          await this.setPrimaryTx(tx, id, user.assignment.sellerProfileId);
        }
        if (dto.title !== undefined && !reassigning && user.assignment) {
          await tx.sellerManagerAssignment.update({
            where: { id: user.assignment.id },
            data: { title: dto.title.trim() || null },
          });
        }
      });
    } catch (error) {
      this.rethrowUniqueViolation(error);
      throw error;
    }

    this.logger.log({
      event: 'seller_manager.updated',
      managerId: id,
      actorUserId: actor.id,
      requestId: actor.requestId,
      permissionsChanged: Boolean(permissions),
      reassigned: reassigning,
    });

    return this.detail(id);
  }

  async setPrimary(id: string, actor: ManagerActor) {
    const user = await this.requireManager(id);
    if (!user.assignment || user.assignment.status !== 'ACTIVE') {
      fail(
        BadRequestException,
        ManagerErrorCode.INVALID_STATE,
        'Manager has no active seller assignment',
      );
    }
    const sellerProfileId = user.assignment.sellerProfileId;
    await this.prisma.$transaction(async (tx) => {
      await this.setPrimaryTx(tx, id, sellerProfileId);
      await tx.auditLog.create({
        data: {
          ...this.auditBase(actor, null, id),
          action: 'MANAGER_UPDATED',
          metadata: {
            isPrimary: true,
            sellerId: sellerProfileId,
            requestId: actor.requestId,
          },
        },
      });
    });
    return this.detail(id);
  }

  async activate(id: string, actor: ManagerActor) {
    const user = await this.requireManager(id);
    if (!user.passwordHash) {
      fail(
        BadRequestException,
        ManagerErrorCode.INVALID_STATE,
        'Manager must set a password from the invitation before the account can be activated',
      );
    }
    if (!user.assignment || user.assignment.status === 'REVOKED') {
      fail(
        BadRequestException,
        ManagerErrorCode.INVALID_STATE,
        'Access was revoked. Assign the seller again before activating.',
      );
    }
    const assignment = user.assignment;
    await this.prisma.$transaction(async (tx) => {
      if (assignment.status !== 'ACTIVE') {
        await this.requireAssignableSeller(tx, assignment.sellerProfileId);
        await tx.sellerManagerAssignment.update({
          where: { id: assignment.id },
          data: {
            status: ManagerAssignmentStatus.ACTIVE,
            deactivatedAt: null,
          },
        });
      }
      await tx.user.update({
        where: { id },
        data: { status: UserStatus.ACTIVE },
      });
      await tx.auditLog.create({
        data: {
          ...this.auditBase(actor, null, id),
          action: 'MANAGER_ACTIVATED',
          previousData: { status: user.status },
        },
      });
    });
    this.logger.log({
      event: 'seller_manager.activated',
      managerId: id,
      actorUserId: actor.id,
      requestId: actor.requestId,
    });
    return this.detail(id);
  }

  async deactivate(id: string, actor: ManagerActor) {
    return this.closeAccess(id, actor, 'deactivate');
  }

  async revoke(id: string, actor: ManagerActor) {
    return this.closeAccess(id, actor, 'revoke');
  }

  /**
   * Issues a one-time link. Managers who never set a password get a new
   * invitation; others get a password reset. Either way old links stop working.
   */
  async resetPassword(id: string, actor: ManagerActor) {
    const user = await this.requireManager(id);
    const purpose = user.passwordHash ? 'PASSWORD_RESET' : 'INVITATION';
    const rawToken = this.crypto.generateSecureToken(32);
    const tokenHash = this.crypto.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.passwordResetToken.create({
        data: { userId: id, tokenHash, purpose, expiresAt },
      });
      await tx.authSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          ...this.auditBase(actor, null, id),
          action:
            purpose === 'INVITATION'
              ? 'MANAGER_INVITATION_RESENT'
              : 'MANAGER_PASSWORD_RESET_REQUESTED',
          newData: { expiresAt: expiresAt.toISOString() },
        },
      });
    });
    this.logger.log({
      event:
        purpose === 'INVITATION'
          ? 'seller_manager.invitation_resent'
          : 'seller_manager.password_reset_requested',
      managerId: id,
      actorUserId: actor.id,
      requestId: actor.requestId,
    });
    return {
      purpose,
      delivery: 'MANUAL' as const,
      message:
        purpose === 'INVITATION'
          ? 'New invitation link created. Earlier links no longer work. Share it securely; it is shown once.'
          : 'Password reset link created. Existing sessions were signed out. Share it securely; it is shown once.',
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
    const [loginCount, activity, pendingLink] = await Promise.all([
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
          actor: { select: { displayName: true, email: true } },
        },
      }),
      this.prisma.passwordResetToken.findFirst({
        where: { userId: id, usedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        select: { purpose: true, expiresAt: true, createdAt: true },
      }),
    ]);
    return presentManager(user, { loginCount, activity, pendingLink });
  }

  private async closeAccess(
    id: string,
    actor: ManagerActor,
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
      if (user.assignment && user.assignment.status === 'ACTIVE') {
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
      // An unused invitation must not let a closed account back in.
      await tx.passwordResetToken.updateMany({
        where: { userId: id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          ...this.auditBase(actor, null, id),
          action: mode === 'revoke' ? 'MANAGER_REVOKED' : 'MANAGER_DEACTIVATED',
          previousData: { status: user.status },
          metadata: {
            sellerId: user.assignment?.sellerProfileId ?? null,
            requestId: actor.requestId,
          },
        },
      });
    });
    this.logger.log({
      event:
        mode === 'revoke'
          ? 'seller_manager.revoked'
          : 'seller_manager.deactivated',
      managerId: id,
      actorUserId: actor.id,
      requestId: actor.requestId,
    });
    return this.detail(id);
  }

  private async requireAssignableSeller(
    client: Pick<PrismaService, 'sellerProfile'> | Prisma.TransactionClient,
    sellerId: string,
  ) {
    const seller = await client.sellerProfile.findFirst({
      where: { id: sellerId, deletedAt: null },
      include: { organization: true },
    });
    if (!seller || seller.organization.deletedAt) {
      fail(
        NotFoundException,
        ManagerErrorCode.SELLER_NOT_FOUND,
        'Seller not found',
      );
    }
    if (!isSellerAssignable(seller.status)) {
      fail(
        BadRequestException,
        ManagerErrorCode.SELLER_NOT_ACTIVE,
        `Seller ${seller.organization.name} is ${seller.status.toLowerCase().replace(/_/g, ' ')}. Only approved sellers can be assigned a manager.`,
      );
    }
    return seller;
  }

  private permissions(codes: string[]) {
    try {
      return assertAssignablePermissions(codes);
    } catch (error) {
      fail(
        BadRequestException,
        ManagerErrorCode.INVALID_PERMISSIONS,
        error instanceof Error ? error.message : 'Invalid permissions',
      );
    }
  }

  private auditBase(
    actor: ManagerActor,
    organizationId: string | null,
    entityId: string,
  ) {
    return {
      actorUserId: actor.id,
      organizationId,
      entityType: EntityOwnerType.USER,
      entityId,
      ipAddress: actor.ipAddress ?? null,
      userAgent: actor.userAgent ?? null,
      metadata: actor.requestId ? { requestId: actor.requestId } : undefined,
    };
  }

  private rethrowUniqueViolation(error: unknown) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return;
    }
    const target = JSON.stringify(error.meta ?? {});
    if (target.includes('email')) {
      fail(
        ConflictException,
        ManagerErrorCode.EMAIL_ALREADY_EXISTS,
        'This email is already registered.',
      );
    }
    if (target.includes('phone')) {
      fail(
        ConflictException,
        ManagerErrorCode.MOBILE_ALREADY_EXISTS,
        'This mobile number is already registered.',
      );
    }
    if (target.includes('seller_manager_one_active')) {
      fail(
        ConflictException,
        ManagerErrorCode.MANAGER_ALREADY_ASSIGNED,
        'This manager already has an active seller assignment.',
      );
    }
    throw new ConflictException(
      'An account with this email, mobile number, or login ID already exists.',
    );
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
        permissionGrants: { select: { code: true } },
        managerAssignments: {
          orderBy: { assignedAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const roles = user.userRoles.map((row) => row.role.code);
    if (!roles.includes(RoleCode.SELLER_MANAGER)) {
      fail(
        BadRequestException,
        ManagerErrorCode.NOT_A_MANAGER,
        'User is not a Seller Manager',
      );
    }
    return { ...user, assignment: user.managerAssignments[0] ?? null };
  }

  private phone(input: string) {
    try {
      return normalizeIndianMobile(input);
    } catch (error) {
      fail(
        BadRequestException,
        ManagerErrorCode.INVALID_MOBILE,
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
      assignedBy: {
        select: { id: true, displayName: true, email: true },
      },
      sellerProfile: {
        select: {
          id: true,
          status: true,
          organization: {
            select: {
              id: true,
              code: true,
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
      actor?: { displayName: string | null; email: string | null } | null;
    }>;
    pendingLink?: {
      purpose: string;
      expiresAt: Date;
      createdAt: Date;
    } | null;
  },
) {
  const assignment =
    user.managerAssignments.find((row) => row.status === 'ACTIVE') ??
    user.managerAssignments[0] ??
    null;
  const seller = assignment?.sellerProfile;
  const firstAssignment =
    user.managerAssignments[user.managerAssignments.length - 1] ?? null;
  const createdBy = firstAssignment?.assignedBy ?? null;
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
    hasPassword: Boolean(user.passwordHash),
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    createdBy: createdBy
      ? {
          id: createdBy.id,
          name: createdBy.displayName || createdBy.email || 'Admin',
        }
      : null,
    seller: seller
      ? {
          id: seller.id,
          code: seller.organization.code,
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
    pendingLink: extra?.pendingLink
      ? {
          purpose: extra.pendingLink.purpose,
          expiresAt: extra.pendingLink.expiresAt,
          createdAt: extra.pendingLink.createdAt,
        }
      : null,
    loginCount: extra?.loginCount ?? null,
    activity: (extra?.activity ?? []).map((row) => ({
      id: row.id,
      action: row.action,
      createdAt: row.createdAt,
      actorUserId: row.actorUserId,
      actorName: row.actor?.displayName || row.actor?.email || null,
      metadata: row.metadata,
      newData: row.newData,
    })),
  };
}

export { managerInclude };
