import {
  CreditAccountStatus,
  CreditApplicationStatus,
  CreditStatus,
  PaymentMethod,
  Prisma,
} from '../../../generated/prisma/client.js';
import {
  creditDisplayStatus,
  creditNextStep,
  isResubmissionRequested,
} from './credit-workflow.js';
import { toDecimal } from './money.util.js';

/**
 * Shared, backend-authoritative payment-eligibility contract consumed by the
 * Customer App and Customer WebApp. Both clients render the *same* explicit
 * credit state instead of guessing from scattered booleans.
 */

/** Credit tenures the platform can offer as checkout payment methods. */
export const SUPPORTED_CREDIT_TENURES: ReadonlyArray<{
  paymentOption: PaymentMethod;
  tenureDays: number;
  label: string;
}> = [
  {
    paymentOption: PaymentMethod.CREDIT_15,
    tenureDays: 15,
    label: 'Credit 15 Days',
  },
  {
    paymentOption: PaymentMethod.CREDIT_30,
    tenureDays: 30,
    label: 'Credit 30 Days',
  },
];

export function tenureDaysForMethod(
  method: PaymentMethod | string | null | undefined,
): number | null {
  const found = SUPPORTED_CREDIT_TENURES.find(
    (tenure) => tenure.paymentOption === method,
  );
  return found?.tenureDays ?? null;
}

/**
 * Tenures the customer may select given the approved term on their account.
 * A `null` approved term keeps every supported tenure available (legacy
 * accounts approved before the term was recorded).
 */
export function availableCreditTenures(
  approvedTermDays: number | null | undefined,
) {
  if (approvedTermDays == null || approvedTermDays <= 0) {
    return [...SUPPORTED_CREDIT_TENURES];
  }
  return SUPPORTED_CREDIT_TENURES.filter(
    (tenure) => tenure.tenureDays <= approvedTermDays,
  );
}

export type CreditAccessState =
  | 'NOT_APPLIED'
  | 'APPLICATION_DRAFT'
  | 'APPLICATION_PENDING'
  | 'ACTION_REQUIRED'
  | 'APPROVED'
  | 'LIMIT_EXCEEDED'
  | 'SUSPENDED'
  | 'BLOCKED'
  | 'EXPIRED'
  | 'CLOSED'
  | 'REJECTED';

export type CreditCtaType =
  | 'REQUEST_CREDIT'
  | 'CONTINUE_APPLICATION'
  | 'VIEW_APPLICATION'
  | 'UPLOAD_DOCUMENTS'
  | 'CONTACT_SUPPORT';

export type CreditApplicationSummary = {
  id: string;
  applicationNumber: string;
  status: CreditApplicationStatus;
  displayStatus: string;
  submittedAt: Date | null;
  decidedAt: Date | null;
  customerMessage: string | null;
  nextStep: string;
};

export type CreditAccountSummary = {
  approvedLimit: string;
  availableLimit: string;
  utilizedAmount: string;
  outstandingAmount: string;
  overdueAmount: string;
  currency: string;
  creditTermDays: number | null;
  approvedAt: Date | null;
  expiresAt: Date | null;
  reviewAt: Date | null;
};

export type CreditAccessView = {
  state: CreditAccessState;
  /** True only when a credit tenure can be selected for `amount` right now. */
  eligible: boolean;
  reason: string | null;
  canApply: boolean;
  title: string;
  message: string;
  cta: { type: CreditCtaType; label: string } | null;
  application: CreditApplicationSummary | null;
  account: CreditAccountSummary | null;
  tenureOptions: Array<{
    paymentOption: PaymentMethod;
    tenureDays: number;
    label: string;
  }>;
  /** Independent of the customer: does this product/offer support credit. */
  productSupported: boolean;
};

export type PaymentOptionView = {
  paymentOption: PaymentMethod;
  kind: 'STANDARD' | 'CREDIT';
  title: string;
  description: string;
  /** When payment is due, in customer language. */
  dueLabel: string;
  /** Only present when the backend has a configured benefit (e.g. discount). */
  benefitLabel: string | null;
  discountBps: number;
  tenureDays: number | null;
  /**
   * Selectable at checkout only when true. Locked credit previews stay visible
   * (`eligible: false`) so customers can discover Net-15 / Net-30 and apply.
   */
  eligible: boolean;
};

