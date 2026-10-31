import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateAddressBookEntryDto } from './address-book.dto.js';

const base = {
  line1: 'Plot 12, MIDC Industrial Area',
  city: 'Mumbai',
  state: 'Maharashtra',
  postalCode: '400093',
};

const errorsFor = (overrides: Record<string, unknown>) =>
  validateSync(
    plainToInstance(CreateAddressBookEntryDto, { ...base, ...overrides }),
  ).map((e) => e.property);

describe('CreateAddressBookEntryDto place validation', () => {
  it('accepts a normal address', () => {
    expect(errorsFor({})).toEqual([]);
  });

  it.each(['Navi Mumbai', "St. John's Wood", 'Bengaluru (Urban)', 'Dadra & Nagar Haveli'])(
    'accepts city %s',
    (city) => {
      expect(errorsFor({ city })).toEqual([]);
    },
  );

  it.each(['12345', 'A', '<script>', 'Mumbai 400093', ''])(
    'rejects city %j',
    (city) => {
      expect(errorsFor({ city })).toContain('city');
    },
  );

  it('rejects numeric state', () => {
    expect(errorsFor({ state: '27' })).toContain('state');
  });

  it.each(['012345', '4000', '40009A', '4000930'])(
    'rejects pincode %s',
    (postalCode) => {
      expect(errorsFor({ postalCode })).toContain('postalCode');
    },
  );
});
