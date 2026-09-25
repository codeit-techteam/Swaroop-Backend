import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrganizationType,
  Prisma,
  SupportMessageSender,
  SupportRequesterType,
  SupportTicketStatus,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  paginationMeta,
  resolveSearch,
  skipTake,
} from '../master-data/common/pagination.js';
import { nextReference } from '../sellers/common/seller-context.service.js';
import {
  CreateSupportTicketDto,
  ReplySupportTicketDto,
  SupportTicketsQueryDto,
  UpdateSupportTicketStatusDto,
} from './support.dto.js';
import { toSupportTicketDto } from './support.mapper.js';

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

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

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

  private displayName(user: {
    displayName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  }) {
    if (user.displayName?.trim()) return user.displayName.trim();
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    return name || 'You';
  }

  async create(
    userId: string,
    requesterType: SupportRequesterType,
    dto: CreateSupportTicketDto,
  ) {
    const org = await this.resolveOrg(userId, requesterType);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const senderName = this.displayName(user ?? {});

    const ticket = await this.prisma.supportTicket.create({
      data: {
        ticketNumber: nextReference('SUP'),
        requesterType,
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
        orderBy: { createdAt: 'desc' },
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
    if (
      existing.status === SupportTicketStatus.CLOSED ||
      existing.status === SupportTicketStatus.RESOLVED
    ) {
      throw new ForbiddenException(
        'This ticket is closed. Raise a new ticket for further help.',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const senderName = this.displayName(user ?? {});

    const nextStatus =
      existing.status === SupportTicketStatus.WAITING_CUSTOMER
        ? SupportTicketStatus.IN_PROGRESS
        : existing.status;

    const row = await this.prisma.supportTicket.update({
      where: { id },
      data: {
        status: nextStatus,
        messages: {
          create: {
            sender: SupportMessageSender.REQUESTER,
            senderName,
            body: dto.body.trim(),
            attachmentName: dto.attachmentName?.trim() || null,
          },
        },
      },
      include: ticketInclude,
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
      ...(query.organizationId
        ? { organizationId: query.organizationId }
        : {}),
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
    actor: {
      id: string;
      displayName?: string | null;
      firstName?: string | null;
      lastName?: string | null;
    },
    dto: UpdateSupportTicketStatusDto,
  ) {
    const existing = await this.prisma.supportTicket.findFirst({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Support ticket not found.');
    }

    const agentName =
      dto.assignedToName?.trim() ||
      this.displayName(actor) ||
      'Support Agent';

    const now = new Date();
    const data: Prisma.SupportTicketUpdateInput = {
      status: dto.status,
      assignedToName: agentName,
      assignedToUser: dto.assignedToUserId
        ? { connect: { id: dto.assignedToUserId } }
        : { connect: { id: actor.id } },
      resolvedAt:
        dto.status === SupportTicketStatus.RESOLVED
          ? now
          : dto.status === SupportTicketStatus.OPEN ||
              dto.status === SupportTicketStatus.IN_PROGRESS ||
              dto.status === SupportTicketStatus.WAITING_CUSTOMER
            ? null
            : existing.resolvedAt,
      closedAt:
        dto.status === SupportTicketStatus.CLOSED
          ? now
          : dto.status === SupportTicketStatus.OPEN ||
              dto.status === SupportTicketStatus.IN_PROGRESS ||
              dto.status === SupportTicketStatus.WAITING_CUSTOMER
            ? null
            : existing.closedAt,
    };

    if (dto.note?.trim()) {
      data.messages = {
        create: {
          sender: SupportMessageSender.AGENT,
          senderName: agentName,
          body: dto.note.trim(),
        },
      };
    } else if (dto.status !== existing.status) {
      data.messages = {
        create: {
          sender: SupportMessageSender.SYSTEM,
          senderName: 'System',
          body: `Status updated to ${dto.status.replace(/_/g, ' ').toLowerCase()}.`,
        },
      };
    }

    const row = await this.prisma.supportTicket.update({
      where: { id },
      data,
      include: ticketInclude,
    });

    return toSupportTicketDto(row, { includeInternal: true });
  }

  async replyAdmin(
    id: string,
    actor: {
      id: string;
      displayName?: string | null;
      firstName?: string | null;
      lastName?: string | null;
    },
    dto: ReplySupportTicketDto,
  ) {
    const existing = await this.prisma.supportTicket.findFirst({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Support ticket not found.');
    }

    const agentName = this.displayName(actor) || 'Support Agent';
    const row = await this.prisma.supportTicket.update({
      where: { id },
      data: {
        status:
          existing.status === SupportTicketStatus.OPEN
            ? SupportTicketStatus.IN_PROGRESS
            : existing.status === SupportTicketStatus.RESOLVED ||
                existing.status === SupportTicketStatus.CLOSED
              ? existing.status
              : SupportTicketStatus.WAITING_CUSTOMER,
        assignedToName: existing.assignedToName ?? agentName,
        assignedToUser: existing.assignedToUserId
          ? undefined
          : { connect: { id: actor.id } },
        messages: {
          create: {
            sender: SupportMessageSender.AGENT,
            senderName: agentName,
            body: dto.body.trim(),
            attachmentName: dto.attachmentName?.trim() || null,
          },
        },
      },
      include: ticketInclude,
    });

    return toSupportTicketDto(row, { includeInternal: true });
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
