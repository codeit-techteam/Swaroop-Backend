import { PartialType } from '@nestjs/swagger';
import { CreateAddressBookEntryDto } from '../../organizations/addresses/address-book.dto.js';

export { INDIAN_PINCODE_REGEX } from '../../organizations/addresses/address-book.dto.js';

export class CreateCustomerAddressDto extends CreateAddressBookEntryDto {}

export class UpdateCustomerAddressDto extends PartialType(
  CreateCustomerAddressDto,
) {}
