import {
  ImportListingStatus,
  ImportSide,
} from '../../../generated/prisma/client.js';

export const MATCH_CRITERIA = [
  'PRODUCT',
  'GRADE',
  'BRAND',
  'ORIGIN',
  'QUANTITY',
  'MOQ',
  'PRICE',
  'CURRENCY',
  'INCOTERM',
  'POL',
  'POD',
  'PAYMENT_TERMS',
  'SHIPMENT_WINDOW',
  'QUALITY',
] as const;

export type MatchCriterion = (typeof MATCH_CRITERIA)[number];
export type MatchWeights = Record<MatchCriterion, number>;

/** Defaults sum to 100. Admin can change them; scoring always normalises. */
export const DEFAULT_MATCH_WEIGHTS: MatchWeights = {
  PRODUCT: 15,
  GRADE: 15,
  BRAND: 5,
  ORIGIN: 5,
  QUANTITY: 10,
  MOQ: 5,
  PRICE: 10,
  CURRENCY: 5,
  INCOTERM: 5,
  POL: 5,
  POD: 5,
  PAYMENT_TERMS: 5,
  SHIPMENT_WINDOW: 5,
  QUALITY: 5,
};

export const MATCH_ALGORITHM_VERSION = 'import-match-v1';
export const DEFAULT_MIN_MATCH_SCORE = 60;

/** Listings in these statuses are visible to counterparties and can be negotiated. */
export const OPEN_LISTING_STATUSES: ImportListingStatus[] = [
  ImportListingStatus.PUBLISHED,
  ImportListingStatus.MATCHING,
  ImportListingStatus.OFFER_RECEIVED,
  ImportListingStatus.NEGOTIATION,
];

/** Owners may edit commercial terms of a live listing in these statuses. */
export const LIVE_EDITABLE_STATUSES: ImportListingStatus[] = [
  ...OPEN_LISTING_STATUSES,
  ImportListingStatus.PAUSED,
];

export const REFERENCE_PREFIX = {
  BUY: 'IBR',
  SELL: 'ISO',
  NEGOTIATION: 'INE',
  DEAL: 'IDL',
} as const;

export const REFERENCE_SEQUENCE = {
  BUY: 'import_buy_ref_seq',
  SELL: 'import_sell_ref_seq',
  NEGOTIATION: 'import_negotiation_ref_seq',
  DEAL: 'import_deal_ref_seq',
} as const;

export type ReferenceKind = keyof typeof REFERENCE_PREFIX;

export function sideReferenceKind(side: ImportSide): ReferenceKind {
  return side === ImportSide.BUY ? 'BUY' : 'SELL';
}

/** Fields that define *what* is traded; frozen once a listing is published. */
export const LOCKED_AFTER_PUBLISH = [
  'categoryId',
  'gradeId',
  'customGradeName',
  'brandId',
  'originCountryId',
  'currencyId',
  'incotermId',
  'polId',
  'podId',
  'quantityUnit',
  'priceUnit',
] as const;

export const IMPORT_NOTIFICATION_EVENTS = {
  MATCH_FOUND: 'IMPORT_MATCH_FOUND',
  RESPONSE_RECEIVED: 'IMPORT_RESPONSE_RECEIVED',
  COUNTEROFFER_RECEIVED: 'IMPORT_COUNTEROFFER_RECEIVED',
  COUNTEROFFER_ACCEPTED: 'IMPORT_COUNTEROFFER_ACCEPTED',
  COUNTEROFFER_REJECTED: 'IMPORT_COUNTEROFFER_REJECTED',
  NEGOTIATION_WITHDRAWN: 'IMPORT_NEGOTIATION_WITHDRAWN',
  DEAL_CONFIRMATION_REQUIRED: 'IMPORT_DEAL_CONFIRMATION_REQUIRED',
  DEAL_CONFIRMED: 'IMPORT_DEAL_CONFIRMED',
  PRICE_CHANGED: 'IMPORT_PRICE_CHANGED',
  SHIPMENT_CHANGED: 'IMPORT_SHIPMENT_CHANGED',
  PAYMENT_TERMS_CHANGED: 'IMPORT_PAYMENT_TERMS_CHANGED',
  NEAR_EXPIRY: 'IMPORT_LISTING_NEAR_EXPIRY',
  EXPIRED: 'IMPORT_LISTING_EXPIRED',
} as const;

export type ImportNotificationEvent =
  (typeof IMPORT_NOTIFICATION_EVENTS)[keyof typeof IMPORT_NOTIFICATION_EVENTS];
