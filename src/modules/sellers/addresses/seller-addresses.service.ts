import { Injectable } from '@nestjs/common';
import { AddressType } from '../../../generated/prisma/client.js';
import type {
  AddressBookEntryDto,
  CreateAddressBookEntryDto,
  UpdateAddressBookEntryDto,
} from '../../organizations/index.js';
import { AddressBookService } from '../../organizations/index.js';
import { SellerAuditService } from '../common/seller-audit.service.js';
import { SellerContextService } from '../common/seller-context.service.js';

/**
 * Seller pickup / warehouse / dispatch-origin addresses. Same org-scoped
 * address book as customers — ownership always comes from the JWT user.
 */
@Injectable()
export class SellerAddressesService {
  constructor(
    private readonly addressBook: AddressBookService,
    private readonly sellerContext: SellerContextService,
    private readonly audit: SellerAuditService,
  ) {}

  private async orgId(userId: string): Promise<string> {
    const ctx = await this.sellerContext.requireSeller(userId);
    return ctx.organizationId;
  }

  async list(userId: string): Promise<AddressBookEntryDto[]> {
    return this.addressBook.list(await this.orgId(userId));
  }

  async get(userId: string, id: string): Promise<AddressBookEntryDto> {
    return this.addressBook.get(await this.orgId(userId), id);
  }

  async create(
    userId: string,
    dto: CreateAddressBookEntryDto,
  ): Promise<AddressBookEntryDto> {
    const organizationId = await this.orgId(userId);
    const created = await this.addressBook.create(organizationId, dto, {
      type: AddressType.WAREHOUSE,
    });
    await this.audit.log({
      action: 'SELLER_ADDRESS_SAVED',
      actorUserId: userId,
      organizationId,
      entityId: created.id,
      newData: { city: created.city, postalCode: created.postalCode },
    });
    return created;
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateAddressBookEntryDto,
  ): Promise<AddressBookEntryDto> {
    return this.addressBook.update(await this.orgId(userId), id, dto);
  }

  async remove(userId: string, id: string): Promise<{ id: string }> {
    return this.addressBook.remove(await this.orgId(userId), id);
  }

  async setDefault(userId: string, id: string): Promise<AddressBookEntryDto> {
    return this.addressBook.setDefault(await this.orgId(userId), id);
  }
}
