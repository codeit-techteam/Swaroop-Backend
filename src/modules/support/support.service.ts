import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EntityOwnerType,
  OrganizationType,
  Prisma,
  SupportMessageSender,
  SupportRequesterType,
  SupportTicketChannel,
  SupportTicketStatus,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminAuditService } from '../admin/common/admin-audit.service.js';
import {
  paginationMeta,
  resolveSearch,
  skipTake,
} from '../master-data/common/pagination.js';
import { NotificationService } from '../notifications/notification.service.js';
import { nextReference } from '../sellers/common/seller-context.service.js';
import {
  CreateSupportTicketDto,
  ReplySupportTicketDto,
  SupportTicketsQueryDto,
  UpdateSupportTicketStatusDto,
} from './support.dto.js';
import { toSupportTicketDto } from './support.mapper.js';
import {
  TICKETS_PER_HOUR_LIMIT,
  checkAgentTransition,
  label,
  statusAfterAgentReply,
  statusAfterRequesterReply,
} from './support-workflow.js';

const ticketInclude = {
  messages: { orderBy: { createdAt: 'asc' as const } },
  organization: {
    select: { id: true, name: true, legalName: true, type: true },
  },
  requesterUser: {
    select: {
      id: true,
      displayName: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
    },
  },
} satisfies Prisma.SupportTicketInclude;

