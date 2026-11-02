import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  EntityOwnerType,
  GradeStatus,
  TdsRequestStatus,
  TdsSourceKind,
  TdsVerificationStatus,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { skipTake } from '../master-data/common/pagination.js';
import { NotificationService } from '../notifications/notification.service.js';
import {
  loadGradeMatchIndex,
  matchGradeFromIndex,
} from './tds-grade-matcher.js';
import {
  buildGradeTdsObjectKey,
  buildImportKey,
  isAllowedTdsMime,
  mimeFromFilename,
  parseGradeTdsObjectKey,
  sanitizeObjectSegment,
} from './tds-normalize.js';

const CUSTOMER_VISIBLE: TdsVerificationStatus[] = [
  TdsVerificationStatus.VERIFIED,
];

@Injectable()
export class GradeTdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationService,
  ) {}

  private mapCustomerDoc(
    doc: {
      id: string;
      documentTitle: string;
      documentType: string;
      originalFilename: string | null;
      mimeType: string | null;
      fileSizeBytes: bigint | null;
      producerName: string;
      gradeCode: string;
      categoryCode: string;
      revision: number;
      verificationStatus: TdsVerificationStatus;
      sourceKind: TdsSourceKind;
      uploadedAt: Date | null;
      approvedAt: Date | null;
    },
    displayTitle?: string | null,
  ) {
    const mime = doc.mimeType ?? 'application/octet-stream';
    const isImage = mime.startsWith('image/');
    const syncedTitle =
      displayTitle?.trim() ||
      doc.documentTitle ||
      `${doc.gradeCode} – ${doc.producerName}`;
    return {
      id: doc.id,
      type: doc.documentType,
      title: syncedTitle,
      fileName: doc.originalFilename,
      mimeType: mime,
      fileSizeBytes:
        doc.fileSizeBytes != null ? Number(doc.fileSizeBytes) : null,
      manufacturer: doc.producerName,
      gradeCode: doc.gradeCode,
      categoryCode: doc.categoryCode,
      revision: doc.revision,
      verificationStatus: doc.verificationStatus,
      sourceKind: doc.sourceKind,
      format: isImage ? 'image' : mime === 'application/pdf' ? 'pdf' : 'other',
      available: true,
      downloadRequiresAuth: true,
      uploadedAt: doc.uploadedAt?.toISOString() ?? null,
      approvedAt: doc.approvedAt?.toISOString() ?? null,
      source: 'GRADE_LIBRARY' as const,
    };
  }

  private gradeDisplayName(grade: {
    displayName?: string | null;
    fullGradeName?: string | null;
    name: string;
    gradeNo?: string | null;
    manufacturer?: string | null;
  }): string {
    const base =
      grade.fullGradeName?.trim() ||
      grade.displayName?.trim() ||
      grade.name?.trim() ||
      grade.gradeNo?.trim() ||
      'Grade';
    if (grade.manufacturer?.trim() && !base.toUpperCase().includes(grade.manufacturer.trim().toUpperCase())) {
      return `${base} – ${grade.manufacturer.trim()}`;
    }
    return base;
  }

  /**
   * Verified grade-library TDS. Optional audience relaxes visibility for sellers.
   * Titles are synced to the grade/product display name.
   */
  async listForGrade(
    gradeId: string,
    options?: {
      audience?: 'customer' | 'seller';
      productDisplayName?: string | null;
    },
  ) {
    const audience = options?.audience ?? 'customer';
    const grade = await this.prisma.grade.findFirst({
      where: {
        id: gradeId,
        deletedAt: null,
        status: GradeStatus.ACTIVE,
        // Sellers already passed product ownership; do not hide library TDS
        // solely because sellerVisible is false on the master grade.
        ...(audience === 'customer' ? { customerVisible: true } : {}),
      },
      select: {
        id: true,
        code: true,
        name: true,
        displayName: true,
        fullGradeName: true,
        gradeNo: true,
        manufacturer: true,
      },
    });
    if (!grade) throw new NotFoundException('Grade not found');

    const displayTitle =
      options?.productDisplayName?.trim() || this.gradeDisplayName(grade);

    const docs = await this.prisma.gradeTdsDocument.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        gradeId,
        verificationStatus: { in: CUSTOMER_VISIBLE },
        storageKey: { not: null },
      },
      orderBy: [{ revision: 'desc' }, { approvedAt: 'desc' }, { createdAt: 'desc' }],
    });

    const items = docs.map((d) => this.mapCustomerDoc(d, displayTitle));

    const missing = await this.prisma.gradeTdsDocument.findFirst({
      where: {
        deletedAt: null,
        gradeId,
        verificationStatus: TdsVerificationStatus.MISSING,
      },
      select: { id: true, workbookNotes: true },
    });

    return {
      grade: {
        id: grade.id,
        code: grade.code,
        name: displayTitle,
        gradeNo: grade.gradeNo,
        manufacturer: grade.manufacturer,
      },
      available: items.length > 0,
      message:
        items.length > 0
          ? null
          : 'Technical Data Sheet is currently unavailable for this grade.',
      canRequest: audience === 'customer' && items.length === 0,
      items,
    };
  }

  /**
   * Product → grade library TDS. Same documents customers see on the grade page,
   * titled with the product/grade display name.
   */
  async listForProduct(
    productId: string,
    options?: { audience?: 'customer' | 'seller' },
  ) {
    const product = await this.prisma.product.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { id: productId },
          { code: { equals: productId, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        code: true,
        name: true,
        manufacturer: true,
        brand: true,
        gradeId: true,
        grade: {
          select: {
            id: true,
            code: true,
            name: true,
            displayName: true,
            fullGradeName: true,
            gradeNo: true,
            manufacturer: true,
          },
        },
      },
    });
    if (!product?.gradeId || !product.grade) {
      throw new NotFoundException('Product not found');
    }

    const productDisplayName =
      product.name?.trim() ||
      this.gradeDisplayName(product.grade);

    const tds = await this.listForGrade(product.gradeId, {
      audience: options?.audience ?? 'customer',
      productDisplayName,
    });

    return {
      ...tds,
      product: {
        id: product.id,
        code: product.code,
        name: productDisplayName,
        manufacturer:
          product.manufacturer ??
          product.brand ??
          product.grade.manufacturer ??
          null,
      },
    };
  }

  async getDownloadUrl(gradeId: string, documentId: string, userId: string) {
    if (!userId) throw new ForbiddenException('Authentication required');

    const doc = await this.prisma.gradeTdsDocument.findFirst({
      where: {
        id: documentId,
        gradeId,
        deletedAt: null,
        isActive: true,
        verificationStatus: TdsVerificationStatus.VERIFIED,
        storageKey: { not: null },
      },
    });
    if (!doc?.storageKey) throw new NotFoundException('Document not found');

    this.storage.assertConfigured();
    const url = await this.storage.getSignedUrl({
      key: doc.storageKey,
      operation: 'get',
      expiresInSeconds: 900,
    });

    return {
      url,
      fileName: doc.originalFilename ?? `${doc.gradeCode}_TDS.pdf`,
      mimeType: doc.mimeType,
      expiresInSeconds: 900,
    };
  }

  async createRequest(input: {
    userId: string;
    customerProfileId?: string | null;
    gradeId: string;
    message?: string;
  }) {
    const grade = await this.prisma.grade.findFirst({
      where: {
        id: input.gradeId,
        deletedAt: null,
        customerVisible: true,
      },
      select: { id: true, name: true, displayName: true, code: true },
    });
    if (!grade) throw new NotFoundException('Grade not found');

    const existingVerified = await this.prisma.gradeTdsDocument.count({
      where: {
        gradeId: grade.id,
        deletedAt: null,
        isActive: true,
        verificationStatus: TdsVerificationStatus.VERIFIED,
        storageKey: { not: null },
      },
    });
    if (existingVerified > 0) {
      throw new BadRequestException(
        'A verified TDS is already available for this grade',
      );
    }

    const open = await this.prisma.tdsRequest.findFirst({
      where: {
        userId: input.userId,
        gradeId: grade.id,
        status: { in: [TdsRequestStatus.OPEN, TdsRequestStatus.IN_PROGRESS] },
      },
    });
    if (open) {
      return {
        id: open.id,
        referenceNumber: open.referenceNumber,
        status: open.status,
        alreadyExists: true,
      };
    }

    const referenceNumber = `TDS-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;
    const created = await this.prisma.tdsRequest.create({
      data: {
        referenceNumber,
        userId: input.userId,
        customerProfileId: input.customerProfileId ?? null,
        gradeId: grade.id,
        message: input.message?.trim() || null,
        status: TdsRequestStatus.OPEN,
      },
    });

    return {
      id: created.id,
      referenceNumber: created.referenceNumber,
      status: created.status,
      alreadyExists: false,
      grade: {
        id: grade.id,
        code: grade.code,
        name: grade.displayName ?? grade.name,
      },
    };
  }

  async listCustomerRequests(userId: string, page = 1, limit = 20) {
    const { skip, take, page: p, limit: l } = skipTake(page, limit);
    const where = { userId };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.tdsRequest.count({ where }),
      this.prisma.tdsRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          grade: {
            select: { id: true, code: true, name: true, displayName: true },
          },
        },
      }),
    ]);
    return {
      items: items.map((r) => ({
        id: r.id,
        referenceNumber: r.referenceNumber,
        status: r.status,
        message: r.message,
        createdAt: r.createdAt.toISOString(),
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        grade: {
          id: r.grade.id,
          code: r.grade.code,
          name: r.grade.displayName ?? r.grade.name,
        },
      })),
      meta: { page: p, limit: l, total },
    };
  }

  // ─── Admin ───────────────────────────────────────────────────────────────

  async adminDashboard() {
    const [
      totalGrades,
      totalDocuments,
      verified,
      pending,
      missing,
      rejected,
      needsMapping,
      openRequests,
      batches,
    ] = await Promise.all([
      this.prisma.grade.count({ where: { deletedAt: null } }),
      this.prisma.gradeTdsDocument.count({
        where: { deletedAt: null, storageKey: { not: null } },
      }),
      this.prisma.gradeTdsDocument.count({
        where: {
          deletedAt: null,
          verificationStatus: TdsVerificationStatus.VERIFIED,
        },
      }),
      this.prisma.gradeTdsDocument.count({
        where: {
          deletedAt: null,
          verificationStatus: TdsVerificationStatus.PENDING_REVIEW,
        },
      }),
      this.prisma.gradeTdsDocument.count({
        where: {
          deletedAt: null,
          verificationStatus: TdsVerificationStatus.MISSING,
        },
      }),
      this.prisma.gradeTdsDocument.count({
        where: {
          deletedAt: null,
          verificationStatus: TdsVerificationStatus.REJECTED,
        },
      }),
      this.prisma.gradeTdsDocument.count({
        where: {
          deletedAt: null,
          verificationStatus: TdsVerificationStatus.NEEDS_MAPPING,
        },
      }),
      this.prisma.tdsRequest.count({
        where: {
          status: {
            in: [TdsRequestStatus.OPEN, TdsRequestStatus.IN_PROGRESS],
          },
        },
      }),
      this.prisma.tdsImportBatch.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    return {
      totalGrades,
      totalDocuments,
      verified,
      pendingReview: pending,
      missing,
      rejected,
      needsMapping,
      openRequests,
      recentImports: batches.map((b) => ({
        id: b.id,
        status: b.status,
        dryRun: b.dryRun,
        startedAt: b.startedAt.toISOString(),
        completedAt: b.completedAt?.toISOString() ?? null,
        stats: b.stats,
        errorMessage: b.errorMessage,
      })),
    };
  }

  async adminList(query: {
    page?: number;
    limit?: number;
    q?: string;
    category?: string;
    producer?: string;
    status?: TdsVerificationStatus;
    sourceKind?: TdsSourceKind;
  }) {
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const where: Record<string, unknown> = { deletedAt: null };
    if (query.status) where.verificationStatus = query.status;
    if (query.sourceKind) where.sourceKind = query.sourceKind;
    if (query.category) {
      where.categoryCode = { contains: query.category, mode: 'insensitive' };
    }
    if (query.producer) {
      where.producerName = { contains: query.producer, mode: 'insensitive' };
    }
    if (query.q) {
      where.OR = [
        { gradeCode: { contains: query.q, mode: 'insensitive' } },
        { producerName: { contains: query.q, mode: 'insensitive' } },
        { categoryCode: { contains: query.q, mode: 'insensitive' } },
        { documentTitle: { contains: query.q, mode: 'insensitive' } },
        { originalFilename: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.gradeTdsDocument.count({ where: where as never }),
      this.prisma.gradeTdsDocument.findMany({
        where: where as never,
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
        include: {
          grade: {
            select: {
              id: true,
              code: true,
              name: true,
              displayName: true,
              fullGradeName: true,
              gradeNo: true,
              manufacturer: true,
              products: {
                where: { deletedAt: null },
                take: 5,
                orderBy: { updatedAt: 'desc' },
                select: { id: true, name: true, code: true },
              },
            },
          },
        },
      }),
    ]);

    return {
      items: items.map((d) => {
        const linkedProducts = d.grade?.products ?? [];
        const primaryProductName = linkedProducts[0]?.name ?? null;
        const syncedTitle =
          primaryProductName ||
          (d.grade
            ? this.gradeDisplayName(d.grade)
            : d.documentTitle);
        return {
        id: d.id,
        gradeId: d.gradeId,
        grade: d.grade
          ? {
              id: d.grade.id,
              code: d.grade.code,
              name: d.grade.displayName ?? d.grade.name,
              manufacturer: d.grade.manufacturer,
              gradeNo: d.grade.gradeNo,
              fullGradeName: d.grade.fullGradeName,
            }
          : null,
        linkedProducts: linkedProducts.map((p) => ({
          id: p.id,
          name: p.name,
          code: p.code,
        })),
        productName: primaryProductName,
        categoryCode: d.categoryCode,
        gradeCode: d.gradeCode,
        producerName: d.producerName,
        documentTitle: syncedTitle,
        libraryTitle: d.documentTitle,
        documentType: d.documentType,
        originalFilename: d.originalFilename,
        mimeType: d.mimeType,
        fileSizeBytes:
          d.fileSizeBytes != null ? Number(d.fileSizeBytes) : null,
        checksum: d.checksum,
        sourceKind: d.sourceKind,
        sourceRaw: d.sourceRaw,
        sourceUrl: d.sourceUrl,
        sourceFilePath: d.sourceFilePath,
        workbookAvailability: d.workbookAvailability,
        workbookNotes: d.workbookNotes,
        verificationStatus: d.verificationStatus,
        reviewNotes: d.reviewNotes,
        revision: d.revision,
        isActive: d.isActive,
        mappingConfidence: d.mappingConfidence,
        hasFile: Boolean(d.storageKey),
        uploadedAt: d.uploadedAt?.toISOString() ?? null,
        approvedAt: d.approvedAt?.toISOString() ?? null,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      };
      }),
      meta: { page, limit, total },
    };
  }

  async adminGet(id: string) {
    const d = await this.prisma.gradeTdsDocument.findFirst({
      where: { id, deletedAt: null },
      include: {
        grade: {
          select: {
            id: true,
            code: true,
            name: true,
            displayName: true,
            manufacturer: true,
            gradeNo: true,
            gradeGroup: true,
          },
        },
      },
    });
    if (!d) throw new NotFoundException('TDS document not found');
    return d;
  }

  async adminPreviewUrl(id: string) {
    const d = await this.adminGet(id);
    if (!d.storageKey) throw new NotFoundException('No file stored');
    this.storage.assertConfigured();
    const url = await this.storage.getSignedUrl({
      key: d.storageKey,
      operation: 'get',
      expiresInSeconds: 900,
    });
    return {
      url,
      fileName: d.originalFilename,
      mimeType: d.mimeType,
    };
  }

  async adminApprove(id: string, adminUserId: string, notes?: string) {
    const d = await this.adminGet(id);
    if (!d.storageKey) {
      throw new BadRequestException('Cannot approve a document without a file');
    }
    if (!d.gradeId) {
      throw new BadRequestException(
        'Map this document to a grade before approving',
      );
    }
    const updated = await this.prisma.gradeTdsDocument.update({
      where: { id },
      data: {
        verificationStatus: TdsVerificationStatus.VERIFIED,
        approvedById: adminUserId,
        approvedAt: new Date(),
        reviewNotes: notes?.trim() || d.reviewNotes,
        isActive: true,
      },
    });

    await this.notifyOpenTdsRequests(d.gradeId, updated.id, d.gradeCode);
    return updated;
  }

  async adminReject(id: string, adminUserId: string, reason: string) {
    const d = await this.adminGet(id);
    return this.prisma.gradeTdsDocument.update({
      where: { id },
      data: {
        verificationStatus: TdsVerificationStatus.REJECTED,
        rejectedById: adminUserId,
        rejectedAt: new Date(),
        reviewNotes: reason?.trim() || d.reviewNotes,
      },
    });
  }

  async adminMapGrade(id: string, gradeId: string, notes?: string) {
    const d = await this.adminGet(id);
    const grade = await this.prisma.grade.findFirst({
      where: { id: gradeId, deletedAt: null },
      select: { id: true },
    });
    if (!grade) throw new NotFoundException('Grade not found');

    return this.prisma.gradeTdsDocument.update({
      where: { id },
      data: {
        gradeId: grade.id,
        mappingConfidence: 'manual',
        verificationStatus:
          d.verificationStatus === TdsVerificationStatus.NEEDS_MAPPING
            ? TdsVerificationStatus.PENDING_REVIEW
            : d.verificationStatus,
        reviewNotes: notes?.trim() || d.reviewNotes,
      },
    });
  }

  /**
   * Admin upload / replace TDS. Prefer productId so the document title
   * syncs to the marketplace product name and appears on customer/seller UIs
   * once verified (or immediately when approveNow=true).
   */
  async adminUploadReplace(input: {
    id?: string;
    gradeId?: string;
    productId?: string;
    fileName: string;
    mimeType: string;
    body: Buffer;
    adminUserId: string;
    producerName?: string;
    categoryCode?: string;
    gradeCode?: string;
    notes?: string;
    /** When true, publish to customers/sellers immediately after upload. */
    approveNow?: boolean;
  }) {
    this.storage.assertConfigured();
    const mime = input.mimeType || mimeFromFilename(input.fileName);
    if (!isAllowedTdsMime(mime)) {
      throw new BadRequestException('Only PDF and image TDS files are allowed');
    }
    const max = this.storage.getMaxDocumentSizeBytes();
    if (input.body.length > max) {
      throw new BadRequestException(`File exceeds max size (${max} bytes)`);
    }
    if (!input.productId && !input.gradeId && !input.id) {
      throw new BadRequestException('productId or gradeId is required');
    }

    let product: {
      id: string;
      name: string;
      code: string;
      manufacturer: string | null;
      brand: string | null;
      gradeId: string;
    } | null = null;

    let gradeId = input.gradeId ?? null;

    if (input.productId) {
      product = await this.prisma.product.findFirst({
        where: { id: input.productId, deletedAt: null },
        select: {
          id: true,
          name: true,
          code: true,
          manufacturer: true,
          brand: true,
          gradeId: true,
        },
      });
      if (!product?.gradeId) {
        throw new NotFoundException(
          'Product not found or is not linked to a grade',
        );
      }
      gradeId = product.gradeId;
    }

    if (input.id) {
      const existing = await this.adminGet(input.id);
      gradeId = gradeId ?? existing.gradeId;
      if (!gradeId) {
        throw new BadRequestException(
          'Map this document to a grade/product before replacing the file',
        );
      }
    }

    if (!gradeId) {
      throw new BadRequestException('gradeId is required');
    }

    const grade = await this.prisma.grade.findFirst({
      where: { id: gradeId, deletedAt: null },
      select: {
        id: true,
        gradeNo: true,
        name: true,
        displayName: true,
        fullGradeName: true,
        manufacturer: true,
        gradeGroup: true,
        category: { select: { code: true } },
      },
    });
    if (!grade) throw new NotFoundException('Grade not found');

    const checksum = createHash('sha256').update(input.body).digest('hex');
    const categoryCode =
      input.categoryCode ||
      grade.gradeGroup ||
      grade.category.code ||
      'UNKNOWN';
    const gradeCode = input.gradeCode || grade.gradeNo || grade.name;
    const producerName =
      input.producerName ||
      product?.manufacturer ||
      product?.brand ||
      grade.manufacturer ||
      'UNKNOWN';

    const documentTitle =
      product?.name?.trim() ||
      this.gradeDisplayName(grade);

    const revision = input.id
      ? ((
          await this.prisma.gradeTdsDocument.findUnique({
            where: { id: input.id },
          })
        )?.revision ?? 0) + 1
      : 1;

    const storageKey = buildGradeTdsObjectKey({
      category: categoryCode,
      grade: gradeCode,
      producer: producerName,
      revision,
      filename: sanitizeObjectSegment(input.fileName, 'document.pdf'),
    });

    await this.storage.upload({
      key: storageKey,
      body: input.body,
      contentType: mime,
      metadata: {
        checksum,
        ...(product ? { productId: product.id } : {}),
      },
    });

    const approveNow = Boolean(input.approveNow);
    const verificationStatus = approveNow
      ? TdsVerificationStatus.VERIFIED
      : TdsVerificationStatus.PENDING_REVIEW;

    const reviewNotes = [
      input.notes?.trim(),
      product
        ? `Uploaded for product ${product.name} (${product.code})`
        : null,
      approveNow ? 'Auto-approved on admin upload' : null,
    ]
      .filter(Boolean)
      .join(' | ');

    if (input.id) {
      const existing = await this.adminGet(input.id);
      const updated = await this.prisma.gradeTdsDocument.update({
        where: { id: input.id },
        data: {
          gradeId: grade.id,
          storageKey,
          originalFilename: input.fileName,
          mimeType: mime,
          fileSizeBytes: BigInt(input.body.length),
          checksum,
          revision,
          documentTitle,
          producerName,
          categoryCode,
          gradeCode,
          uploadedAt: new Date(),
          uploadedById: input.adminUserId,
          verificationStatus,
          approvedById: approveNow ? input.adminUserId : existing.approvedById,
          approvedAt: approveNow ? new Date() : existing.approvedAt,
          reviewNotes: reviewNotes || existing.reviewNotes,
          mappingConfidence: 'manual',
          isActive: true,
          sourceKind: TdsSourceKind.OTHER,
          sourceRaw: product
            ? `admin-upload:product:${product.id}`
            : 'admin-upload',
        },
      });
      if (approveNow) {
        await this.notifyOpenTdsRequests(grade.id, updated.id, gradeCode);
      }
      return this.adminGet(updated.id);
    }

    const importKey = buildImportKey({
      category: categoryCode,
      grade: gradeCode,
      producer: producerName,
      filePath: product
        ? `admin-upload:product:${product.id}:${checksum.slice(0, 16)}`
        : `admin-upload:${checksum.slice(0, 16)}`,
    });

    const existingByKey = await this.prisma.gradeTdsDocument.findUnique({
      where: { importKey },
    });
    if (existingByKey) {
      throw new BadRequestException(
        'An identical admin upload already exists for this product/file',
      );
    }

    const created = await this.prisma.gradeTdsDocument.create({
      data: {
        importKey,
        gradeId: grade.id,
        categoryCode,
        gradeCode,
        producerName,
        documentTitle,
        documentType: 'TDS',
        originalFilename: input.fileName,
        storageKey,
        mimeType: mime,
        fileSizeBytes: BigInt(input.body.length),
        checksum,
        sourceKind: TdsSourceKind.OTHER,
        sourceRaw: product
          ? `admin-upload:product:${product.id}`
          : 'admin-upload',
        verificationStatus,
        revision,
        isActive: true,
        mappingConfidence: 'manual',
        uploadedAt: new Date(),
        uploadedById: input.adminUserId,
        approvedById: approveNow ? input.adminUserId : null,
        approvedAt: approveNow ? new Date() : null,
        reviewNotes: reviewNotes || null,
      },
    });

    if (approveNow) {
      await this.notifyOpenTdsRequests(grade.id, created.id, gradeCode);
    }

    return this.adminGet(created.id);
  }

  private async notifyOpenTdsRequests(
    gradeId: string,
    documentId: string,
    gradeCode: string,
  ): Promise<number> {
    const openReqs = await this.prisma.tdsRequest.findMany({
      where: {
        gradeId,
        status: { in: [TdsRequestStatus.OPEN, TdsRequestStatus.IN_PROGRESS] },
      },
    });
    for (const req of openReqs) {
      await this.prisma.tdsRequest.update({
        where: { id: req.id },
        data: {
          status: TdsRequestStatus.FULFILLED,
          fulfilledDocumentId: documentId,
          resolvedAt: new Date(),
        },
      });
      try {
        await this.notifications.create({
          userId: req.userId,
          title: 'TDS now available',
          body: `Technical Data Sheet for ${gradeCode} is now available.`,
          entityType: EntityOwnerType.GRADE,
          entityId: gradeId,
          metadata: {
            tdsRequestId: req.id,
            documentId,
            referenceNumber: req.referenceNumber,
          },
        });
      } catch {
        /* non-fatal */
      }
    }
    return openReqs.length;
  }

  async adminListRequests(query: {
    page?: number;
    limit?: number;
    status?: TdsRequestStatus;
  }) {
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    const [total, items] = await this.prisma.$transaction([
      this.prisma.tdsRequest.count({ where: where as never }),
      this.prisma.tdsRequest.findMany({
        where: where as never,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          grade: {
            select: { id: true, code: true, name: true, displayName: true },
          },
        },
      }),
    ]);
    return {
      items,
      meta: { page, limit, total },
    };
  }

  async adminUpdateRequest(
    id: string,
    data: {
      status?: TdsRequestStatus;
      adminNotes?: string;
      assignedToUserId?: string;
      fulfilledDocumentId?: string;
    },
  ) {
    const req = await this.prisma.tdsRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('TDS request not found');
    return this.prisma.tdsRequest.update({
      where: { id },
      data: {
        status: data.status,
        adminNotes: data.adminNotes,
        assignedToUserId: data.assignedToUserId,
        fulfilledDocumentId: data.fulfilledDocumentId,
        resolvedAt:
          data.status === TdsRequestStatus.FULFILLED ||
          data.status === TdsRequestStatus.CLOSED ||
          data.status === TdsRequestStatus.REJECTED
            ? new Date()
            : undefined,
      },
    });
  }

  /**
   * Production reconcile: scan R2 `tds/` objects and upsert grade_tds_documents.
   * Files already in storage (e.g. prior import without DB rows) become visible
   * to Customer App / WebApp / Seller once mapped + verified.
   */
  async adminReconcileFromStorage(input?: {
    adminUserId?: string;
    /** When true (default), matched grades are published immediately. */
    autoVerify?: boolean;
    prefix?: string;
  }) {
    this.storage.assertConfigured();
    const autoVerify = input?.autoVerify !== false;
    const prefix = (input?.prefix?.trim() || 'tds/').replace(/^\/*/, '');
    const listed = await this.storage.listAllObjects(prefix.endsWith('/') ? prefix : `${prefix}/`);
    const index = await loadGradeMatchIndex(this.prisma);

    const stats = {
      scanned: 0,
      skipped: 0,
      created: 0,
      updated: 0,
      verified: 0,
      needsMapping: 0,
      fulfilledRequests: 0,
      sample: [] as string[],
    };

    const pushSample = (line: string) => {
      if (stats.sample.length < 25) stats.sample.push(line);
    };

    for (const obj of listed) {
      const parsed = parseGradeTdsObjectKey(obj.key);
      if (!parsed) {
        stats.skipped += 1;
        continue;
      }
      const mime = mimeFromFilename(parsed.filename);
      if (!isAllowedTdsMime(mime)) {
        stats.skipped += 1;
        continue;
      }
      stats.scanned += 1;

      const head = await this.storage.headObject(obj.key);
      const metaImportKey = head?.metadata?.importkey?.trim() || null;
      const checksum = head?.metadata?.checksum?.trim() || null;
      const importKey =
        metaImportKey ||
        buildImportKey({
          category: parsed.category,
          grade: parsed.grade,
          producer: parsed.producer,
          filePath: obj.key,
        });

      const match = matchGradeFromIndex(index, {
        category: parsed.category.replace(/_/g, ' '),
        grade: parsed.grade,
        producer: parsed.producer,
      });

      const gradeMatched = Boolean(match.gradeId);
      const ambiguous = match.confidence === 'ambiguous';
      let verificationStatus: TdsVerificationStatus =
        !gradeMatched || ambiguous
          ? TdsVerificationStatus.NEEDS_MAPPING
          : autoVerify
            ? TdsVerificationStatus.VERIFIED
            : TdsVerificationStatus.PENDING_REVIEW;

      const existing =
        (await this.prisma.gradeTdsDocument.findUnique({
          where: { importKey },
        })) ??
        (await this.prisma.gradeTdsDocument.findFirst({
          where: { storageKey: obj.key, deletedAt: null },
        }));

      const documentTitle = `${parsed.category.replace(/_/g, ' ')} ${parsed.grade} – ${parsed.producer}`.trim();
      const fileSizeBytes =
        head?.size != null
          ? BigInt(head.size)
          : obj.size != null
            ? BigInt(obj.size)
            : null;

      if (existing) {
        const shouldPromote =
          autoVerify &&
          gradeMatched &&
          !ambiguous &&
          existing.verificationStatus !== TdsVerificationStatus.VERIFIED &&
          existing.verificationStatus !== TdsVerificationStatus.REJECTED;

        const updated = await this.prisma.gradeTdsDocument.update({
          where: { id: existing.id },
          data: {
            storageKey: obj.key,
            originalFilename: parsed.filename,
            mimeType: mime,
            fileSizeBytes: fileSizeBytes ?? existing.fileSizeBytes,
            checksum: checksum ?? existing.checksum,
            categoryCode: parsed.category,
            gradeCode: parsed.grade,
            producerName: parsed.producer,
            revision: Math.max(existing.revision, parsed.revision),
            gradeId: match.gradeId ?? existing.gradeId,
            mappingConfidence: match.confidence,
            isActive: true,
            deletedAt: null,
            ...(shouldPromote
              ? {
                  verificationStatus: TdsVerificationStatus.VERIFIED,
                  approvedAt: existing.approvedAt ?? new Date(),
                  approvedById: existing.approvedById ?? input?.adminUserId ?? null,
                  reviewNotes: [
                    existing.reviewNotes,
                    'Auto-verified from R2 storage sync',
                  ]
                    .filter(Boolean)
                    .join(' | '),
                }
              : existing.gradeId || !match.gradeId
                ? {}
                : {
                    verificationStatus,
                    reviewNotes: [
                      existing.reviewNotes,
                      `Storage sync: ${match.reason}`,
                    ]
                      .filter(Boolean)
                      .join(' | '),
                  }),
          },
        });
        stats.updated += 1;
        if (
          updated.verificationStatus === TdsVerificationStatus.VERIFIED &&
          updated.gradeId
        ) {
          stats.verified += 1;
          const fulfilled = await this.notifyOpenTdsRequests(
            updated.gradeId,
            updated.id,
            updated.gradeCode,
          );
          stats.fulfilledRequests += fulfilled;
        } else if (
          updated.verificationStatus === TdsVerificationStatus.NEEDS_MAPPING
        ) {
          stats.needsMapping += 1;
        }
        pushSample(
          `${obj.key} → updated (${updated.verificationStatus}, grade=${updated.gradeId ?? 'none'})`,
        );
        continue;
      }

      const created = await this.prisma.gradeTdsDocument.create({
        data: {
          importKey,
          gradeId: match.gradeId,
          categoryCode: parsed.category,
          gradeCode: parsed.grade,
          producerName: parsed.producer,
          documentTitle,
          documentType: 'TDS',
          originalFilename: parsed.filename,
          storageKey: obj.key,
          mimeType: mime,
          fileSizeBytes,
          checksum,
          sourceKind: TdsSourceKind.OTHER,
          sourceRaw: 'r2-storage-sync',
          sourceFilePath: obj.key,
          verificationStatus,
          mappingConfidence: match.confidence,
          revision: parsed.revision,
          isActive: true,
          uploadedAt: obj.lastModified ?? new Date(),
          uploadedById: input?.adminUserId ?? null,
          approvedAt:
            verificationStatus === TdsVerificationStatus.VERIFIED
              ? new Date()
              : null,
          approvedById:
            verificationStatus === TdsVerificationStatus.VERIFIED
              ? input?.adminUserId ?? null
              : null,
          reviewNotes: `Synced from R2 storage | ${match.reason}`,
        },
      });
      stats.created += 1;
      if (
        created.verificationStatus === TdsVerificationStatus.VERIFIED &&
        created.gradeId
      ) {
        stats.verified += 1;
        const fulfilled = await this.notifyOpenTdsRequests(
          created.gradeId,
          created.id,
          created.gradeCode,
        );
        stats.fulfilledRequests += fulfilled;
      } else if (
        created.verificationStatus === TdsVerificationStatus.NEEDS_MAPPING
      ) {
        stats.needsMapping += 1;
      }
      pushSample(
        `${obj.key} → created (${created.verificationStatus}, grade=${created.gradeId ?? 'none'})`,
      );
    }

    return {
      prefix,
      autoVerify,
      ...stats,
    };
  }
}
