import { PaymentMethod } from '../../../generated/prisma/client.js';
import {
  hasSellerCreditPricing,
  isPlatformCredit,
  isSellerCreditPriceTier,
  sanitizeSellerPaymentTerms,
  sellerPlatformCreditStatus,
} from './platform-credit.js';

describe('platform credit helpers', () => {
  it('treats CREDIT, CREDIT_15 and CREDIT_30 as platform credit', () => {
    expect(isPlatformCredit(PaymentMethod.CREDIT)).toBe(true);
    expect(isPlatformCredit(PaymentMethod.CREDIT_15)).toBe(true);
    expect(isPlatformCredit(PaymentMethod.CREDIT_30)).toBe(true);
    expect(isPlatformCredit(PaymentMethod.ADVANCE)).toBe(false);
  });

  it('never exposes customer limits in seller status', () => {
    expect(
      sellerPlatformCreditStatus({
        paymentMethod: PaymentMethod.CREDIT,
        reserved: true,
        accountActive: true,
      }),
    ).toBe('PLATFORM_CREDIT_APPROVED');
    expect(
      sellerPlatformCreditStatus({
        paymentMethod: PaymentMethod.CREDIT,
        reserved: false,
        accountActive: false,
      }),
    ).toBe('PLATFORM_CREDIT_BLOCKED');
    expect(
      JSON.stringify(
        sellerPlatformCreditStatus({
          paymentMethod: PaymentMethod.CREDIT,
          reserved: true,
        }),
      ),
    ).not.toMatch(/limit|score|interest/i);
  });

  it('strips seller-owned credit pricing keys', () => {
    const sanitized = sanitizeSellerPaymentTerms({
      supportedMethods: ['ADVANCE', 'CREDIT'],
      creditPrice: 120,
      sellerCreditInterest: 2.5,
      delivery: 'FOB',
    });
    expect(sanitized).toEqual({
      supportedMethods: ['ADVANCE', 'CREDIT'],
      delivery: 'FOB',
    });
    expect(hasSellerCreditPricing({ creditPrice: 99, moq: 10 })).toBe(true);
    expect(isSellerCreditPriceTier(PaymentMethod.CREDIT_30)).toBe(true);
    expect(isSellerCreditPriceTier(PaymentMethod.ADVANCE)).toBe(false);
  });
});
