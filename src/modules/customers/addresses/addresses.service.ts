import { Injectable } from '@nestjs/common';
import { AddressType } from '../../../generated/prisma/client.js';
import { AddressBookService } from '../../organizations/addresses/address-book.service.js';
import { CustomerContextService } from '../common/customer-context.service.js';
import type {
  CreateCustomerAddressDto,
  UpdateCustomerAddressDto,
} from './addresses.dto.js';
import type { CustomerAddressDto } from './addresses.mapper.js';

/** Customer delivery addresses — scoped to the authenticated customer's organization. */
@Injectable()
export class CustomerAddressesService {
  constructor(
    private readonly addressBook: AddressBookService,
    private readonly customerContext: CustomerContextService,
  ) {}

  private async orgId(userId: string): Promise<string> {
    const ctx = await this.customerContext.requireCustomer(userId);
    return ctx.organizationId;
  }

  async list(userId: string): Promise<CustomerAddressDto[]> {
    return this.addressBook.list(await this.orgId(userId));
  }

  async get(userId: string, id: string): Promise<CustomerAddressDto> {
    return this.addressBook.get(await this.orgId(userId), id);
  }

  async create(
    userId: string,
    dto: CreateCustomerAddressDto,
  ): Promise<CustomerAddressDto> {
    return this.addressBook.create(await this.orgId(userId), dto, {
      type: AddressType.SHIPPING,
    });
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateCustomerAddressDto,
  ): Promise<CustomerAddressDto> {
    return this.addressBook.update(await this.orgId(userId), id, dto);
  }

  async remove(userId: string, id: string): Promise<{ id: string }> {
    return this.addressBook.remove(await this.orgId(userId), id);
  }

  async setDefault(userId: string, id: string): Promise<CustomerAddressDto> {
    return this.addressBook.setDefault(await this.orgId(userId), id);
  }
}