export type ProductCreditConfig = {
  /** Whether this product/offer may be paid with platform credit. */
  supported: boolean;
  /** Product-configured tenures. Empty when `supported` is false. */
  tenureDays: number[];
};

export const DEFAULT_PRODUCT_CREDIT: ProductCreditConfig = {
  supported: true,
  tenureDays: [15, 30],
};

export type PaymentEligibilityView = {
  source: 'PETROTRADE';
  currency: string;
  amount: string | null;
  options: PaymentOptionView[];
  productCredit: ProductCreditConfig;
  credit: CreditAccessView;
};

type Moneyish = Prisma.Decimal | number | string | null | undefined;

type AccountInput = {
  status: CreditStatus;
  accountStatus: CreditAccountStatus;
  approvedLimit: Moneyish;
  availableLimit: Moneyish;
  utilizedAmount: Moneyish;
  outstandingAmount: Moneyish;
  overdueAmount: Moneyish;
  currency: string;
  creditTermDays: number | null;
  approvedAt: Date | null;
  expiresAt: Date | null;
  reviewAt: Date | null;
} | null;

type ApplicationInput = {
  id: string;
  applicationNumber: string;
  status: CreditApplicationStatus;
  submittedAt: Date | null;
  decidedAt: Date | null;
  customerMessage: string | null;
} | null;

const PENDING_STATUSES: CreditApplicationStatus[] = [
  CreditApplicationStatus.PENDING,
  CreditApplicationStatus.DOCUMENTS_UNDER_REVIEW,
  CreditApplicationStatus.UNDER_REVIEW,
  CreditApplicationStatus.INSURANCE_REVIEW,
  CreditApplicationStatus.CREDIT_ARRANGEMENT_PENDING,
];

function summarizeApplication(
  application: NonNullable<ApplicationInput>,
): CreditApplicationSummary {
  const resubmissionRequested = isResubmissionRequested(application);
  return {
    id: application.id,
    applicationNumber: application.applicationNumber,
    status: application.status,
    displayStatus: creditDisplayStatus(application),
    submittedAt: application.submittedAt,
    decidedAt: application.decidedAt,
    customerMessage: application.customerMessage,
    nextStep: creditNextStep(application.status, { resubmissionRequested }),
  };
}

function summarizeAccount(
  account: NonNullable<AccountInput>,
): CreditAccountSummary {
  return {
    approvedLimit: toDecimal(account.approvedLimit).toFixed(2),
    availableLimit: toDecimal(account.availableLimit).toFixed(2),
    utilizedAmount: toDecimal(account.utilizedAmount).toFixed(2),
    outstandingAmount: toDecimal(account.outstandingAmount).toFixed(2),
    overdueAmount: toDecimal(account.overdueAmount).toFixed(2),
    currency: account.currency,
    creditTermDays: account.creditTermDays,
    approvedAt: account.approvedAt,
    expiresAt: account.expiresAt,
    reviewAt: account.reviewAt,
  };
}

const REQUEST_CTA = {
  type: 'REQUEST_CREDIT',
  label: 'Request Credit',
} as const;
const VIEW_CTA = {
  type: 'VIEW_APPLICATION',
  label: 'View application status',
} as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseTenureDays(value: unknown): number[] {
  const collected: number[] = [];
  const push = (entry: unknown) => {
    if (typeof entry === 'number' && (entry === 15 || entry === 30)) {
      collected.push(entry);
      return;
    }
    const text = String(entry ?? '')
      .toUpperCase()
      .replace(/\s+/g, '');
    if (text.includes('15') || text === 'NET15' || text === 'CREDIT_15') {
      collected.push(15);
    }
    if (text.includes('30') || text === 'NET30' || text === 'CREDIT_30') {
      collected.push(30);
    }
  };
  if (Array.isArray(value)) {
    value.forEach(push);
  } else if (value != null) {
    push(value);
  }
  return [...new Set(collected)];
}

function booleanFlag(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
      return false;
    }
  }
  return null;
}

/**
 * Product/offer credit configuration. Independent of the customer account.
 *
 * Source of truth (first match wins for opt-out / explicit tenures):
 * 1. `offer.paymentTerms` JSON (`platformCredit`, `allowCredit`, `creditTenures`,
 *    `acceptedMethods`)
 * 2. `offer.metadata` (`platformCredit`, `creditTenures`)
 * 3. `product.technicalSpecs.creditEligible`
 *
 * Default: marketplace facility is available for Net-15 and Net-30 unless the
 * offer/product opts out. Sellers cannot price credit; this only gates whether
 * PetroTrade platform credit may be offered on the listing.
 */
