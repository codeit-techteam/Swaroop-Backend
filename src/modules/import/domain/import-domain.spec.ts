import {
  ImportContainerSize,
  ImportInspectionType,
  ImportListingStatus as S,
  ImportPriceType,
  ImportQuantityUnit,
  ImportReadyStockType,
  ImportShipmentType,
  ImportSide,
  Prisma,
} from '../../../generated/prisma/client.js';
import {
  advanceStatus,
  assertTransition,
  canTransition,
} from './import-status.machine.js';
import {
  estimateEta,
  isValidCasNumber,
  validateListing,
  type ListingValidationInput,
} from './import-validation.js';
import { scoreMatch, type MatchableListing } from './import-matching.js';
import { DEFAULT_MATCH_WEIGHTS } from './import.constants.js';
import { ImportException, throwFieldErrors } from './import.errors.js';
import { toDecimal } from './import-decimal.js';

const D = (v: string | number) => new Prisma.Decimal(String(v));
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const NOW = new Date('2026-09-30T10:00:00.000Z');

function sellInput(
  overrides: Partial<ListingValidationInput> = {},
): ListingValidationInput {
  return {
    side: ImportSide.SELL,
    categoryId: 'cat-pp',
    gradeId: 'grade-raffia',
    customGradeName: null,
    brandId: 'brand-hmel',
    originCountryId: 'country-in',
    quantity: D(500),
    quantityUnit: ImportQuantityUnit.MT,
    hsCode: '3902.10',
    casNumber: '9003-07-0',
    price: D(920),
    currencyCode: 'USD',
    priceUnit: ImportQuantityUnit.MT,
    priceType: ImportPriceType.FIXED,
    incotermId: 'inc-cfr',
    priceBasisPortId: 'port-mundra',
    priceBasisLocation: null,
    paymentTermId: 'pt-lc90',
    paymentTermCurrencyCodes: ['USD', 'EUR', 'CNY'],
    gstTreatment: null,
    polId: 'port-mundra',
    podId: 'port-mundra',
    esd: day('2026-10-01'),
    lsd: day('2026-10-25'),
    transitMinDays: 25,
    transitMaxDays: 30,
    shipmentType: ImportShipmentType.FCL,
    containerSize: ImportContainerSize.FT_40,
    containerCount: null,
    acceptableQuantityMin: null,
    acceptableQuantityMax: null,
    requiredDeliveryDate: null,
    moq: D(20),
    maximumQuantity: null,
    readyStockType: ImportReadyStockType.READY_STOCK,
    validFrom: null,
    validUntil: new Date('2026-10-15T00:00:00.000Z'),
    ...overrides,
  };
}

function buyInput(
  overrides: Partial<ListingValidationInput> = {},
): ListingValidationInput {
  return sellInput({
    side: ImportSide.BUY,
    moq: null,
    readyStockType: null,
    acceptableQuantityMin: D(400),
    acceptableQuantityMax: D(600),
    ...overrides,
  });
}

const publish = { mode: 'publish' as const, now: NOW, allowCustomGrade: true };
const draft = { mode: 'draft' as const, now: NOW, allowCustomGrade: true };
const codes = (errors: { field: string; code: string }[]) =>
  errors.map((e) => `${e.field}:${e.code}`);

