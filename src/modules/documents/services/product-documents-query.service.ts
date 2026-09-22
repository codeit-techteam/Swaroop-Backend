import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DocumentCategory,
  DocumentStatus,
  EntityOwnerType,
  ProductStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { StorageService } from '../../../storage/storage.service.js';
import {
  CUSTOMER_VISIBLE_DOCUMENT_STATUSES,
  customerDocumentStatusLabel,
  customerDocumentTitle,
  customerSafeFileName,
} from '../common/product-document.helpers.js';

/**
 * Customer-safe product document queries (blind marketplace).
 * Shared by seller + customer modules — never returns seller identity.
 */
@Injectable()
export class ProductDocumentsQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  mapCustomerDoc(doc: {
    id: string;
    category: DocumentCategory;
    mimeType: string | null;
    fileSizeBytes: bigint | null;
    status: DocumentStatus;
    version: number;
    metadata: unknown;
  }) {
    const meta = (doc.metadata ?? {}) as Record<string, unknown>;
    const title = customerDocumentTitle(
      doc.category,
      typeof meta.title === 'string' ? meta.title : null,
    );
    return {
      id: doc.id,
      type: doc.category,
      title,
      description: 'Verified Product Document',
      version: doc.version,
      status: customerDocumentStatusLabel(doc.status),
      available: true,
      mimeType: doc.mimeType,
      fileSizeBytes: doc.fileSizeBytes?.toString() ?? null,
      fileName: customerSafeFileName(doc.category, doc.version, doc.mimeType),
    };
  }

  async listCustomerVisible(productId: string, offerId?: string | null) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        deletedAt: null,
        status: ProductStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('PRODUCT_NOT_FOUND');

    const items = await this.prisma.document.findMany({
      where: {
        deletedAt: null,
        ownerType: EntityOwnerType.PRODUCT,
        ownerId: productId,
        status: {
          in: [DocumentStatus.VERIFIED, DocumentStatus.UPLOADED],
        },
      },
      orderBy: [{ category: 'asc' }, { version: 'desc' }],
    });

    const filtered = items.filter((doc) => {
      if (!CUSTOMER_VISIBLE_DOCUMENT_STATUSES.has(doc.status)) return false;
      const meta = (doc.metadata ?? {}) as Record<string, unknown>;
      if (meta.customerVisible === false) return false;
      if (typeof meta.offerId === 'string') {
        if (!offerId || meta.offerId !== offerId) return false;
      }
      return true;
    });

    const latestByKey = new Map<string, (typeof filtered)[number]>();
    for (const doc of filtered) {
      const meta = (doc.metadata ?? {}) as Record<string, unknown>;
      const key = `${doc.category}:${typeof meta.offerId === 'string' ? meta.offerId : 'product'}`;
      const existing = latestByKey.get(key);
      if (!existing || doc.version > existing.version) {
        latestByKey.set(key, doc);
      }
    }

    return [...latestByKey.values()].map((doc) => this.mapCustomerDoc(doc));
  }

  async customerDownloadUrl(productId: string, documentId: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        deletedAt: null,
        status: ProductStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('PRODUCT_NOT_FOUND');

    const doc = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        deletedAt: null,
        ownerType: EntityOwnerType.PRODUCT,
        ownerId: productId,
      },
    });
    if (!doc) throw new NotFoundException('DOCUMENT_NOT_FOUND');

    const meta = (doc.metadata ?? {}) as Record<string, unknown>;
    if (meta.customerVisible === false) {
      throw new ForbiddenException('DOCUMENT_ACCESS_DENIED');
    }
    if (
      doc.status !== DocumentStatus.VERIFIED &&
      doc.status !== DocumentStatus.UPLOADED
    ) {
      throw new ForbiddenException('DOCUMENT_NOT_APPROVED');
    }

    const url = await this.storage.getSignedUrl({
      key: doc.storageKey,
      operation: 'get',
      expiresInSeconds: 900,
    });

    return {
      id: doc.id,
      url,
      expiresInSeconds: 900,
      fileName: customerSafeFileName(doc.category, doc.version, doc.mimeType),
      mimeType: doc.mimeType,
      title: customerDocumentTitle(
        doc.category,
        typeof meta.title === 'string' ? meta.title : null,
      ),
    };
  }
}