export function resolveProductCredit(input: {
  paymentTerms?: unknown;
  metadata?: unknown;
  technicalSpecs?: unknown;
  fallback?: ProductCreditConfig;
}): ProductCreditConfig {
  const fallback = input.fallback ?? DEFAULT_PRODUCT_CREDIT;
  const terms = asRecord(input.paymentTerms);
  const meta = asRecord(input.metadata);
  const specs = asRecord(input.technicalSpecs);

  const explicitFalse =
    booleanFlag(terms?.platformCredit) === false ||
    booleanFlag(terms?.allowCredit) === false ||
    booleanFlag(terms?.allowPlatformCredit) === false ||
    booleanFlag(meta?.platformCredit) === false ||
    booleanFlag(specs?.creditEligible) === false;
  if (explicitFalse) {
    return { supported: false, tenureDays: [] };
  }

  const tenureDays = [
    ...parseTenureDays(terms?.creditTenures),
    ...parseTenureDays(terms?.platformCreditTenures),
    ...parseTenureDays(meta?.creditTenures),
    ...parseTenureDays(terms?.acceptedMethods),
    ...parseTenureDays(terms?.allowedPaymentMethods),
    ...parseTenureDays(terms?.methods),
  ].filter((days) => days === 15 || days === 30);
  const uniqueTenures = [...new Set(tenureDays)];
  if (uniqueTenures.length > 0) {
    return { supported: true, tenureDays: uniqueTenures.sort((a, b) => a - b) };
  }

  const explicitTrue =
    booleanFlag(terms?.platformCredit) === true ||
    booleanFlag(terms?.allowCredit) === true ||
    booleanFlag(terms?.allowPlatformCredit) === true ||
    booleanFlag(meta?.platformCredit) === true ||
    booleanFlag(specs?.creditEligible) === true;
  if (explicitTrue) {
    return { supported: true, tenureDays: [15, 30] };
  }

  return {
    supported: fallback.supported,
    tenureDays: fallback.supported ? [...fallback.tenureDays] : [],
  };
}

/**
 * Intersect customer-authorized tenures with product-supported tenures.
 * When the product does not support credit the informational card is suppressed.
 */
export function applyProductCreditGate(
  credit: CreditAccessView,
  productCredit: ProductCreditConfig,
): CreditAccessView {
  if (!productCredit.supported || productCredit.tenureDays.length === 0) {
    return {
      ...credit,
      eligible: false,
      canApply: false,
      cta: null,
      tenureOptions: [],
      productSupported: false,
      reason: 'PRODUCT_CREDIT_UNAVAILABLE',
      title: '',
      message: '',
    };
  }

  const allowed = new Set(productCredit.tenureDays);
  const tenureOptions = credit.tenureOptions.filter((tenure) =>
    allowed.has(tenure.tenureDays),
  );
  if (credit.eligible && tenureOptions.length === 0) {
    return {
      ...credit,
      eligible: false,
      tenureOptions: [],
      productSupported: true,
      reason: 'CREDIT_TENURE_UNAVAILABLE',
      title: 'Credit tenure not available for this grade',
      message:
        'Your approved credit terms are not offered on this product. Other payment methods remain available.',
      cta: null,
    };
  }
  return {
    ...credit,
    eligible: credit.eligible && tenureOptions.length > 0,
    tenureOptions,
    productSupported: true,
  };
}

/** True when the UI should render a credit information card (never a blank placeholder). */
export function shouldRenderCreditInfo(
  credit: CreditAccessView | null | undefined,
): boolean {
  if (!credit) return false;
  if (credit.productSupported === false) return false;
  return Boolean(credit.title?.trim() || credit.message?.trim() || credit.cta);
}

export function productAllowsCreditTenure(
  productCredit: ProductCreditConfig,
  paymentMethod: PaymentMethod,
): boolean {
  if (!productCredit.supported || productCredit.tenureDays.length === 0) {
    return false;
  }
  const days = tenureDaysForMethod(paymentMethod);
  if (days == null) return false;
  return productCredit.tenureDays.includes(days);
}

/**
 * Resolves the customer's credit access state for a given order amount.
 * Pure: callers load the account + latest application and pass them in.
 */
