import {
  ImportQuantityUnit,
  ImportShipmentType,
  ImportSide,
  type ImportListing,
} from '../../../generated/prisma/client.js';
import type { ImportFieldError } from './import.errors.js';

export type ListingValidationInput = Pick<
  ImportListing,
  | 'side'
  | 'categoryId'
  | 'gradeId'
  | 'customGradeName'
  | 'brandId'
  | 'originCountryId'
  | 'quantity'
  | 'quantityUnit'
  | 'hsCode'
  | 'casNumber'
  | 'price'
  | 'priceUnit'
  | 'priceType'
  | 'incotermId'
  | 'priceBasisPortId'
  | 'priceBasisLocation'
  | 'paymentTermId'
  | 'gstTreatment'
  | 'polId'
  | 'podId'
  | 'esd'
  | 'lsd'
  | 'transitMinDays'
  | 'transitMaxDays'
  | 'shipmentType'
  | 'containerSize'
  | 'containerCount'
  | 'acceptableQuantityMin'
  | 'acceptableQuantityMax'
  | 'requiredDeliveryDate'
  | 'moq'
  | 'maximumQuantity'
  | 'readyStockType'
  | 'validFrom'
  | 'validUntil'
> & {
  currencyCode: string | null;
  /** Currencies the chosen payment term supports ([] = all). null = no term selected. */
  paymentTermCurrencyCodes: string[] | null;
};

export type ValidationContext = {
  mode: 'draft' | 'publish';
  now: Date;
  allowCustomGrade: boolean;
};

const MAX_TRANSIT_DAYS = 365;

export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function normalizeHsCode(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const digits = value.replace(/[\s.-]/g, '');
  return digits.length ? digits : null;
}

/** CAS Registry Number: NNNNNNN-NN-N with a mod-10 check digit. */
export function isValidCasNumber(value: string): boolean {
  const match = /^(\d{2,7})-(\d{2})-(\d)$/.exec(value.trim());
  if (!match) return false;
  const digits = (match[1] + match[2]).split('').reverse();
  const sum = digits.reduce((acc, d, i) => acc + Number(d) * (i + 1), 0);
  return sum % 10 === Number(match[3]);
}

/**
 * Business validation shared by draft saves and publish. Drafts only check the
 * values that are present; publish also requires every mandatory field.
 * Master-data existence/activeness is checked by the service before this runs.
 */
