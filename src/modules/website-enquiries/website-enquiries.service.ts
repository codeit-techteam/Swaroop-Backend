import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EntityOwnerType,
  Prisma,
  type WebsiteEnquiry,
} from '../../generated/prisma/client.js';
import { RoleCode } from '../../common/enums/domain.enums.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminAuditService } from '../admin/common/admin-audit.service.js';
import {
  paginationMeta,
  resolveSearch,
  skipTake,
} from '../master-data/common/pagination.js';
import { NotificationService } from '../notifications/notification.service.js';
import { nextReference } from '../sellers/common/seller-context.service.js';
import type {
  CreateWebsiteEnquiryDto,
  UpdateWebsiteEnquiryDto,
  WebsiteEnquiriesQueryDto,
} from './website-enquiries.dto.js';

/** Per-IP cap on stored enquiries, on top of the global request limiter. */
export const ENQUIRIES_PER_IP_PER_HOUR = 5;
const REFERENCE_ATTEMPTS = 5;
const NOTIFY_ROLES = [
  RoleCode.ADMIN,
  RoleCode.SUPER_ADMIN,
  RoleCode.OPERATIONS_MANAGER,
];

export type RequestOrigin = { ipAddress?: string; userAgent?: string };
type Actor = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
};

@Injectable()
export class WebsiteEnquiriesService {
  private readonly logger = new Logger(WebsiteEnquiriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly audit: AdminAuditService,
  ) {}

  async create(dto: CreateWebsiteEnquiryDto, origin: RequestOrigin) {
    // Bots that fill the honeypot get an indistinguishable response, but nothing is stored.
    if (dto.website?.trim()) {
      return {
        referenceNumber: nextReference('ENQ'),
        createdAt: new Date().toISOString(),
      };
    }

    if (origin.ipAddress) {
      const recent = await this.prisma.websiteEnquiry.count({
        where: {
          ipAddress: origin.ipAddress,
          createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
        },
      });
      if (recent >= ENQUIRIES_PER_IP_PER_HOUR) {
        throw new HttpException(
          'You have sent several messages recently. Please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const enquiry = await this.insertWithUniqueReference(dto, origin);
    await this.notifyTeam(enquiry);
    return {
      referenceNumber: enquiry.referenceNumber,
      createdAt: enquiry.createdAt.toISOString(),
    };
  }

  async listAdmin(query: WebsiteEnquiriesQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const search = resolveSearch(query);
    const where: Prisma.WebsiteEnquiryWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.topic ? { topic: query.topic } : {}),
      ...(search
        ? {
            OR: [
              { referenceNumber: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
              { company: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.websiteEnquiry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.websiteEnquiry.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.toDto(row)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async getAdmin(id: string) {
    return this.toDto(await this.require(id));
  }

  async updateAdmin(id: string, actor: Actor, dto: UpdateWebsiteEnquiryDto) {
    if (dto.status === undefined && dto.adminNotes === undefined) {
      throw new BadRequestException('Nothing to update');
    }
    const existing = await this.require(id);
    const handledByName =
      [actor.firstName, actor.lastName].filter(Boolean).join(' ').trim() ||
      null;
    const updated = await this.prisma.websiteEnquiry.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.adminNotes !== undefined
          ? { adminNotes: dto.adminNotes.trim() || null }
          : {}),
        handledByUserId: actor.id,
        handledByName,
      },
    });
    await this.audit.log({
      action: 'WEBSITE_ENQUIRY_UPDATED',
      actorUserId: actor.id,
      entityType: EntityOwnerType.OTHER,
      entityId: id,
      previousData: { status: existing.status },
      newData: {
        status: updated.status,
        notesChanged: dto.adminNotes !== undefined,
      },
      metadata: { referenceNumber: existing.referenceNumber },
    });
    return this.toDto(updated);
  }

  private async insertWithUniqueReference(
    dto: CreateWebsiteEnquiryDto,
    origin: RequestOrigin,
  ): Promise<WebsiteEnquiry> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.websiteEnquiry.create({
          data: {
            referenceNumber: nextReference('ENQ'),
            name: dto.name,
            company: dto.company || null,
            email: dto.email.toLowerCase(),
            phone: dto.phone || null,
            topic: dto.topic,
            message: dto.message,
            pagePath: dto.pagePath?.startsWith('/') ? dto.pagePath : null,
            ipAddress: origin.ipAddress?.slice(0, 64) ?? null,
            userAgent: origin.userAgent?.slice(0, 300) ?? null,
          },
        });
      } catch (err) {
        const duplicate =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          JSON.stringify(err.meta?.target ?? '').includes('reference_number');
        if (!duplicate || attempt >= REFERENCE_ATTEMPTS) throw err;
      }
    }
  }

  private async notifyTeam(enquiry: WebsiteEnquiry) {
    try {
      const recipients = await this.prisma.userRole.findMany({
        where: { role: { code: { in: NOTIFY_ROLES } } },
        select: { userId: true },
        distinct: ['userId'],
      });
      await Promise.all(
        recipients.map((row) =>
          this.notifications.create({
            userId: row.userId,
            title: `New website enquiry ${enquiry.referenceNumber}`,
            body: `${enquiry.name}${enquiry.company ? ` (${enquiry.company})` : ''} — ${enquiry.topic.replace(/_/g, ' ').toLowerCase()}`,
            entityType: EntityOwnerType.OTHER,
            entityId: enquiry.id,
            metadata: { kind: 'WEBSITE_ENQUIRY' },
          }),
        ),
      );
    } catch (err) {
      // The enquiry is stored; a notification failure must not fail the request.
      this.logger.warn(
        `Website enquiry ${enquiry.referenceNumber} notification failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async require(id: string) {
    const row = await this.prisma.websiteEnquiry.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Enquiry not found');
    return row;
  }

  private toDto(row: WebsiteEnquiry) {
    return {
      id: row.id,
      referenceNumber: row.referenceNumber,
      name: row.name,
      company: row.company,
      email: row.email,
      phone: row.phone,
      topic: row.topic,
      message: row.message,
      status: row.status,
      source: row.source,
      pagePath: row.pagePath,
      adminNotes: row.adminNotes,
      handledByName: row.handledByName,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