export function resolveCreditAccess(input: {
  account: AccountInput;
  latestApplication: ApplicationInput;
  amount?: Moneyish;
  now?: Date;
}): CreditAccessView {
  const now = input.now ?? new Date();
  const application = input.latestApplication
    ? summarizeApplication(input.latestApplication)
    : null;
  const account = input.account;
  const base = {
    application,
    account: null as CreditAccountSummary | null,
    tenureOptions: [] as CreditAccessView['tenureOptions'],
    productSupported: true,
  };

  // 1. An active account decides first: it is the authoritative source.
  if (account && account.status === CreditStatus.APPROVED) {
    const summary = summarizeAccount(account);
    if (account.accountStatus === CreditAccountStatus.SUSPENDED) {
      return {
        ...base,
        account: summary,
        state: 'SUSPENDED',
        eligible: false,
        reason: 'CREDIT_SUSPENDED',
        canApply: false,
        title: 'Credit account suspended',
        message:
          'Your business credit account is currently suspended. Other payment methods remain available.',
        cta: { type: 'CONTACT_SUPPORT', label: 'Contact support' },
      };
    }
    if (account.accountStatus === CreditAccountStatus.BLOCKED) {
      return {
        ...base,
        account: summary,
        state: 'BLOCKED',
        eligible: false,
        reason: 'CREDIT_BLOCKED',
        canApply: false,
        title: 'Credit account on hold',
        message:
          'Your business credit account is on hold. Other payment methods remain available.',
        cta: { type: 'CONTACT_SUPPORT', label: 'Contact support' },
      };
    }
    const expired =
      account.accountStatus === CreditAccountStatus.EXPIRED ||
      (account.expiresAt != null &&
        account.expiresAt.getTime() < now.getTime());
    if (expired) {
      return {
        ...base,
        account: summary,
        state: 'EXPIRED',
        eligible: false,
        reason: 'CREDIT_EXPIRED',
        canApply: true,
        title: 'Credit terms expired',
        message:
          'Your approved credit terms have expired. Request a review to restore credit payment options.',
        cta: { type: 'REQUEST_CREDIT', label: 'Request renewal' },
      };
    }
    if (account.accountStatus === CreditAccountStatus.CLOSED) {
      return {
        ...base,
        account: summary,
        state: 'CLOSED',
        eligible: false,
        reason: 'CREDIT_CLOSED',
        canApply: true,
        title: 'Credit account closed',
        message:
          'Your business credit account is closed. You can request credit terms again.',
        cta: REQUEST_CTA,
      };
    }

    const tenureOptions = availableCreditTenures(account.creditTermDays);
    const available = toDecimal(account.availableLimit);
    const amount = toDecimal(input.amount ?? 0);
    if (amount.gt(0) && available.lt(amount)) {
      return {
        ...base,
        account: summary,
        tenureOptions,
        state: 'LIMIT_EXCEEDED',
        eligible: false,
        reason: 'CREDIT_LIMIT_EXCEEDED',
        canApply: false,
        title: 'Order exceeds available credit',
        message: `This order (${account.currency} ${amount.toFixed(2)}) is above your available credit of ${account.currency} ${available.toFixed(2)}. Reduce the quantity or choose another payment method.`,
        cta: null,
      };
    }
    return {
      ...base,
      account: summary,
      tenureOptions,
      state: 'APPROVED',
      eligible: tenureOptions.length > 0,
      reason: tenureOptions.length > 0 ? null : 'CREDIT_TENURE_UNAVAILABLE',
      canApply: false,
      title: 'Business credit active',
      message:
        tenureOptions.length > 0
          ? 'Pay later on approved PetroTrade credit terms.'
          : 'Your approved credit term does not match a selectable tenure. Contact support.',
      cta: null,
    };
  }

  // 2. No active account: the latest application decides.
  if (input.latestApplication) {
    const latest = input.latestApplication;
    if (isResubmissionRequested(latest)) {
      return {
        ...base,
        state: 'ACTION_REQUIRED',
        eligible: false,
        reason: 'CREDIT_APPLICATION_ACTION_REQUIRED',
        canApply: false,
        title: 'Changes requested on your application',
        message:
          latest.customerMessage ??
          'Our credit team asked for changes. Update your application and submit it again.',
        cta: { type: 'CONTINUE_APPLICATION', label: 'Update application' },
      };
    }
    if (latest.status === CreditApplicationStatus.DRAFT) {
      return {
        ...base,
        state: 'APPLICATION_DRAFT',
        eligible: false,
        reason: 'CREDIT_APPLICATION_DRAFT',
        canApply: false,
        title: 'Finish your credit application',
        message:
          'You started a business credit application. Complete and submit it for review.',
        cta: { type: 'CONTINUE_APPLICATION', label: 'Continue application' },
      };
    }
    if (latest.status === CreditApplicationStatus.DOCUMENTS_REQUIRED) {
      return {
        ...base,
        state: 'ACTION_REQUIRED',
        eligible: false,
        reason: 'CREDIT_DOCUMENTS_REQUIRED',
        canApply: false,
        title: 'Additional documents required',
        message:
          latest.customerMessage ??
          'Our credit team needs additional documents to continue the review.',
        cta: { type: 'UPLOAD_DOCUMENTS', label: 'Upload documents' },
      };
    }
    if (PENDING_STATUSES.includes(latest.status)) {
      return {
        ...base,
        state: 'APPLICATION_PENDING',
        eligible: false,
        reason: 'CREDIT_APPLICATION_PENDING',
        canApply: false,
        title: 'Credit application under review',
        message:
          'Credit terms become available after review and approval. Other payment methods remain available.',
        cta: VIEW_CTA,
      };
    }
    if (latest.status === CreditApplicationStatus.REJECTED) {
      return {
        ...base,
        state: 'REJECTED',
        eligible: false,
        reason: 'CREDIT_APPLICATION_REJECTED',
        canApply: true,
        title: 'Credit application not approved',
        message:
          latest.customerMessage ??
          'Your previous application was not approved. You may submit a new request.',
        cta: { type: 'REQUEST_CREDIT', label: 'Request credit again' },
      };
    }
    if (
      (latest.status === CreditApplicationStatus.APPROVED ||
        latest.status === CreditApplicationStatus.PARTIALLY_APPROVED) &&
      !account
    ) {
      // Approved application whose account has not been activated yet.
      return {
        ...base,
        state: 'APPLICATION_PENDING',
        eligible: false,
        reason: 'CREDIT_ACCOUNT_ACTIVATION_PENDING',
        canApply: false,
        title: 'Credit arrangement being finalised',
        message:
          'Your application was approved and your credit account is being activated.',
        cta: VIEW_CTA,
      };
    }
    // EXPIRED / CANCELLED applications fall through to a fresh request.
  }

  // 3. Account mirror exists but is not approved (legacy rows without an application).
  if (
    account &&
    (account.status === CreditStatus.PENDING ||
      account.status === CreditStatus.UNDER_REVIEW ||
      account.status === CreditStatus.DOCUMENTS_REQUIRED)
  ) {
    {
      return {
        ...base,
        state: 'APPLICATION_PENDING',
        eligible: false,
        reason: 'CREDIT_APPLICATION_PENDING',
        canApply: false,
        title: 'Credit application under review',
        message:
          'Credit terms become available after review and approval. Other payment methods remain available.',
        cta: application ? VIEW_CTA : null,
      };
    }
  }

  return {
    ...base,
    state: 'NOT_APPLIED',
    eligible: false,
    reason: 'CREDIT_NOT_ELIGIBLE',
    canApply: true,
    title: 'Business Credit Available',
    message:
      'This grade supports Credit 15 Days and Credit 30 Days. Request credit to unlock Net terms after review — credit options stay visible before you apply.',
    cta: REQUEST_CTA,
  };
}

