import {
  ImportInspectionType,
  type ImportListing,
} from '../../../generated/prisma/client.js';
import { comparableQuantities, pricePerMetricTon } from './import-decimal.js';
import {
  MATCH_ALGORITHM_VERSION,
  MATCH_CRITERIA,
  type MatchCriterion,
  type MatchWeights,
  DEFAULT_MATCH_WEIGHTS,
} from './import.constants.js';

export type MatchableListing = Pick<
  ImportListing,
  | 'id'
  | 'categoryId'
  | 'gradeId'
  | 'customGradeName'
  | 'brandId'
  | 'originCountryId'
  | 'quantity'
  | 'quantityUnit'
  | 'acceptableQuantityMin'
  | 'acceptableQuantityMax'
  | 'moq'
  | 'maximumQuantity'
  | 'price'
  | 'currencyCode'
  | 'priceUnit'
  | 'incotermId'
  | 'priceBasisPortId'
  | 'priceBasisLocation'
  | 'polId'
  | 'podId'
  | 'paymentTermId'
  | 'esd'
  | 'lsd'
  | 'inspectionType'
> & { documentRequirementIds: string[] };

export type CriterionEvidence = {
  criterion: MatchCriterion;
  weight: number;
  matched: boolean;
  reason: string;
};

export type MatchResult = {
  buyListingId: string;
  sellListingId: string;
  matchScore: number;
  matchedCriteria: MatchCriterion[];
  unmatchedCriteria: MatchCriterion[];
  evidence: CriterionEvidence[];
  weights: MatchWeights;
  algorithmVersion: string;
};

/** Accepts any partial/unknown JSON and returns a complete, non-negative weight map. */
export function normalizeWeights(raw: unknown): MatchWeights {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const weights = { ...DEFAULT_MATCH_WEIGHTS };
  for (const criterion of MATCH_CRITERIA) {
    const value = Number(source[criterion]);
    if (Number.isFinite(value) && value >= 0) weights[criterion] = value;
  }
  return weights;
}

function sameText(a: string | null, b: string | null): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Deterministic score: sum of weights of satisfied criteria divided by the sum
 * of all weights, as a percentage (2 dp). No heuristics, no AI.
 *
 * Prices are only compared when currency, Incoterm, price unit (MT/KG are
 * converted) and price-basis location are identical; otherwise PRICE is
 * reported as not comparable rather than guessed.
 */
