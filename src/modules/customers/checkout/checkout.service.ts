import { Injectable } from '@nestjs/common';
import {
  PaymentMethod,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { isPlatformCredit } from '../../payments/common/platform-credit.js';
import { CreditEligibilityService } from '../../payments/services/credit-eligibility.service.js';
import { mapCustomerPaymentMethod } from '../cart/cart.service.js';
import { toBlindOffer } from '../common/blind-marketplace.mapper.js';
import {
  CustomerContext,
  CustomerContextService,
} from '../common/customer-context.service.js';
import { CheckoutException } from './checkout.errors.js';
import type { CreateCheckoutQuoteDto } from './checkout.dto.js';
import {
  buildPricingVersion,
  calculateQuoteAmounts,
  DEFAULT_COMMERCE_PRICING,
  moneyString,
  platformDiscountBps,
  unitPriceString,
} from './commerce-pricing.js';
import {
  SellerMatchingService,
  type SellerMatch,
} from './seller-matching.service.js';

export type CustomerQuoteDto = {
  quoteId: string;
  productId: string;
  offerId: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  baseAmount: string;
  discountAmount: string;
  freightAmount: string;
  taxAmount: string;
  taxRate: string;
  platformFee: string;
  insuranceAmount: string;
  insuranceIncluded: boolean;
  totalAmount: string;
  currency: string;
  paymentOption: PaymentMethod;
  paymentLabel: string;
  expiresAt: string;
  pricingVersion: string;
  matchStrategy: string;
  moq: string | null;
  quantityAvailable: string;
  quantityIncrement: string;
  leadTime: string | null;
  product: { id: string; code: string; name: string; packaging: string | null };
  grade: {
    id: string;
    code: string;
    name: string;
    displayName: string;
  } | null;
  offer: ReturnType<typeof toBlindOffer>;
  shippingAddressId: string | null;
  billingAddressId: string | null;
};

const PAYMENT_LABELS: Record<string, string> = {
  ADVANCE: 'Advance',
  ON_LOADING: 'On Loading',
  ON_DELIVERY: 'On Delivery',
  CREDIT: 'PetroTrade Credit',
  CREDIT_15: 'PetroTrade Credit — 15 Days',
  CREDIT_30: 'PetroTrade Credit — 30 Days',
  BEFORE_DISPATCH: 'Before Dispatch',
};

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerContext: CustomerContextService,
    private readonly sellerMatching: SellerMatchingService,
    private readonly creditEligibility: CreditEligibilityService,
  ) {}

  private async ctx(userId: string) {
    return this.customerContext.requireCustomer(userId);
  }

  async listAddresses(userId: string) {
    const ctx = await this.ctx(userId);
    const rows = await this.prisma.address.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        isActive: true,
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      label: row.label ?? row.city,
      line1: row.line1,
      line2: row.line2,
      city: row.city,
      state: row.state,
      country: row.country,
      postalCode: row.postalCode,
      landmark: row.landmark,
      isDefault: row.isDefault,
    }));
  }

  async paymentOptions(userId: string, amount?: number) {
    const ctx = await this.ctx(userId);
    const credit = await this.creditEligibility.inspect(
      this.prisma,
      ctx.organizationId,
      amount ?? 0,
    );

    return {
      source: 'PETROTRADE',
      credit: {
        eligible: credit.eligible,
        reason: credit.reason,
        approvedLimit: credit.approvedLimit,
        availableLimit: credit.availableLimit,
        tenureOptions: credit.tenureOptions,
      },
      options: [
        {
          paymentOption: PaymentMethod.ADVANCE,
          title: PAYMENT_LABELS.ADVANCE,
          description: 'Pay against the Proforma Invoice to lock the quoted price.',
          benefitLabel:
            DEFAULT_COMMERCE_PRICING.advanceDiscountBps > 0
              ? `${(DEFAULT_COMMERCE_PRICING.advanceDiscountBps / 100).toFixed(0)}% Platform Discount Eligible`
              : 'Preferred pricing',
          eligible: true,
          discountBps: DEFAULT_COMMERCE_PRICING.advanceDiscountBps,
        },
        {
          paymentOption: PaymentMethod.ON_LOADING,
          title: PAYMENT_LABELS.ON_LOADING,
          description: 'Pay after loading confirmation.',
          benefitLabel: 'Standard terms',
          eligible: true,
          discountBps: 0,
        },
        {
          paymentOption: PaymentMethod.ON_DELIVERY,
          title: PAYMENT_LABELS.ON_DELIVERY,
          description: 'Pay after delivery confirmation.',
          benefitLabel: 'Standard terms',
          eligible: true,
          discountBps: 0,
        },
        {
          paymentOption: PaymentMethod.CREDIT_15,
          title: PAYMENT_LABELS.CREDIT_15,
          description: 'PetroTrade managed working-capital credit. Seller does not extend credit.',
          benefitLabel: credit.eligible ? 'Approved limit available' : 'Approval required',
          eligible: credit.eligible,
          discountBps: 0,
        },
        {
          paymentOption: PaymentMethod.CREDIT_30,
          title: PAYMENT_LABELS.CREDIT_30,
          description: 'PetroTrade managed working-capital credit. Seller does not extend credit.',
          benefitLabel: credit.eligible ? 'Approved limit available' : 'Approval required',
          eligible: credit.eligible,
          discountBps: 0,
        },
      ],
    };
  }

  async quote(userId: string, dto: CreateCheckoutQuoteDto) {
    const ctx = await this.ctx(userId);
    if (!dto.offerId && !dto.productId) {
      throw new CheckoutException(
        'OFFER_NOT_FOUND',
        'productId or offerId is required',
      );
    }
    await this.assertAddress(ctx, dto.shippingAddressId);
    await this.assertAddress(ctx, dto.billingAddressId);

    const paymentMethod = mapCustomerPaymentMethod(
      dto.paymentOption ?? 'ADVANCE',
    );
    if (!paymentMethod) {
      throw new CheckoutException('PAYMENT_OPTION_UNAVAILABLE');
    }

    const match = await this.sellerMatching.match({
      offerId: dto.offerId,
      productId: dto.productId,
      quantity: dto.quantity,
      increment: DEFAULT_COMMERCE_PRICING.quantityIncrement,
    });

    const amounts = calculateQuoteAmounts({
      unitPrice: match.unitPrice,
      quantity: dto.quantity,
      paymentMethod,
    });

    if (isPlatformCredit(paymentMethod)) {
      const eligibility = await this.creditEligibility.inspect(
        this.prisma,
        ctx.organizationId,
        amounts.totalAmount,
      );
      if (!eligibility.eligible) {
        throw new CheckoutException(
          eligibility.reason === 'CREDIT_LIMIT_EXCEEDED'
            ? 'CREDIT_LIMIT_EXCEEDED'
            : 'CREDIT_NOT_ELIGIBLE',
          'PetroTrade credit is not available for this purchase',
        );
      }
    }

    const pricingVersion = buildPricingVersion({
      offerId: match.offer.id,
      unitPrice: unitPriceString(amounts.unitPrice),
      quantity: amounts.quantity.toFixed(3),
      paymentMethod,
      taxBps: amounts.taxBps,
      freightPerMt: DEFAULT_COMMERCE_PRICING.freightPerMt,
      discountBps: platformDiscountBps(paymentMethod),
      platformFee: moneyString(amounts.platformFee),
      insuranceAmount: moneyString(amounts.insuranceAmount),
    });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + DEFAULT_COMMERCE_PRICING.quoteTtlMs);
    const snapshot = this.commercialSnapshot(match, amounts, paymentMethod, pricingVersion);

    const created = await this.prisma.checkoutQuote.create({
      data: {
        customerOrgId: ctx.organizationId,
        customerProfileId: ctx.customerProfileId,
        productId: match.offer.productId,
        offerId: match.offer.id,
        gradeId: match.offer.gradeId,
        sellerOrgId: match.offer.organizationId,
        quantity: amounts.quantity,
        unit: match.offer.unit ?? 'MT',
        paymentMethod,
        shippingAddressId: dto.shippingAddressId,
        billingAddressId: dto.billingAddressId,
        unitPrice: amounts.unitPrice,
        baseAmount: amounts.baseAmount,
        discountAmount: amounts.discountAmount,
        freightAmount: amounts.freightAmount,
        taxAmount: amounts.taxAmount,
        taxBps: amounts.taxBps,
        platformFee: amounts.platformFee,
        insuranceAmount: amounts.insuranceAmount,
        totalAmount: amounts.totalAmount,
        currency: match.offer.currency,
        pricingVersion,
        matchStrategy: match.strategy,
        snapshot,
        expiresAt,
      },
    });

    return this.toCustomerQuote(created, match);
  }

  async getQuote(userId: string, quoteId: string) {
    const ctx = await this.ctx(userId);
    const quote = await this.prisma.checkoutQuote.findFirst({
      where: {
        id: quoteId,
        customerOrgId: ctx.organizationId,
      },
    });
    if (!quote) {
      throw new CheckoutException('QUOTE_NOT_FOUND', 'Quote not found');
    }
    if (quote.consumedAt) {
      throw new CheckoutException(
        'QUOTE_CONSUMED',
        'This quote has already been used',
      );
    }
    if (quote.expiresAt.getTime() <= Date.now()) {
      throw new CheckoutException(
        'QUOTE_EXPIRED',
        'This quote has expired. Please review the latest price.',
      );
    }
    const match = await this.sellerMatching.match({
      offerId: quote.offerId,
      quantity: Number(quote.quantity),
      increment: DEFAULT_COMMERCE_PRICING.quantityIncrement,
    });
    return this.toCustomerQuote(quote, match);
  }

  async assertFreshQuote(userId: string, quoteId: string, tx?: Prisma.TransactionClient) {
    const ctx = await this.ctx(userId);
    const db = tx ?? this.prisma;
    const quote = await db.checkoutQuote.findFirst({
      where: {
        id: quoteId,
        customerOrgId: ctx.organizationId,
      },
    });
    if (!quote) {
      throw new CheckoutException('QUOTE_NOT_FOUND', 'Quote not found');
    }
    if (quote.consumedAt) {
      throw new CheckoutException(
        'QUOTE_CONSUMED',
        'This quote has already been used',
      );
    }
    if (quote.expiresAt.getTime() <= Date.now()) {
      throw new CheckoutException(
        'QUOTE_EXPIRED',
        'This quote has expired. Please review the latest price.',
      );
    }

    await this.assertAddress(ctx, quote.shippingAddressId ?? undefined);
    await this.assertAddress(ctx, quote.billingAddressId ?? undefined);

    const match = await this.sellerMatching.match({
      offerId: quote.offerId,
      quantity: Number(quote.quantity),
      increment: DEFAULT_COMMERCE_PRICING.quantityIncrement,
      tx,
    });
    const amounts = calculateQuoteAmounts({
      unitPrice: match.unitPrice,
      quantity: Number(quote.quantity),
      paymentMethod: quote.paymentMethod,
    });
    const pricingVersion = buildPricingVersion({
      offerId: match.offer.id,
      unitPrice: unitPriceString(amounts.unitPrice),
      quantity: amounts.quantity.toFixed(3),
      paymentMethod: quote.paymentMethod,
      taxBps: amounts.taxBps,
      freightPerMt: DEFAULT_COMMERCE_PRICING.freightPerMt,
      discountBps: platformDiscountBps(quote.paymentMethod),
      platformFee: moneyString(amounts.platformFee),
      insuranceAmount: moneyString(amounts.insuranceAmount),
    });

    if (pricingVersion !== quote.pricingVersion) {
      const latest = await this.quote(userId, {
        offerId: match.offer.id,
        productId: match.offer.productId,
        quantity: Number(quote.quantity),
        paymentOption: quote.paymentMethod,
        shippingAddressId: quote.shippingAddressId ?? undefined,
        billingAddressId: quote.billingAddressId ?? undefined,
      });
      throw new CheckoutException(
        'QUOTE_CHANGED',
        'The price or availability has changed. Please review the latest quote.',
        { latestQuote: latest },
      );
    }

    if (isPlatformCredit(quote.paymentMethod)) {
      await this.creditEligibility.assertEligible(
        db,
        ctx.organizationId,
        amounts.totalAmount,
      );
    }

    return { ctx, quote, match, amounts };
  }

  private async assertAddress(ctx: CustomerContext, addressId?: string | null) {
    if (!addressId) return;
    const address = await this.prisma.address.findFirst({
      where: {
        id: addressId,
        organizationId: ctx.organizationId,
        deletedAt: null,
        isActive: true,
      },
    });
    if (!address) {
      throw new CheckoutException(
        'ADDRESS_NOT_FOUND',
        'Address not found for this customer organization',
      );
    }
  }

  private commercialSnapshot(
    match: SellerMatch,
    amounts: ReturnType<typeof calculateQuoteAmounts>,
    paymentMethod: PaymentMethod,
    pricingVersion: string,
  ) {
    return {
      pricingEngine: 'petrotrade-commerce-v1',
      pricingVersion,
      matchStrategy: match.strategy,
      paymentOption: paymentMethod,
      unitPrice: unitPriceString(amounts.unitPrice),
      quantity: amounts.quantity.toFixed(3),
      unit: match.offer.unit ?? 'MT',
      baseAmount: moneyString(amounts.baseAmount),
      discountAmount: moneyString(amounts.discountAmount),
      freightAmount: moneyString(amounts.freightAmount),
      taxAmount: moneyString(amounts.taxAmount),
      taxBps: amounts.taxBps,
      platformFee: moneyString(amounts.platformFee),
      insuranceAmount: moneyString(amounts.insuranceAmount),
      totalAmount: moneyString(amounts.totalAmount),
      offerId: match.offer.id,
      productId: match.offer.productId,
      gradeId: match.offer.gradeId,
    };
  }

  private toCustomerQuote(
    quote: {
      id: string;
      productId: string;
      offerId: string;
      quantity: Prisma.Decimal;
      unit: string;
      unitPrice: Prisma.Decimal;
      baseAmount: Prisma.Decimal;
      discountAmount: Prisma.Decimal;
      freightAmount: Prisma.Decimal;
      taxAmount: Prisma.Decimal;
      taxBps: number;
      platformFee: Prisma.Decimal;
      insuranceAmount: Prisma.Decimal;
      totalAmount: Prisma.Decimal;
      currency: string;
      paymentMethod: PaymentMethod;
      expiresAt: Date;
      pricingVersion: string;
      matchStrategy: string;
      shippingAddressId: string | null;
      billingAddressId: string | null;
    },
    match: SellerMatch,
  ): CustomerQuoteDto {
    return {
      quoteId: quote.id,
      productId: quote.productId,
      offerId: quote.offerId,
      quantity: quote.quantity.toFixed(3),
      unit: quote.unit,
      unitPrice: unitPriceString(quote.unitPrice),
      baseAmount: moneyString(quote.baseAmount),
      discountAmount: moneyString(quote.discountAmount),
      freightAmount: moneyString(quote.freightAmount),
      taxAmount: moneyString(quote.taxAmount),
      taxRate: (quote.taxBps / 100).toFixed(2),
      platformFee: moneyString(quote.platformFee),
      insuranceAmount: moneyString(quote.insuranceAmount),
      insuranceIncluded: toDecimalSafe(quote.insuranceAmount),
      totalAmount: moneyString(quote.totalAmount),
      currency: quote.currency,
      paymentOption: quote.paymentMethod,
      paymentLabel: PAYMENT_LABELS[quote.paymentMethod] ?? quote.paymentMethod,
      expiresAt: quote.expiresAt.toISOString(),
      pricingVersion: quote.pricingVersion,
      matchStrategy: quote.matchStrategy,
      moq: match.offer.moq != null ? String(match.offer.moq) : null,
      quantityAvailable: String(match.offer.quantity),
      quantityIncrement: DEFAULT_COMMERCE_PRICING.quantityIncrement,
      leadTime: match.offer.deliveryTerms,
      product: {
        id: match.offer.product.id,
        code: match.offer.product.code,
        name: match.offer.product.name,
        packaging: match.offer.product.packaging,
      },
      grade: match.offer.grade
        ? {
            id: match.offer.grade.id,
            code: match.offer.grade.code,
            name: match.offer.grade.name,
            displayName: match.offer.grade.displayName ?? match.offer.grade.name,
          }
        : null,
      offer: toBlindOffer(match.offer),
      shippingAddressId: quote.shippingAddressId,
      billingAddressId: quote.billingAddressId,
    };
  }
}

function toDecimalSafe(value: Prisma.Decimal): boolean {
  return value.isZero();
}
