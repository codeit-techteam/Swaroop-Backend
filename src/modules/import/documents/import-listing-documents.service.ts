import { Injectable } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsString, MaxLength, Min } from 'class-validator';
import {
  DocumentCategory,
  EntityOwnerType,
  ImportListingStatus,
  ImportSide,
  ImportNegotiationStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import { buildCollisionSafeLeaf } from '../../documents/common/document-keys.js';
import { DocumentsCoreService } from '../../documents/services/documents-core.service.js';
import {
  ImportActorService,
  type ImportActor,
} from '../common/import-actor.service.js';
import {
  IMPORT_AUDIT_ACTIONS,
  ImportAuditService,
} from '../common/import-audit.service.js';
import { ImportException } from '../domain/import.errors.js';

export const IMPORT_DOCUMENT_CATEGORIES = [
  DocumentCategory.COA,
  DocumentCategory.TDS,
  DocumentCategory.SDS,
  DocumentCategory.MSDS,
  DocumentCategory.CERTIFICATE_OF_ORIGIN,
  DocumentCategory.COMMERCIAL_INVOICE,
  DocumentCategory.PACKING_LIST,
  DocumentCategory.BILL_OF_LADING,
  DocumentCategory.INSPECTION_CERTIFICATE,
  DocumentCategory.INSURANCE_CERTIFICATE,
  DocumentCategory.PRODUCT_SPECIFICATION,
  DocumentCategory.OTHER,
] as const;

export class CreateImportDocumentDto {
  @ApiProperty({ enum: IMPORT_DOCUMENT_CATEGORIES })
  @IsIn(IMPORT_DOCUMENT_CATEGORIES)
  category!: DocumentCategory;

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({ example: 'application/pdf' })
  @IsString()
  @MaxLength(120)
  mimeType!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fileSizeBytes!: number;
}

const TERMINAL: ImportListingStatus[] = [
  ImportListingStatus.CANCELLED,
  ImportListingStatus.EXPIRED,
  ImportListingStatus.FULFILLED,
];

/**
 * Listing attachments (COA, TDS, certificates) stored through the shared R2
 * document service under `import-listings/{listingId}/...`. Owners manage them;
 * counterparties can read them only once they are negotiating on the listing.
 */
@Injectable()
export class ImportListingDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actors: ImportActorService,
    private readonly documents: DocumentsCoreService,
    private readonly audit: ImportAuditService,
  ) {}

  private ownerOrgFor(actor: ImportActor, side: ImportSide) {
    return side === ImportSide.BUY
      ? actor.buyer?.organizationId
      : actor.seller?.organizationId;
  }

  private async access(actor: ImportActor, listingId: string) {
    const listing = await this.prisma.importListing.findFirst({
      where: { id: listingId, deletedAt: null },
      select: {
        id: true,
        side: true,
        status: true,
        ownerOrgId: true,
        referenceNumber: true,
      },
    });
    if (!listing) throw new ImportException('IMPORT_NOT_FOUND');
    if (this.ownerOrgFor(actor, listing.side) === listing.ownerOrgId) {
      return { listing, isOwner: true };
    }
    const viewerOrg =
      listing.side === ImportSide.BUY
        ? actor.seller?.organizationId
        : actor.buyer?.organizationId;
    if (viewerOrg) {
      const negotiating = await this.prisma.importNegotiation.findFirst({
        where: {
          status: {
            in: [ImportNegotiationStatus.OPEN, ImportNegotiationStatus.AGREED],
          },
          ...(listing.side === ImportSide.BUY
            ? { buyListingId: listing.id, sellerOrgId: viewerOrg }
            : { sellListingId: listing.id, buyerOrgId: viewerOrg }),
        },
        select: { id: true },
      });
      if (negotiating) return { listing, isOwner: false };
    }
    throw new ImportException('IMPORT_NOT_FOUND');
  }

  private ownership(listingId: string) {
    return { ownerType: EntityOwnerType.IMPORT_LISTING, ownerId: listingId };
  }

  async list(user: AuthenticatedUser, listingId: string) {
    const actor = await this.actors.resolve(user);
    await this.access(actor, listingId);
    const docs = await this.prisma.document.findMany({
      where: {
        ownerType: EntityOwnerType.IMPORT_LISTING,
        ownerId: listingId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    // Uploader identity is not exposed; counterparties only see file facts.
    return docs.map((d) => {
      const {
        uploadedById: _u,
        organizationId: _o,
        ...rest
      } = this.documents.mapDocument(d);
      return rest;
    });
  }

  async create(
    user: AuthenticatedUser,
    listingId: string,
    dto: CreateImportDocumentDto,
  ) {
    const actor = await this.actors.resolve(user);
    const { listing, isOwner } = await this.access(actor, listingId);
    if (!isOwner) throw new ImportException('IMPORT_UNAUTHORIZED');
    if (TERMINAL.includes(listing.status)) {
      throw new ImportException(
        'IMPORT_INVALID_STATUS_TRANSITION',
        'Documents cannot be added to a closed listing.',
      );
    }
    const leaf = buildCollisionSafeLeaf(dto.fileName);
    const doc = await this.documents.create({
      organizationId: listing.ownerOrgId,
      uploadedById: actor.userId,
      ownerType: EntityOwnerType.IMPORT_LISTING,
      ownerId: listing.id,
      category: dto.category,
      fileName: dto.fileName,
      mimeType: dto.mimeType,
      fileSizeBytes: dto.fileSizeBytes,
      storageKey: `import-listings/${listing.id}/${dto.category.toLowerCase()}/${leaf}`,
      metadata: { module: 'IMPORT', listingReference: listing.referenceNumber },
      requireUploadUrl: true,
    });
    await this.audit.log({
      action: IMPORT_AUDIT_ACTIONS.DOCUMENT_UPLOADED,
      actorUserId: actor.userId,
      actorRole: this.actors.actorRole(actor, listing.side),
      organizationId: listing.ownerOrgId,
      entityType: EntityOwnerType.IMPORT_LISTING,
      entityId: listing.id,
      newData: {
        documentId: doc.id,
        category: dto.category,
        fileName: dto.fileName,
      },
      metadata: { referenceNumber: listing.referenceNumber },
    });
    return doc;
  }

  /** Called after the browser PUT to R2 finishes; verifies the object exists. */
  async confirm(
    user: AuthenticatedUser,
    listingId: string,
    documentId: string,
  ) {
    const actor = await this.actors.resolve(user);
    const { isOwner } = await this.access(actor, listingId);
    if (!isOwner) throw new ImportException('IMPORT_UNAUTHORIZED');
    return this.documents.submitForReview(
      documentId,
      this.ownership(listingId),
    );
  }

  async download(
    user: AuthenticatedUser,
    listingId: string,
    documentId: string,
    disposition?: 'inline' | 'attachment',
  ) {
    const actor = await this.actors.resolve(user);
    await this.access(actor, listingId);
    return this.documents.download(documentId, this.ownership(listingId), {
      disposition: disposition ?? 'inline',
      verifyExists: true,
    });
  }

  async remove(user: AuthenticatedUser, listingId: string, documentId: string) {
    const actor = await this.actors.resolve(user);
    const { listing, isOwner } = await this.access(actor, listingId);
    if (!isOwner) throw new ImportException('IMPORT_UNAUTHORIZED');
    const result = await this.documents.softDelete(
      documentId,
      this.ownership(listingId),
    );
    await this.audit.log({
      action: IMPORT_AUDIT_ACTIONS.DOCUMENT_DELETED,
      actorUserId: actor.userId,
      actorRole: this.actors.actorRole(actor, listing.side),
      organizationId: listing.ownerOrgId,
      entityType: EntityOwnerType.IMPORT_LISTING,
      entityId: listing.id,
      previousData: { documentId },
      metadata: { referenceNumber: listing.referenceNumber },
    });
    return result;
  }
}