export type StandardPaymentPolicy = {
  advanceDiscountBps: number;
  /** Methods enabled by platform configuration for this customer/order. */
  enabledMethods: PaymentMethod[];
};

export const DEFAULT_STANDARD_METHODS: PaymentMethod[] = [
  PaymentMethod.ADVANCE,
  PaymentMethod.ON_LOADING,
  PaymentMethod.ON_DELIVERY,
];

const STANDARD_OPTION_COPY: Record<
  string,
  { title: string; description: string; dueLabel: string }
> = {
  ADVANCE: {
    title: 'Advance',
    description: 'Pay against the Proforma Invoice to lock the quoted price.',
    dueLabel: 'Due before dispatch',
  },
  ON_LOADING: {
    title: 'On Loading',
    description:
      'Pay once the material is loaded and the loading proof is shared.',
    dueLabel: 'Due at loading confirmation',
  },
  ON_DELIVERY: {
    title: 'On Delivery',
    description: 'Pay when the material is delivered and acknowledged.',
    dueLabel: 'Due at delivery confirmation',
  },
};

export function buildStandardPaymentOptions(
  policy: StandardPaymentPolicy,
): PaymentOptionView[] {
  return policy.enabledMethods
    .filter((method) => STANDARD_OPTION_COPY[method])
    .map((method) => {
      const copy = STANDARD_OPTION_COPY[method];
      const discountBps =
        method === PaymentMethod.ADVANCE
          ? Math.max(0, policy.advanceDiscountBps)
          : 0;
      return {
        paymentOption: method,
        kind: 'STANDARD',
        title: copy.title,
        description: copy.description,
        dueLabel: copy.dueLabel,
        benefitLabel:
          discountBps > 0
            ? `Save ${formatBps(discountBps)} with advance payment`
            : null,
        discountBps,
        tenureDays: null,
        eligible: true,
      };
    });
}

