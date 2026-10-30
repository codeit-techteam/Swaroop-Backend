import {
  CreditAccountStatus,
  CreditApplicationStatus,
  CreditStatus,
  PaymentMethod,
} from '../../../generated/prisma/client.js';
import { describe, expect, it } from 'vitest';
import {
  applyProductCreditGate,
  buildCreditPaymentOptions,
  buildStandardPaymentOptions,
  DEFAULT_PRODUCT_CREDIT,
  DEFAULT_STANDARD_METHODS,
  formatBps,
  productAllowsCreditTenure,
  resolveCreditAccess,
  resolveProductCredit,
  shouldRenderCreditInfo,
} from './payment-eligibility.js';

const account = {
  status: CreditStatus.APPROVED,
  accountStatus: CreditAccountStatus.ACTIVE,
  approvedLimit: '5000000',
  availableLimit: '2500000',
  utilizedAmount: '2500000',
  outstandingAmount: '1000000',
  overdueAmount: '0',
  currency: 'INR',
  creditTermDays: 30,
  approvedAt: new Date('2026-01-01'),
  expiresAt: new Date('2027-01-01'),
  reviewAt: null,
};

describe('resolveCreditAccess', () => {
  it('keeps locked credit tenures visible with Request Credit when the customer has not applied', () => {
    const credit = resolveCreditAccess({
      account: null,
      latestApplication: null,
      amount: 100000,
    });
    expect(credit.state).toBe('NOT_APPLIED');
    expect(credit.eligible).toBe(false);
    expect(credit.canApply).toBe(true);
    expect(credit.cta?.type).toBe('REQUEST_CREDIT');
    expect(credit.title).toBe('Business Credit Available');
    expect(credit.productSupported).toBe(true);
    const options = buildCreditPaymentOptions(credit);
    expect(options.map((row) => row.paymentOption)).toEqual([
      PaymentMethod.CREDIT_15,
      PaymentMethod.CREDIT_30,
    ]);
    expect(options.every((row) => row.eligible === false)).toBe(true);
    expect(options[0]?.benefitLabel).toMatch(/Request Credit/i);
    expect(shouldRenderCreditInfo(credit)).toBe(true);
  });

  it('shows pending status with locked product tenures while review is open', () => {
    const credit = resolveCreditAccess({
      account: null,
      latestApplication: {
        id: 'app-1',
        applicationNumber: 'CR-1',
        status: CreditApplicationStatus.UNDER_REVIEW,
        submittedAt: new Date('2026-10-01'),
        decidedAt: null,
        customerMessage: null,
      },
      amount: 100000,
    });
    expect(credit.state).toBe('APPLICATION_PENDING');
    expect(credit.eligible).toBe(false);
    expect(credit.canApply).toBe(false);
    expect(credit.cta?.type).toBe('VIEW_APPLICATION');
    const options = buildCreditPaymentOptions(credit);
    expect(options).toHaveLength(2);
    expect(options.every((row) => row.eligible === false)).toBe(true);
    expect(options[0]?.benefitLabel).toBe('Available after approval');
  });

  it('returns only approved tenures for an active credit account', () => {
    const credit = resolveCreditAccess({
      account: { ...account, creditTermDays: 15 },
      latestApplication: null,
      amount: 100000,
    });
    expect(credit.state).toBe('APPROVED');
    expect(credit.eligible).toBe(true);
    expect(credit.tenureOptions.map((row) => row.tenureDays)).toEqual([15]);
    const options = buildCreditPaymentOptions(credit);
    expect(options).toHaveLength(1);
    expect(options[0]?.paymentOption).toBe(PaymentMethod.CREDIT_15);
  });

  it('keeps authorized tenures locked when the order exceeds the available limit', () => {
    const credit = resolveCreditAccess({
      account,
      latestApplication: null,
      amount: 9_000_000,
    });
    expect(credit.state).toBe('LIMIT_EXCEEDED');
    expect(credit.eligible).toBe(false);
    const options = buildCreditPaymentOptions(credit);
    expect(options.map((row) => row.tenureDays)).toEqual([15, 30]);
    expect(options.every((row) => row.eligible === false)).toBe(true);
    expect(options[0]?.benefitLabel).toBe('Exceeds available credit');
  });

  it.each([
    ['SUSPENDED', CreditAccountStatus.SUSPENDED, 'SUSPENDED'],
    ['BLOCKED', CreditAccountStatus.BLOCKED, 'BLOCKED'],
    ['EXPIRED', CreditAccountStatus.EXPIRED, 'EXPIRED'],
    ['CLOSED', CreditAccountStatus.CLOSED, 'CLOSED'],
  ] as const)(
    'shows locked product credit tenures when the account is %s',
    (_label, accountStatus, state) => {
      const credit = resolveCreditAccess({
        account: { ...account, accountStatus },
        latestApplication: null,
        amount: 100000,
      });
      expect(credit.state).toBe(state);
      expect(credit.eligible).toBe(false);
      const options = buildCreditPaymentOptions(credit);
      expect(options).toHaveLength(2);
      expect(options.every((row) => row.eligible === false)).toBe(true);
    },
  );

  it('lets a rejected applicant see locked tenures and request credit again', () => {
    const credit = resolveCreditAccess({
      account: null,
      latestApplication: {
        id: 'app-2',
        applicationNumber: 'CR-2',
        status: CreditApplicationStatus.REJECTED,
        submittedAt: new Date('2026-09-01'),
        decidedAt: new Date('2026-09-15'),
        customerMessage: 'Insufficient trading history',
      },
      amount: 100000,
    });
    expect(credit.state).toBe('REJECTED');
    expect(credit.eligible).toBe(false);
    expect(credit.canApply).toBe(true);
    const options = buildCreditPaymentOptions(credit);
    expect(options).toHaveLength(2);
    expect(options.every((row) => row.eligible === false)).toBe(true);
  });
});