export function validateListing(
  input: ListingValidationInput,
  ctx: ValidationContext,
): ImportFieldError[] {
  const errors: ImportFieldError[] = [];
  const publish = ctx.mode === 'publish';
  const isBuy = input.side === ImportSide.BUY;
  const today = startOfUtcDay(ctx.now);

  const required = (field: string, present: unknown, label: string) => {
    if (
      publish &&
      (present === null || present === undefined || present === '')
    ) {
      errors.push({
        field,
        code: 'REQUIRED',
        message: `${label} is required.`,
      });
    }
  };

  // Product
  required('categoryId', input.categoryId, 'Product / material');
  if (publish && !input.gradeId) {
    if (!input.customGradeName?.trim()) {
      errors.push({
        field: 'gradeId',
        code: 'REQUIRED',
        message: 'Grade is required.',
      });
    } else if (!ctx.allowCustomGrade) {
      errors.push({
        field: 'customGradeName',
        code: 'INVALID_MASTER_REFERENCE',
        message: 'Custom grades are not allowed. Select a grade from the list.',
      });
    }
  }
  required('brandId', input.brandId, 'Brand / manufacturer');
  required('originCountryId', input.originCountryId, 'Country of origin');

  required('quantity', input.quantity, 'Quantity');
  if (input.quantity && input.quantity.lte(0)) {
    errors.push({
      field: 'quantity',
      code: 'INVALID_QUANTITY',
      message: 'Quantity must be greater than 0.',
    });
  }
  if (input.quantityUnit === ImportQuantityUnit.CONTAINER) {
    if (input.quantity && !input.quantity.isInteger()) {
      errors.push({
        field: 'quantity',
        code: 'INVALID_QUANTITY',
        message: 'Container quantity must be a whole number.',
      });
    }
    if (publish && !input.containerSize) {
      errors.push({
        field: 'containerSize',
        code: 'REQUIRED',
        message: 'Container size is required when quantity is in containers.',
      });
    }
    if (
      input.quantity &&
      input.containerCount !== null &&
      !input.quantity.equals(input.containerCount)
    ) {
      errors.push({
        field: 'containerCount',
        code: 'INVALID_QUANTITY',
        message:
          'Number of containers must equal the quantity when quantity is in containers.',
      });
    }
  }

  const hs = normalizeHsCode(input.hsCode);
  if (hs && !/^\d{4,10}$/.test(hs)) {
    errors.push({
      field: 'hsCode',
      code: 'IMPORT_VALIDATION_FAILED',
      message: 'HS code must be 4 to 10 digits.',
    });
  }
  if (input.casNumber && !isValidCasNumber(input.casNumber)) {
    errors.push({
      field: 'casNumber',
      code: 'IMPORT_VALIDATION_FAILED',
      message:
        'CAS number must look like 9002-86-2 and have a valid check digit.',
    });
  }

  // Commercial
  required('price', input.price, isBuy ? 'Target price' : 'Offer price');
  if (input.price && input.price.lte(0)) {
    errors.push({
      field: 'price',
      code: 'INVALID_PRICE',
      message: 'Price must be greater than 0.',
    });
  }
  required('currencyId', input.currencyCode, 'Currency');
  required('priceType', input.priceType, 'Price type');
  const massUnits: ImportQuantityUnit[] = [
    ImportQuantityUnit.MT,
    ImportQuantityUnit.KG,
  ];
  const unitsCompatible =
    input.priceUnit === input.quantityUnit ||
    (massUnits.includes(input.priceUnit) &&
      massUnits.includes(input.quantityUnit));
  if (input.priceUnit === ImportQuantityUnit.OTHER || !unitsCompatible) {
    errors.push({
      field: 'priceUnit',
      code: 'INVALID_PRICE',
      message:
        'Price unit must match the quantity unit (MT and KG are interchangeable).',
    });
  }
  required('incotermId', input.incotermId, 'Incoterm');
  if (publish && !input.priceBasisPortId && !input.priceBasisLocation?.trim()) {
    errors.push({
      field: 'priceBasisLocation',
      code: 'INVALID_INCOTERM',
      message:
        'Price basis location is required with the Incoterm (e.g. CFR Mundra).',
    });
  }
  required('paymentTermId', input.paymentTermId, 'Payment term');
  if (
    input.paymentTermId &&
    input.currencyCode &&
    input.paymentTermCurrencyCodes &&
    input.paymentTermCurrencyCodes.length > 0 &&
    !input.paymentTermCurrencyCodes.includes(input.currencyCode)
  ) {
    errors.push({
      field: 'paymentTermId',
      code: 'INVALID_PAYMENT_TERM',
      message: `This payment term is not available for ${input.currencyCode}.`,
    });
  }
  if (input.currencyCode === 'INR') {
    required('gstTreatment', input.gstTreatment, 'GST treatment');
  } else if (input.currencyCode && input.gstTreatment) {
    errors.push({
      field: 'gstTreatment',
      code: 'INVALID_CURRENCY',
      message: 'GST applies only to INR transactions.',
    });
  }

  // Shipping
  required('polId', input.polId, 'Port of loading');
  required('podId', input.podId, 'Port of discharge');
  required('esd', input.esd, 'Earliest shipment date');
  required('lsd', input.lsd, 'Latest shipment date');
  if (input.esd && input.lsd && input.esd.getTime() > input.lsd.getTime()) {
    errors.push({
      field: 'lsd',
      code: 'INVALID_SHIPMENT_WINDOW',
      message:
        'Earliest shipment date must be on or before the latest shipment date.',
    });
  }
  if (publish && input.lsd && input.lsd.getTime() < today.getTime()) {
    errors.push({
      field: 'lsd',
      code: 'INVALID_SHIPMENT_WINDOW',
      message: 'Latest shipment date cannot be in the past.',
    });
  }
  const { transitMinDays: tMin, transitMaxDays: tMax } = input;
  if ((tMin === null) !== (tMax === null)) {
    errors.push({
      field: 'transitMaxDays',
      code: 'IMPORT_VALIDATION_FAILED',
      message: 'Enter both minimum and maximum transit days.',
    });
  } else if (tMin !== null && tMax !== null) {
    if (tMin < 0 || tMax > MAX_TRANSIT_DAYS || tMin > tMax) {
      errors.push({
        field: 'transitMaxDays',
        code: 'IMPORT_VALIDATION_FAILED',
        message: `Transit days must be between 0 and ${MAX_TRANSIT_DAYS}, minimum not above maximum.`,
      });
    }
  }
  if (
    input.shipmentType === ImportShipmentType.BULK &&
    (input.containerSize || input.containerCount)
  ) {
    errors.push({
      field: 'containerSize',
      code: 'INVALID_QUANTITY',
      message: 'Container details do not apply to bulk shipments.',
    });
  }
  if (input.containerCount !== null && input.containerCount <= 0) {
    errors.push({
      field: 'containerCount',
      code: 'INVALID_QUANTITY',
      message: 'Number of containers must be greater than 0.',
    });
  }

  // Validity (server clock). BUY validity is assigned by the server on publish.
  if (!isBuy) required('validUntil', input.validUntil, 'Offer validity');
  if (
    publish &&
    input.validUntil &&
    input.validUntil.getTime() <= ctx.now.getTime()
  ) {
    errors.push({
      field: 'validUntil',
      code: 'IMPORT_VALIDATION_FAILED',
      message: 'Validity must be in the future.',
    });
  }
  if (
    input.validFrom &&
    input.validUntil &&
    input.validFrom.getTime() >= input.validUntil.getTime()
  ) {
    errors.push({
      field: 'validFrom',
      code: 'IMPORT_VALIDATION_FAILED',
      message: 'Valid-from must be before valid-until.',
    });
  }

  if (isBuy) validateBuy(input, ctx, today, errors);
  else validateSell(input, ctx, errors);

  return errors;
}