describe('import status machine', () => {
  it('allows the forward trade lifecycle', () => {
    const path = [
      S.DRAFT,
      S.PUBLISHED,
      S.MATCHING,
      S.OFFER_RECEIVED,
      S.NEGOTIATION,
      S.MATCHED,
      S.DEAL_CONFIRMED,
      S.PARTIALLY_FULFILLED,
      S.FULFILLED,
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it('rejects arbitrary jumps with a structured error', () => {
    expect(() => assertTransition(S.DRAFT, S.DEAL_CONFIRMED)).toThrow(
      ImportException,
    );
    try {
      assertTransition(S.EXPIRED, S.PUBLISHED);
    } catch (err) {
      expect((err as ImportException).code).toBe('IMPORT_ALREADY_EXPIRED');
    }
  });

  it('never moves a listing backwards when advancing', () => {
    expect(advanceStatus(S.NEGOTIATION, S.MATCHING)).toBe(S.NEGOTIATION);
    expect(advanceStatus(S.PUBLISHED, S.OFFER_RECEIVED)).toBe(S.OFFER_RECEIVED);
    expect(advanceStatus(S.PAUSED, S.NEGOTIATION)).toBe(S.PAUSED);
    expect(advanceStatus(S.DRAFT, S.MATCHING)).toBe(S.DRAFT);
  });
});

describe('import listing validation', () => {
  it('accepts a complete SELL offer', () => {
    expect(validateListing(sellInput(), publish)).toEqual([]);
  });

  it('accepts a complete BUY RFQ', () => {
    expect(validateListing(buyInput(), publish)).toEqual([]);
  });

  it('lets drafts be incomplete but still rejects bad values', () => {
    const empty = sellInput({
      categoryId: null,
      brandId: null,
      price: null,
      polId: null,
      moq: null,
    });
    expect(validateListing(empty, draft)).toEqual([]);
    expect(codes(validateListing(sellInput({ price: D(0) }), draft))).toContain(
      'price:INVALID_PRICE',
    );
  });

  it('requires mandatory fields on publish', () => {
    const errors = codes(
      validateListing(
        sellInput({
          categoryId: null,
          gradeId: null,
          brandId: null,
          incotermId: null,
          polId: null,
          podId: null,
          paymentTermId: null,
          moq: null,
        }),
        publish,
      ),
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        'categoryId:REQUIRED',
        'gradeId:REQUIRED',
        'brandId:REQUIRED',
        'incotermId:REQUIRED',
        'polId:REQUIRED',
        'podId:REQUIRED',
        'paymentTermId:REQUIRED',
        'moq:REQUIRED',
      ]),
    );
  });

  it('rejects ESD after LSD and past shipment windows', () => {
    expect(
      codes(validateListing(sellInput({ esd: day('2026-10-26') }), publish)),
    ).toContain('lsd:INVALID_SHIPMENT_WINDOW');
    expect(
      codes(
        validateListing(
          sellInput({ esd: day('2026-09-01'), lsd: day('2026-09-10') }),
          publish,
        ),
      ),
    ).toContain('lsd:INVALID_SHIPMENT_WINDOW');
  });

  it('enforces MOQ against available and maximum quantity', () => {
    expect(
      codes(validateListing(sellInput({ moq: D(600) }), publish)),
    ).toContain('moq:INVALID_QUANTITY');
    expect(
      codes(
        validateListing(
          sellInput({ moq: D(50), maximumQuantity: D(40) }),
          publish,
        ),
      ),
    ).toContain('moq:INVALID_QUANTITY');
  });

  it('enforces BUY acceptable quantity range around the required quantity', () => {
    expect(
      codes(
        validateListing(buyInput({ acceptableQuantityMin: D(550) }), publish),
      ),
    ).toContain('acceptableQuantityMin:INVALID_QUANTITY');
    expect(
      codes(
        validateListing(buyInput({ acceptableQuantityMax: D(450) }), publish),
      ),
    ).toContain('acceptableQuantityMax:INVALID_QUANTITY');
  });

  it('requires a price basis location with the Incoterm', () => {
    expect(
      codes(
        validateListing(
          sellInput({ priceBasisPortId: null, priceBasisLocation: null }),
          publish,
        ),
      ),
    ).toContain('priceBasisLocation:INVALID_INCOTERM');
  });

  it('rejects payment terms that do not support the currency', () => {
    expect(
      codes(
        validateListing(
          sellInput({ paymentTermCurrencyCodes: ['INR'] }),
          publish,
        ),
      ),
    ).toContain('paymentTermId:INVALID_PAYMENT_TERM');
  });

  it('applies GST only to INR', () => {
    expect(
      codes(
        validateListing(
          sellInput({ currencyCode: 'INR', paymentTermCurrencyCodes: ['INR'] }),
          publish,
        ),
      ),
    ).toContain('gstTreatment:REQUIRED');
    expect(
      codes(validateListing(sellInput({ gstTreatment: 'GST_EXTRA' }), publish)),
    ).toContain('gstTreatment:INVALID_CURRENCY');
  });

  it('keeps container quantities consistent', () => {
    const containers = sellInput({
      quantity: D(2),
      quantityUnit: ImportQuantityUnit.CONTAINER,
      priceUnit: ImportQuantityUnit.CONTAINER,
      moq: D(1),
      containerCount: 3,
    });
    expect(codes(validateListing(containers, publish))).toContain(
      'containerCount:INVALID_QUANTITY',
    );
    expect(
      codes(
        validateListing(
          sellInput({ shipmentType: ImportShipmentType.BULK }),
          publish,
        ),
      ),
    ).toContain('containerSize:INVALID_QUANTITY');
  });

  it('rejects price units that cannot apply to the quantity', () => {
    expect(
      codes(
        validateListing(
          sellInput({ priceUnit: ImportQuantityUnit.CONTAINER }),
          publish,
        ),
      ),
    ).toContain('priceUnit:INVALID_PRICE');
    expect(
      validateListing(sellInput({ priceUnit: ImportQuantityUnit.KG }), publish),
    ).toEqual([]);
  });

  it('requires validity in the future on publish (server time)', () => {
    expect(
      codes(
        validateListing(
          sellInput({ validUntil: new Date('2026-09-30T09:59:59Z') }),
          publish,
        ),
      ),
    ).toContain('validUntil:IMPORT_VALIDATION_FAILED');
  });

  it('rejects side-specific fields on the wrong side', () => {
    expect(codes(validateListing(buyInput({ moq: D(10) }), publish))).toContain(
      'moq:IMPORT_VALIDATION_FAILED',
    );
    expect(
      codes(
        validateListing(sellInput({ acceptableQuantityMin: D(10) }), publish),
      ),
    ).toContain('acceptableQuantityMin:IMPORT_VALIDATION_FAILED');
  });

  it('honours the custom grade business rule', () => {
    const custom = sellInput({
      gradeId: null,
      customGradeName: 'Raffia RF-110',
    });
    expect(validateListing(custom, publish)).toEqual([]);
    expect(
      codes(validateListing(custom, { ...publish, allowCustomGrade: false })),
    ).toContain('customGradeName:INVALID_MASTER_REFERENCE');
  });

  it('validates CAS numbers with the check digit', () => {
    expect(isValidCasNumber('9002-86-2')).toBe(true);
    expect(isValidCasNumber('9002-86-3')).toBe(false);
  });

  it('labels ETA as an estimate from transit days', () => {
    expect(
      estimateEta({
        esd: day('2026-10-01'),
        lsd: day('2026-10-25'),
        transitMinDays: 25,
        transitMaxDays: 30,
      }),
    ).toEqual({
      from: '2026-10-26',
      to: '2026-11-24',
      basis: 'ESTIMATED_FROM_TRANSIT_DAYS',
    });
    expect(
      estimateEta({
        esd: day('2026-10-01'),
        lsd: null,
        transitMinDays: 25,
        transitMaxDays: 30,
      }),
    ).toBeNull();
  });

  it('surfaces a single specific code when all errors share it', () => {
    try {
      throwFieldErrors([
        {
          field: 'lsd',
          code: 'INVALID_SHIPMENT_WINDOW',
          message: 'bad window',
        },
      ]);
    } catch (err) {
      expect((err as ImportException).code).toBe('INVALID_SHIPMENT_WINDOW');
    }
  });
});

describe('import decimal parsing', () => {
  it('parses without float drift and rejects junk', () => {
    expect(toDecimal('0.1')!.plus(toDecimal('0.2')!).toString()).toBe('0.3');
    expect(toDecimal('$780')).toBeNull();
    expect(toDecimal(780)!.toString()).toBe('780');
  });
});

describe('import matching scorer', () => {
  const base: MatchableListing = {
    id: 'x',
    categoryId: 'cat-pp',
    gradeId: 'grade-raffia',
    customGradeName: null,
    brandId: 'brand-hmel',
    originCountryId: 'country-in',
    quantity: D(500),
    quantityUnit: ImportQuantityUnit.MT,
    acceptableQuantityMin: null,
    acceptableQuantityMax: null,
    moq: null,
    maximumQuantity: null,
    price: D(920),
    currencyCode: 'USD',
    priceUnit: ImportQuantityUnit.MT,
    incotermId: 'inc-cfr',
    priceBasisPortId: 'port-mundra',
    priceBasisLocation: null,
    polId: 'port-mundra',
    podId: 'port-mundra',
    paymentTermId: 'pt-lc90',
    esd: day('2026-10-01'),
    lsd: day('2026-10-25'),
    inspectionType: ImportInspectionType.SGS,
    documentRequirementIds: ['doc-coa'],
  };
  const buy = { ...base, id: 'buy-1' };
  const sell = {
    ...base,
    id: 'sell-1',
    price: D(918),
    moq: D(20),
    lsd: day('2026-10-22'),
    documentRequirementIds: ['doc-coa', 'doc-tds'],
  };

  it('scores a full match at 100 with evidence', () => {
    const result = scoreMatch(buy, sell);
    expect(result.matchScore).toBe(100);
    expect(result.unmatchedCriteria).toEqual([]);
    expect(result.evidence).toHaveLength(14);
  });

  it('reports exactly which criteria failed and weights the score', () => {
    const result = scoreMatch(buy, {
      ...sell,
      price: D(950),
      paymentTermId: 'pt-lc60',
    });
    expect(result.unmatchedCriteria).toEqual(['PRICE', 'PAYMENT_TERMS']);
    expect(result.matchScore).toBe(85);
  });

  it('does not compare prices across different Incoterms or basis locations', () => {
    const fob = scoreMatch(buy, {
      ...sell,
      incotermId: 'inc-fob',
      price: D(760),
    });
    const price = fob.evidence.find((e) => e.criterion === 'PRICE')!;
    expect(price.matched).toBe(false);
    expect(price.reason).toMatch(/Not comparable/);
  });

  it('converts KG prices and quantities to MT for comparison', () => {
    const result = scoreMatch(buy, {
      ...sell,
      price: D('0.918'),
      priceUnit: ImportQuantityUnit.KG,
      quantity: D(500000),
      quantityUnit: ImportQuantityUnit.KG,
    });
    expect(result.matchedCriteria).toEqual(
      expect.arrayContaining(['PRICE', 'QUANTITY']),
    );
  });

  it('uses configurable weights and normalises them', () => {
    const weights = { ...DEFAULT_MATCH_WEIGHTS, PRICE: 90 };
    const result = scoreMatch(buy, { ...sell, price: D(999) }, weights);
    expect(result.matchScore).toBe(50);
  });

  it('flags non-overlapping shipment windows and missing documents', () => {
    const result = scoreMatch(buy, {
      ...sell,
      esd: day('2026-11-01'),
      lsd: day('2026-11-20'),
      documentRequirementIds: [],
    });
    expect(result.unmatchedCriteria).toEqual(
      expect.arrayContaining(['SHIPMENT_WINDOW', 'QUALITY']),
    );
  });
});