type Actor = {
  id: string;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

const TICKET_NUMBER_ATTEMPTS = 5;
const STALE_TICKET_MESSAGE =
  'This ticket was just updated by someone else. Refresh and try again.';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly audit: AdminAuditService,
  ) {}

  private async resolveOrg(
    userId: string,
    requesterType: SupportRequesterType,
  ): Promise<{ organizationId: string; organizationName: string }> {
    if (requesterType === SupportRequesterType.CUSTOMER) {
      const profile = await this.prisma.customerProfile.findFirst({
        where: { userId, deletedAt: null },
        include: { organization: true },
      });
      if (!profile) {
        throw new NotFoundException(
          'Customer profile not found. Complete customer onboarding first.',
        );
      }
      return {
        organizationId: profile.organizationId,
        organizationName: profile.organization.name,
      };
    }

    const profile = await this.prisma.sellerProfile.findFirst({
      where: { userId, deletedAt: null },
      include: { organization: true },
    });
    if (!profile) {
      throw new NotFoundException(
        'Seller profile not found. Complete seller onboarding first.',
      );
    }
    return {
      organizationId: profile.organizationId,
      organizationName: profile.organization.name,
    };
  }

  private displayName(
    user: {
      displayName?: string | null;
      firstName?: string | null;
      lastName?: string | null;
    },
    fallback: string,
  ) {
    if (user.displayName?.trim()) return user.displayName.trim();
    const name = [user.firstName, user.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    return name || fallback;
  }

  private async assertCreateRate(userId: string) {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await this.prisma.supportTicket.count({
      where: { requesterUserId: userId, createdAt: { gte: since } },
    });
    if (recent >= TICKETS_PER_HOUR_LIMIT) {
      throw new HttpException(
        'You have raised too many tickets in the last hour. Please reply on an existing ticket or try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async create(
    userId: string,
    requesterType: SupportRequesterType,
    dto: CreateSupportTicketDto,
  ) {
    const org = await this.resolveOrg(userId, requesterType);
    await this.assertCreateRate(userId);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const senderName = this.displayName(user ?? {}, 'You');

    for (let attempt = 1; ; attempt += 1) {
      try {
        const ticket = await this.prisma.supportTicket.create({
          data: {
            ticketNumber: nextReference('SUP'),
            requesterType,
            channel: dto.channel ?? SupportTicketChannel.WEB,
            requesterUserId: userId,
            organizationId: org.organizationId,
            category: dto.category,
            priority: dto.priority ?? 'MEDIUM',
            status: SupportTicketStatus.OPEN,
            subject: dto.subject.trim(),
            description: dto.description.trim(),
            attachmentName: dto.attachmentName?.trim() || null,
            relatedOrderId: dto.relatedOrderId?.trim() || null,
            assignedToName: 'Queue — Support Desk',
            messages: {
              create: {
                sender: SupportMessageSender.REQUESTER,
                senderName,
                body: dto.description.trim(),
                attachmentName: dto.attachmentName?.trim() || null,
              },
            },
          },
          include: ticketInclude,
        });
        return toSupportTicketDto(ticket);
      } catch (err) {
        const duplicateNumber =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          JSON.stringify(err.meta?.target ?? '').includes('ticket_number');
        if (!duplicateNumber || attempt >= TICKET_NUMBER_ATTEMPTS) throw err;
      }
    }
  }

  async listMine(
    userId: string,
    requesterType: SupportRequesterType,
    query: SupportTicketsQueryDto,
  ) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const search = resolveSearch(query);

    const where: Prisma.SupportTicketWhereInput = {
      requesterUserId: userId,
      requesterType,
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(search
        ? {
            OR: [
              { ticketNumber: { contains: search, mode: 'insensitive' } },
              { subject: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.findMany({
        where,
        include: ticketInclude,
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
    ]);

    return {
      items: rows.map((row) => toSupportTicketDto(row)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async getMine(
    userId: string,
    requesterType: SupportRequesterType,
    id: string,
  ) {
    const row = await this.prisma.supportTicket.findFirst({
      where: { id, requesterUserId: userId, requesterType },
      include: ticketInclude,
    });
    if (!row) {
      throw new NotFoundException('Support ticket not found.');
    }
    return toSupportTicketDto(row);
  }

  async replyMine(
    userId: string,
    requesterType: SupportRequesterType,
    id: string,
    dto: ReplySupportTicketDto,
  ) {
    const existing = await this.prisma.supportTicket.findFirst({
      where: { id, requesterUserId: userId, requesterType },
    });
    if (!existing) {
      throw new NotFoundException('Support ticket not found.');
    }
    const nextStatus = statusAfterRequesterReply(existing.status);
    if (!nextStatus) {
      throw new ForbiddenException(
        'This ticket is closed. Raise a new ticket for further help.',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const senderName = this.displayName(user ?? {}, 'You');
    const reopened = existing.status === SupportTicketStatus.RESOLVED;

    const row = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.supportTicket.updateMany({
        where: { id, status: existing.status },
        data: {
          status: nextStatus,
          ...(reopened ? { resolvedAt: null } : {}),
        },
      });
      if (count === 0) throw new ConflictException(STALE_TICKET_MESSAGE);

      await tx.supportTicketMessage.create({
        data: {
          ticketId: id,
          sender: SupportMessageSender.REQUESTER,
          senderName,
          body: dto.body.trim(),
          attachmentName: dto.attachmentName?.trim() || null,
        },
      });
      if (reopened) {
        await tx.supportTicketMessage.create({
          data: {
            ticketId: id,
            sender: SupportMessageSender.SYSTEM,
            senderName: 'System',
            body: 'Ticket reopened by the requester.',
          },
        });
      }
      return tx.supportTicket.findUniqueOrThrow({
        where: { id },
        include: ticketInclude,
      });
    });

    return toSupportTicketDto(row);
  }

  async listAdmin(query: SupportTicketsQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const search = resolveSearch(query);

    const where: Prisma.SupportTicketWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.requesterType ? { requesterType: query.requesterType } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      ...(search
        ? {
            OR: [
              { ticketNumber: { contains: search, mode: 'insensitive' } },
              { subject: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
              {
                organization: {
                  name: { contains: search, mode: 'insensitive' },
                },
              },
              {
                organization: {
                  legalName: { contains: search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.findMany({
        where,
        include: ticketInclude,
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
    ]);

    return {
      items: rows.map((row) =>
        toSupportTicketDto(row, { includeInternal: true }),
      ),
      meta: paginationMeta(page, limit, total),
    };
  }

  async getAdmin(id: string) {
    const row = await this.prisma.supportTicket.findFirst({
      where: { id },
      include: ticketInclude,
    });
    if (!row) {
      throw new NotFoundException('Support ticket not found.');
    }
    return toSupportTicketDto(row, { includeInternal: true });
  }

  async updateAdmin(
    id: string,
    actor: Actor,
    dto: UpdateSupportTicketStatusDto,
  ) {
    const existing = await this.prisma.supportTicket.findFirst({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Support ticket not found.');
    }

    const check = checkAgentTransition(existing.status, dto.status, dto.note);
    if (!check.ok) throw new BadRequestException(check.reason);

    const agentName = this.displayName(actor, 'Support Agent');
    const note = dto.note?.trim() || null;
    const statusChanged = dto.status !== existing.status;
    const reopened =
      statusChanged &&
      (existing.status === SupportTicketStatus.RESOLVED ||
        existing.status === SupportTicketStatus.CLOSED);
    const now = new Date();

    const keepAssignee =
      Boolean(existing.assignedToUserId) && !dto.assignedToUserId;
    const assignee =
      dto.assignedToUserId ?? existing.assignedToUserId ?? actor.id;
    const assigneeName =
      dto.assignedToName?.trim() ||
      (keepAssignee ? existing.assignedToName : null) ||
      agentName;

    const row = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.supportTicket.updateMany({
        where: { id, status: existing.status },
        data: {
          status: dto.status,
          assignedToUserId: assignee,
          assignedToName: assigneeName,
          ...(dto.status === SupportTicketStatus.RESOLVED
            ? { resolvedAt: now, resolutionNote: note }
            : {}),
          ...(dto.status === SupportTicketStatus.CLOSED
            ? {
                closedAt: now,
                resolvedAt: existing.resolvedAt ?? now,
              }
            : {}),
          ...(reopened ? { resolvedAt: null, closedAt: null } : {}),
        },
      });
      if (count === 0) throw new ConflictException(STALE_TICKET_MESSAGE);

      if (statusChanged) {
        await tx.supportTicketMessage.create({
          data: {
            ticketId: id,
            sender: SupportMessageSender.SYSTEM,
            senderName: 'System',
            body: reopened
              ? `Ticket reopened by ${agentName}.`
              : `Status updated to ${label(dto.status)} by ${agentName}.`,
          },
        });
      }
      if (note) {
        await tx.supportTicketMessage.create({
          data: {
            ticketId: id,
            sender: SupportMessageSender.AGENT,
            senderName: agentName,
            body: note,
          },
        });
      }
      return tx.supportTicket.findUniqueOrThrow({
        where: { id },
        include: ticketInclude,
      });
    });

    await this.recordAdminAction(actor.id, row.organizationId, id, {
      action: 'SUPPORT_TICKET_STATUS_CHANGED',
      previousData: { status: existing.status },
      newData: { status: dto.status, note },
    });
    if (statusChanged || note) {
      await this.notifyRequester(row, {
        title: this.statusNoticeTitle(
          row.ticketNumber,
          dto.status,
          statusChanged,
        ),
        body:
          note ?? `Your ticket "${row.subject}" is now ${label(dto.status)}.`,
        status: dto.status,
      });
    }

    return toSupportTicketDto(row, { includeInternal: true });
  }

  async replyAdmin(id: string, actor: Actor, dto: ReplySupportTicketDto) {
    const existing = await this.prisma.supportTicket.findFirst({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Support ticket not found.');
    }
    const nextStatus = statusAfterAgentReply(existing.status);
    if (!nextStatus) {
      throw new BadRequestException(
        'This ticket is closed. Reopen it before replying.',
      );
    }

    const agentName = this.displayName(actor, 'Support Agent');
    const row = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.supportTicket.updateMany({
        where: { id, status: existing.status },
        data: {
          status: nextStatus,
          ...(existing.assignedToUserId
            ? {}
            : { assignedToUserId: actor.id, assignedToName: agentName }),
        },
      });
      if (count === 0) throw new ConflictException(STALE_TICKET_MESSAGE);

      await tx.supportTicketMessage.create({
        data: {
          ticketId: id,
          sender: SupportMessageSender.AGENT,
          senderName: agentName,
          body: dto.body.trim(),
          attachmentName: dto.attachmentName?.trim() || null,
        },
      });
      return tx.supportTicket.findUniqueOrThrow({
        where: { id },
        include: ticketInclude,
      });
    });

    await this.recordAdminAction(actor.id, row.organizationId, id, {
      action: 'SUPPORT_TICKET_REPLIED',
      previousData: { status: existing.status },
      newData: { status: nextStatus },
    });
    await this.notifyRequester(row, {
      title: `Support replied on ${row.ticketNumber}`,
      body: dto.body.trim(),
      status: nextStatus,
    });

    return toSupportTicketDto(row, { includeInternal: true });
  }

  private statusNoticeTitle(
    ticketNumber: string,
    status: SupportTicketStatus,
    statusChanged: boolean,
  ) {
    if (!statusChanged) return `Support replied on ${ticketNumber}`;
    switch (status) {
      case SupportTicketStatus.RESOLVED:
        return `Ticket ${ticketNumber} resolved`;
      case SupportTicketStatus.CLOSED:
        return `Ticket ${ticketNumber} closed`;
      case SupportTicketStatus.WAITING_CUSTOMER:
        return `Action needed on ticket ${ticketNumber}`;
      default:
        return `Ticket ${ticketNumber} updated`;
    }
  }

  /** Notification failures must never roll back a ticket action. */
  private async notifyRequester(
    ticket: {
      id: string;
      ticketNumber: string;
      requesterUserId: string;
      requesterType: SupportRequesterType;
      organizationId: string;
    },
    notice: { title: string; body: string; status: SupportTicketStatus },
  ) {
    try {
      await this.notifications.create({
        userId: ticket.requesterUserId,
        organizationId: ticket.organizationId,
        title: notice.title,
        body: notice.body.slice(0, 500),
        entityType: EntityOwnerType.SUPPORT_TICKET,
        entityId: ticket.id,
        metadata: {
          module: 'SUPPORT',
          eventKey: 'SUPPORT_TICKET_UPDATED',
          ticketNumber: ticket.ticketNumber,
          status: notice.status,
          audience: ticket.requesterType,
        },
      });
    } catch (error) {
      this.logger.error(
        `Support notification failed for ticket ${ticket.ticketNumber}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async recordAdminAction(
    actorUserId: string,
    organizationId: string,
    ticketId: string,
    entry: { action: string; previousData: unknown; newData: unknown },
  ) {
    try {
      await this.audit.log({
        action: entry.action,
        actorUserId,
        organizationId,
        entityType: EntityOwnerType.SUPPORT_TICKET,
        entityId: ticketId,
        previousData: entry.previousData,
        newData: entry.newData,
        metadata: { module: 'SUPPORT' },
      });
    } catch (error) {
      this.logger.error(
        `Support audit log failed for ticket ${ticketId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Soft sanity: ensure org type matches requester type when present. */
  assertOrgType(
    orgType: OrganizationType | undefined,
    requesterType: SupportRequesterType,
  ) {
    if (!orgType) return;
    if (
      requesterType === SupportRequesterType.CUSTOMER &&
      orgType === OrganizationType.SELLER
    ) {
      throw new ForbiddenException('Invalid organization for customer ticket.');
    }
    if (
      requesterType === SupportRequesterType.SELLER &&
      orgType === OrganizationType.CUSTOMER
    ) {
      throw new ForbiddenException('Invalid organization for seller ticket.');
    }
  }
}
