import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DocumentStatus,
  EntityOwnerType,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { NotificationService } from '../../notifications/notification.service.js';
import { DocumentsCoreService } from '../../documents/services/documents-core.service.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { AdminAuditService } from '../common/admin-audit.service.js';
import type {
  AdminDocumentActionDto,
  AdminDocumentsQueryDto,
} from './admin-documents.dto.js';

@Injectable()
export class AdminDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly notifications: NotificationService,
    private readonly documents: DocumentsCoreService,
  ) {}

  async list(query: AdminDocumentsQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.DocumentWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.category) where.category = query.category;
    if (query.organizationId) where.organizationId = query.organizationId;
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { fileName: { contains: q, mode: 'insensitive' } },
        { documentNumber: { contains: q, mode: 'insensitive' } },
        { storageKey: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          organization: {
            select: { id: true, name: true, legalName: true },
          },
          uploadedBy: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
      }),
      this.prisma.document.count({ where }),
    ]);

    return {
      items: items.map((d) => ({
        ...this.documents.mapDocument(d),
        organization: d.organization,
        uploadedBy: d.uploadedBy,
      })),
      meta: paginationMeta(page, limit, total),
    };
  }

  async findOne(id: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, deletedAt: null },
      include: {
        organization: {
          select: { id: true, name: true, legalName: true },
        },
        uploadedBy: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        versions: { orderBy: { versionNumber: 'desc' } },
      },
    });
    if (!doc) throw new NotFoundException('Document not found');
    return {
      ...this.documents.mapDocument(doc),
      organization: doc.organization,
      uploadedBy: doc.uploadedBy,
      versions: doc.versions.map((v) => ({
        ...v,
        fileSizeBytes:
          v.fileSizeBytes != null ? v.fileSizeBytes.toString() : null,
      })),
    };
  }

  async versions(id: string) {
    return this.documents.versions(id);
  }

  async expiring(days?: number) {
    return this.documents.listExpiring(days ?? 30);
  }

  async approve(id: string, actorUserId: string, dto: AdminDocumentActionDto) {
    const existing = await this.prisma.document.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Document not found');

    const doc = await this.documents.approve(id, actorUserId, {
      notes: dto.notes,
      reason: dto.reason,
    });

    // Clear review flags so seller panel shows a clean verified state.
    const meta =
      existing.metadata &&
      typeof existing.metadata === 'object' &&
      !Array.isArray(existing.metadata)
        ? (existing.metadata as Record<string, unknown>)
        : {};
    if (meta.awaitingAdminReview || meta.r2Confirmed === false) {
      await this.prisma.document.update({
        where: { id },
        data: {
          metadata: {
            ...meta,
            awaitingAdminReview: false,
            r2Confirmed: true,
            approvedVia: 'admin',
          } as Prisma.InputJsonValue,
        },
      });
    }

    await this.audit.log({
      action: 'DOCUMENT_APPROVED',
      actorUserId,
      organizationId: existing.organizationId ?? undefined,
      entityType: EntityOwnerType.DOCUMENT,
      entityId: id,
      previousData: { status: existing.status },
      newData: { status: DocumentStatus.VERIFIED },
    });

    if (existing.uploadedById) {
      await this.notifications.create({
        userId: existing.uploadedById,
        organizationId: existing.organizationId ?? undefined,
        title: 'Document approved',
        body: `Your document ${existing.documentNumber ?? existing.fileName} was verified.`,
        entityType: EntityOwnerType.DOCUMENT,
        entityId: id,
        metadata: { status: DocumentStatus.VERIFIED },
      });
    }

    return doc;
  }

  async reject(id: string, actorUserId: string, dto: AdminDocumentActionDto) {
    const reason = (dto.reason ?? dto.notes)?.trim();
    if (!reason) {
      throw new BadRequestException('Rejection reason is required');
    }

    const existing = await this.prisma.document.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Document not found');

    const doc = await this.documents.reject(id, actorUserId, {
      reason,
      notes: dto.notes,
    });

    await this.audit.log({
      action: 'DOCUMENT_REJECTED',
      actorUserId,
      organizationId: existing.organizationId ?? undefined,
      entityType: EntityOwnerType.DOCUMENT,
      entityId: id,
      previousData: { status: existing.status },
      newData: { status: DocumentStatus.REJECTED, reason },
    });

    if (existing.uploadedById) {
      await this.notifications.create({
        userId: existing.uploadedById,
        organizationId: existing.organizationId ?? undefined,
        title: 'Document rejected',
        body: `Your document ${existing.documentNumber ?? existing.fileName} was rejected: ${reason}`,
        entityType: EntityOwnerType.DOCUMENT,
        entityId: id,
        metadata: { status: DocumentStatus.REJECTED, reason },
      });
    }

    return doc;
  }

  async download(id: string) {
    return this.documents.download(id);
  }
}
