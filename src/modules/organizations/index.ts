export { OrganizationsModule } from './organizations.module.js';
export { AddressBookService } from './addresses/address-book.service.js';
export {
  CreateAddressBookEntryDto,
  UpdateAddressBookEntryDto,
  INDIAN_PINCODE_REGEX,
} from './addresses/address-book.dto.js';
export { AddressException } from './addresses/address-book.errors.js';
export {
  buildAddressSnapshot,
  type AddressBookEntryDto,
  type AddressSnapshot,
} from './addresses/address-book.mapper.js';
