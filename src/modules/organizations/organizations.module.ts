import { Module } from '@nestjs/common';
import { AddressBookService } from './addresses/address-book.service.js';

/**
 * Organization domain boundary. Hosts the org-scoped address book shared by
 * Customer and Seller organizations.
 */
@Module({
  providers: [AddressBookService],
  exports: [AddressBookService],
})
export class OrganizationsModule {}