function creditUnlockBenefit(credit: CreditAccessView): string {
  switch (credit.cta?.type) {
    case 'REQUEST_CREDIT':
      return credit.cta.label || 'Request Credit to unlock';
    case 'CONTINUE_APPLICATION':
      return credit.cta.label || 'Complete application to unlock';
    case 'UPLOAD_DOCUMENTS':
      return credit.cta.label || 'Upload documents to unlock';
    case 'VIEW_APPLICATION':
      return 'Available after approval';
    case 'CONTACT_SUPPORT':
      return credit.cta.label || 'Contact support';
    default:
      break;
  }
  if (credit.state === 'LIMIT_EXCEEDED') return 'Exceeds available credit';
  if (credit.state === 'APPLICATION_PENDING') return 'Available after approval';
  return 'Request Credit to unlock';
}

function toCreditPaymentOption(
  tenure: {
    paymentOption: PaymentMethod;
    tenureDays: number;
    label: string;
  },
  eligible: boolean,
  credit: CreditAccessView,
): PaymentOptionView {
  return {
    paymentOption: tenure.paymentOption,
    kind: 'CREDIT',
    title: tenure.label,
    description: eligible
      ? 'PolyStoreX managed working-capital credit. The seller does not extend credit.'
      : 'Available on this grade. Request credit to unlock Net terms at checkout.',
    dueLabel: `Due ${tenure.tenureDays} days after invoice`,
    benefitLabel: eligible ? null : creditUnlockBenefit(credit),
    discountBps: 0,
    tenureDays: tenure.tenureDays,
    eligible,
  };
}

/**
 * Credit tenures for the payment-method list.
 *
 * - Product opt-out → no credit rows.
 * - Customer eligible → selectable tenures from the approved facility ∩ product.
 * - Otherwise → locked product tenures stay visible (Amazon-style discovery) with
 *   a Request Credit / status benefit so customers can apply without guessing.
 */
export function buildCreditPaymentOptions(
  credit: CreditAccessView,
  productCredit: ProductCreditConfig = DEFAULT_PRODUCT_CREDIT,
): PaymentOptionView[] {
  if (
    credit.productSupported === false ||
    !productCredit.supported ||
    productCredit.tenureDays.length === 0
  ) {
    return [];
  }

  if (credit.eligible) {
    return credit.tenureOptions.map((tenure) =>
      toCreditPaymentOption(tenure, true, credit),
    );
  }

  // Approved facility with a temporary block (e.g. limit) — show authorized tenures locked.
  if (credit.tenureOptions.length > 0) {
    return credit.tenureOptions.map((tenure) =>
      toCreditPaymentOption(tenure, false, credit),
    );
  }

  // Tenure mismatch after approval — do not advertise unsupported tenures.
  if (
    credit.state === 'APPROVED' ||
    credit.reason === 'CREDIT_TENURE_UNAVAILABLE'
  ) {
    return [];
  }

  const previewTenures = SUPPORTED_CREDIT_TENURES.filter((tenure) =>
    productCredit.tenureDays.includes(tenure.tenureDays),
  );
  return previewTenures.map((tenure) =>
    toCreditPaymentOption(tenure, false, credit),
  );
}

export function formatBps(bps: number): string {
  const percent = bps / 100;
  return Number.isInteger(percent)
    ? `${percent.toFixed(0)}%`
    : `${percent.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
}