export function scoreMatch(
  buy: MatchableListing,
  sell: MatchableListing,
  weightsInput: MatchWeights = DEFAULT_MATCH_WEIGHTS,
): MatchResult {
  const weights = normalizeWeights(weightsInput);
  const evidence: CriterionEvidence[] = [];
  const add = (criterion: MatchCriterion, matched: boolean, reason: string) =>
    evidence.push({ criterion, weight: weights[criterion], matched, reason });

  add(
    'PRODUCT',
    !!buy.categoryId && buy.categoryId === sell.categoryId,
    buy.categoryId === sell.categoryId ? 'Same product' : 'Different product',
  );

  const gradeMatch =
    (!!buy.gradeId && buy.gradeId === sell.gradeId) ||
    (!buy.gradeId &&
      !sell.gradeId &&
      sameText(buy.customGradeName, sell.customGradeName));
  add('GRADE', gradeMatch, gradeMatch ? 'Same grade' : 'Different grade');

  add(
    'BRAND',
    !!buy.brandId && buy.brandId === sell.brandId,
    buy.brandId === sell.brandId ? 'Same brand' : 'Different brand',
  );
  add(
    'ORIGIN',
    !!buy.originCountryId && buy.originCountryId === sell.originCountryId,
    buy.originCountryId === sell.originCountryId
      ? 'Same origin'
      : 'Different origin',
  );

  // Quantity: seller must cover the buyer's minimum acceptable quantity.
  const buyMin = buy.acceptableQuantityMin ?? buy.quantity;
  const qty = comparableQuantities(
    sell.quantity,
    sell.quantityUnit,
    buyMin,
    buy.quantityUnit,
  );
  if (!qty) {
    add('QUANTITY', false, 'Quantities are in units that cannot be compared');
  } else {
    add(
      'QUANTITY',
      qty[0].gte(qty[1]),
      qty[0].gte(qty[1])
        ? 'Available quantity covers the requirement'
        : 'Available quantity is below the requirement',
    );
  }

  // MOQ: seller's minimum must not exceed the buyer's maximum acceptable quantity.
  const buyMax = buy.acceptableQuantityMax ?? buy.quantity;
  if (!sell.moq) {
    add('MOQ', true, 'No minimum order quantity');
  } else {
    const moq = comparableQuantities(
      sell.moq,
      sell.quantityUnit,
      buyMax,
      buy.quantityUnit,
    );
    if (!moq) add('MOQ', false, 'MOQ is in a unit that cannot be compared');
    else
      add(
        'MOQ',
        moq[0].lte(moq[1]),
        moq[0].lte(moq[1])
          ? 'MOQ fits the requirement'
          : 'MOQ exceeds the requirement',
      );
  }

  const sameCurrency =
    !!buy.currencyCode && buy.currencyCode === sell.currencyCode;
  const sameIncoterm = !!buy.incotermId && buy.incotermId === sell.incotermId;
  const sameBasis =
    (!!buy.priceBasisPortId &&
      buy.priceBasisPortId === sell.priceBasisPortId) ||
    sameText(buy.priceBasisLocation, sell.priceBasisLocation);
  const buyPrice = pricePerMetricTon(buy.price, buy.priceUnit);
  const sellPrice = pricePerMetricTon(sell.price, sell.priceUnit);
  const samePriceUnit = buy.priceUnit === sell.priceUnit;
  if (!sameCurrency || !sameIncoterm || !sameBasis) {
    add(
      'PRICE',
      false,
      'Not comparable: currency, Incoterm or price basis location differ',
    );
  } else if (buyPrice && sellPrice) {
    add(
      'PRICE',
      sellPrice.lte(buyPrice),
      sellPrice.lte(buyPrice)
        ? 'Offer price is within target'
        : 'Offer price is above target',
    );
  } else if (samePriceUnit && buy.price && sell.price) {
    add(
      'PRICE',
      sell.price.lte(buy.price),
      sell.price.lte(buy.price)
        ? 'Offer price is within target'
        : 'Offer price is above target',
    );
  } else {
    add('PRICE', false, 'Not comparable: price units differ');
  }

  add(
    'CURRENCY',
    sameCurrency,
    sameCurrency ? 'Same currency' : 'Different currency',
  );
  add(
    'INCOTERM',
    sameIncoterm,
    sameIncoterm ? 'Same Incoterm' : 'Different Incoterm',
  );
  add(
    'POL',
    !!buy.polId && buy.polId === sell.polId,
    buy.polId === sell.polId
      ? 'Same port of loading'
      : 'Different port of loading',
  );
  add(
    'POD',
    !!buy.podId && buy.podId === sell.podId,
    buy.podId === sell.podId
      ? 'Same port of discharge'
      : 'Different port of discharge',
  );
  add(
    'PAYMENT_TERMS',
    !!buy.paymentTermId && buy.paymentTermId === sell.paymentTermId,
    buy.paymentTermId === sell.paymentTermId
      ? 'Same payment term'
      : 'Different payment term',
  );

  const overlap =
    !!buy.esd &&
    !!buy.lsd &&
    !!sell.esd &&
    !!sell.lsd &&
    sell.esd.getTime() <= buy.lsd.getTime() &&
    buy.esd.getTime() <= sell.lsd.getTime();
  add(
    'SHIPMENT_WINDOW',
    overlap,
    overlap ? 'Shipment windows overlap' : 'Shipment windows do not overlap',
  );

  const inspectionOk =
    !buy.inspectionType ||
    buy.inspectionType === ImportInspectionType.NO_INSPECTION ||
    buy.inspectionType === sell.inspectionType;
  const sellDocs = new Set(sell.documentRequirementIds);
  const missingDocs = buy.documentRequirementIds.filter(
    (id) => !sellDocs.has(id),
  );
  add(
    'QUALITY',
    inspectionOk && missingDocs.length === 0,
    !inspectionOk
      ? 'Inspection requirement not offered'
      : missingDocs.length
        ? `${missingDocs.length} required document(s) not offered`
        : 'Inspection and documents satisfied',
  );

  const total = MATCH_CRITERIA.reduce((sum, c) => sum + weights[c], 0);
  const achieved = evidence
    .filter((e) => e.matched)
    .reduce((sum, e) => sum + e.weight, 0);
  const matchScore =
    total > 0 ? Math.round((achieved / total) * 10000) / 100 : 0;

  return {
    buyListingId: buy.id,
    sellListingId: sell.id,
    matchScore,
    matchedCriteria: evidence.filter((e) => e.matched).map((e) => e.criterion),
    unmatchedCriteria: evidence
      .filter((e) => !e.matched)
      .map((e) => e.criterion),
    evidence,
    weights,
    algorithmVersion: MATCH_ALGORITHM_VERSION,
  };
}