function validateBuy(
  input: ListingValidationInput,
  ctx: ValidationContext,
  today: Date,
  errors: ImportFieldError[],
) {
  const {
    acceptableQuantityMin: min,
    acceptableQuantityMax: max,
    quantity,
  } = input;
  if (min && min.lte(0)) {
    errors.push({
      field: 'acceptableQuantityMin',
      code: 'INVALID_QUANTITY',
      message: 'Minimum acceptable quantity must be greater than 0.',
    });
  }
  if (min && max && min.gt(max)) {
    errors.push({
      field: 'acceptableQuantityMax',
      code: 'INVALID_QUANTITY',
      message: 'Minimum acceptable quantity cannot exceed the maximum.',
    });
  }
  if (quantity && min && min.gt(quantity)) {
    errors.push({
      field: 'acceptableQuantityMin',
      code: 'INVALID_QUANTITY',
      message:
        'Minimum acceptable quantity cannot exceed the required quantity.',
    });
  }
  if (quantity && max && max.lt(quantity)) {
    errors.push({
      field: 'acceptableQuantityMax',
      code: 'INVALID_QUANTITY',
      message:
        'Maximum acceptable quantity cannot be below the required quantity.',
    });
  }
  if (input.requiredDeliveryDate) {
    if (
      ctx.mode === 'publish' &&
      input.requiredDeliveryDate.getTime() < today.getTime()
    ) {
      errors.push({
        field: 'requiredDeliveryDate',
        code: 'IMPORT_VALIDATION_FAILED',
        message: 'Required delivery date cannot be in the past.',
      });
    }
    if (
      input.esd &&
      input.requiredDeliveryDate.getTime() < input.esd.getTime()
    ) {
      errors.push({
        field: 'requiredDeliveryDate',
        code: 'INVALID_SHIPMENT_WINDOW',
        message:
          'Required delivery date cannot be before the earliest shipment date.',
      });
    }
  }
  for (const field of ['moq', 'maximumQuantity', 'readyStockType'] as const) {
    if (input[field] !== null) {
      errors.push({
        field,
        code: 'IMPORT_VALIDATION_FAILED',
        message: `${field} applies only to SELL offers.`,
      });
    }
  }
}

function validateSell(
  input: ListingValidationInput,
  ctx: ValidationContext,
  errors: ImportFieldError[],
) {
  const { moq, maximumQuantity: max, quantity } = input;
  if (ctx.mode === 'publish' && !moq) {
    errors.push({
      field: 'moq',
      code: 'REQUIRED',
      message: 'MOQ is required.',
    });
  }
  if (moq && moq.lte(0)) {
    errors.push({
      field: 'moq',
      code: 'INVALID_QUANTITY',
      message: 'MOQ must be greater than 0.',
    });
  }
  if (moq && max && moq.gt(max)) {
    errors.push({
      field: 'moq',
      code: 'INVALID_QUANTITY',
      message: 'MOQ cannot exceed the maximum quantity.',
    });
  }
  if (moq && quantity && moq.gt(quantity)) {
    errors.push({
      field: 'moq',
      code: 'INVALID_QUANTITY',
      message: 'MOQ cannot exceed the available quantity.',
    });
  }
  if (max && quantity && max.gt(quantity)) {
    errors.push({
      field: 'maximumQuantity',
      code: 'INVALID_QUANTITY',
      message:
        'Maximum quantity per buyer cannot exceed the available quantity.',
    });
  }
  if (ctx.mode === 'publish' && !input.readyStockType) {
    errors.push({
      field: 'readyStockType',
      code: 'REQUIRED',
      message: 'Ready stock / shipment type is required.',
    });
  }
  for (const field of [
    'acceptableQuantityMin',
    'acceptableQuantityMax',
    'requiredDeliveryDate',
  ] as const) {
    if (input[field] !== null) {
      errors.push({
        field,
        code: 'IMPORT_VALIDATION_FAILED',
        message: `${field} applies only to BUY requests.`,
      });
    }
  }
}

/** Estimated arrival window from the shipment window and configured transit days. */
export function estimateEta(input: {
  esd: Date | null;
  lsd: Date | null;
  transitMinDays: number | null;
  transitMaxDays: number | null;
}): { from: string; to: string; basis: 'ESTIMATED_FROM_TRANSIT_DAYS' } | null {
  const { esd, lsd, transitMinDays, transitMaxDays } = input;
  if (!esd || !lsd || transitMinDays === null || transitMaxDays === null)
    return null;
  const day = 24 * 60 * 60 * 1000;
  const from = new Date(esd.getTime() + transitMinDays * day);
  const to = new Date(lsd.getTime() + transitMaxDays * day);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    basis: 'ESTIMATED_FROM_TRANSIT_DAYS',
  };
}