describe('resolveProductCredit / applyProductCreditGate', () => {
  it('defaults to marketplace Net-15 and Net-30 unless the offer opts out', () => {
    expect(resolveProductCredit({})).toEqual(DEFAULT_PRODUCT_CREDIT);
    expect(
      resolveProductCredit({
        paymentTerms: { platformCredit: false },
      }),
    ).toEqual({ supported: false, tenureDays: [] });
    expect(
      resolveProductCredit({
        paymentTerms: { creditTenures: ['NET15'] },
      }),
    ).toEqual({ supported: true, tenureDays: [15] });
  });

  it('hides credit options when the product does not support credit', () => {
    const productCredit = { supported: false, tenureDays: [] as number[] };
    const credit = applyProductCreditGate(
      resolveCreditAccess({
        account: null,
        latestApplication: null,
        amount: 100000,
      }),
      productCredit,
    );
    expect(credit.productSupported).toBe(false);
    expect(credit.eligible).toBe(false);
    expect(credit.title).toBe('');
    expect(credit.cta).toBeNull();
    expect(shouldRenderCreditInfo(credit)).toBe(false);
    expect(buildCreditPaymentOptions(credit, productCredit)).toEqual([]);
  });

  it('intersects approved customer tenures with product-supported tenures', () => {
    const productOnly30 = { supported: true, tenureDays: [30] };
    const net15Only = applyProductCreditGate(
      resolveCreditAccess({
        account: { ...account, creditTermDays: 15 },
        latestApplication: null,
        amount: 100000,
      }),
      productOnly30,
    );
    expect(net15Only.eligible).toBe(false);
    expect(net15Only.reason).toBe('CREDIT_TENURE_UNAVAILABLE');
    expect(buildCreditPaymentOptions(net15Only, productOnly30)).toEqual([]);

    const productOnly15 = { supported: true, tenureDays: [15] };
    const shorterAllowed = applyProductCreditGate(
      resolveCreditAccess({
        account: { ...account, creditTermDays: 30 },
        latestApplication: null,
        amount: 100000,
      }),
      productOnly15,
    );
    expect(shorterAllowed.eligible).toBe(true);
    expect(shorterAllowed.tenureOptions.map((row) => row.tenureDays)).toEqual([
      15,
    ]);
    expect(
      productAllowsCreditTenure(
        { supported: true, tenureDays: [15] },
        PaymentMethod.CREDIT_15,
      ),
    ).toBe(true);
    expect(
      productAllowsCreditTenure(
        { supported: true, tenureDays: [15] },
        PaymentMethod.CREDIT_30,
      ),
    ).toBe(false);
  });

  it('previews only product-supported locked tenures when the customer has not applied', () => {
    const productCredit = { supported: true, tenureDays: [15, 30] };
    const credit = applyProductCreditGate(
      resolveCreditAccess({
        account: null,
        latestApplication: null,
        amount: 100000,
      }),
      productCredit,
    );
    expect(credit.state).toBe('NOT_APPLIED');
    expect(credit.cta?.type).toBe('REQUEST_CREDIT');
    expect(shouldRenderCreditInfo(credit)).toBe(true);
    expect(
      buildCreditPaymentOptions(credit, productCredit).map((row) => row.tenureDays),
    ).toEqual([15, 30]);
    expect(
      buildCreditPaymentOptions(credit, { supported: true, tenureDays: [30] }).map(
        (row) => row.tenureDays,
      ),
    ).toEqual([30]);
  });
});

describe('buildStandardPaymentOptions', () => {
  it('loads the configured advance discount instead of a hardcoded percent', () => {
    const options = buildStandardPaymentOptions({
      advanceDiscountBps: 500,
      enabledMethods: DEFAULT_STANDARD_METHODS,
    });
    const advance = options.find((row) => row.paymentOption === PaymentMethod.ADVANCE);
    expect(advance?.discountBps).toBe(500);
    expect(advance?.benefitLabel).toBe('Save 5% with advance payment');
    expect(formatBps(250)).toBe('2.5%');
  });
});
