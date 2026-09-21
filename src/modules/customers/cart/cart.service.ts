import { Injectable, NotFoundException } from '@nestjs/common';
import {
  EntityOwnerType,
  PaymentMethod,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  assertAvailability,
  assertMarketplaceOffer,
  MarketplaceException,
  resolveOfferUnitPrice,
  toBlindOffer,
} from '../common/blind-marketplace.mapper.js';
import { CustomerAuditService } from '../common/customer-audit.service.js';
import {
  CustomerContext,
  CustomerContextService,
} from '../common/customer-context.service.js';
import { offerInclude } from '../marketplace/marketplace.service.js';
import type {
  AddCartItemDto,
  UpdateCartItemDto,
  ValidateCartDto,
} from './cart.dto.js';

const ALLOWED_PAYMENT_METHODS = new Set([
  'ADVANCE',
  'BEFORE_DISPATCH',
  'ON_LOADING',
  'ON_DELIVERY',
  'CREDIT_15',
  'CREDIT_30',
  'CREDIT',
  'PARTIAL_ADVANCE',
  'PARTIAL_PAYMENT',
  'MILESTONE_PAYMENT',
]);

export function mapCustomerPaymentMethod(
  value?: string | null,
): PaymentMethod | null {
  if (value == null || value === '') return null;
  const normalized = value.trim().toUpperCase();
  if (!ALLOWED_PAYMENT_METHODS.has(normalized)) {
    throw new MarketplaceException(
      'INVALID_PAYMENT_METHOD',
      `Payment method must be one of: ${[...ALLOWED_PAYMENT_METHODS].join(', ')}`,
    );
  }
  if (normalized === 'CREDIT') return PaymentMethod.CREDIT;
  return normalized as PaymentMethod;
}

const cartItemInclude = {
  offer: { include: offerInclude },
  product: {
    select: {
      id: true,
      code: true,
      name: true,
      packaging: true,
      unit: true,
    },
  },
  grade: {
    select: { id: true, code: true, name: true, displayName: true },
  },
} satisfies Prisma.CartItemInclude;

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerContext: CustomerContextService,
    private readonly audit: CustomerAuditService,
  ) {}

  private async ctx(userId: string) {
    return this.customerContext.requireCustomer(userId);
  }

  async getOrCreateCart(ctx: CustomerContext) {
    const existing = await this.prisma.cart.findUnique({
      where: { customerProfileId: ctx.customerProfileId },
      include: {
        items: { include: cartItemInclude, orderBy: { createdAt: 'asc' } },
      },
    });
    if (existing) return existing;

    return this.prisma.cart.create({
      data: {
        customerProfileId: ctx.customerProfileId,
        organizationId: ctx.organizationId,
        status: 'ACTIVE',
      },
      include: {
        items: { include: cartItemInclude, orderBy: { createdAt: 'asc' } },
      },
    });
  }

  private serializeCart(
    cart: Prisma.CartGetPayload<{
      include: { items: { include: typeof cartItemInclude } };
    }>,
  ) {
    const items = cart.items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      currency: item.currency,
      paymentMethod: item.paymentMethod,
      priceSnapshotAt: item.priceSnapshotAt,
      lineTotal: Number(item.quantity) * Number(item.unitPrice),
      product: item.product,
      grade: item.grade
        ? {
            id: item.grade.id,
            code: item.grade.code,
            name: item.grade.name,
            displayName: item.grade.displayName ?? item.grade.name,
          }
        : null,
      offer: toBlindOffer(item.offer),
    }));

    const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);

    return {
      id: cart.id,
      status: cart.status,
      itemCount: items.length,
      subtotal,
      currency: items[0]?.currency ?? 'INR',
      items,
    };
  }

  private async loadOffer(offerId: string) {
    const offer = await this.prisma.offer.findFirst({
      where: { id: offerId, deletedAt: null },
      include: {
        ...offerInclude,
        product: {
          select: {
            id: true,
            code: true,
            name: true,
            packaging: true,
            unit: true,
            status: true,
            deletedAt: true,
            gradeId: true,
          },
        },
      },
    });
    if (!offer) throw new MarketplaceException('OFFER_NOT_FOUND');
    return offer;
  }

  async getCart(userId: string) {
    const ctx = await this.ctx(userId);
    const cart = await this.getOrCreateCart(ctx);
    return this.serializeCart(cart);
  }

  async addItem(userId: string, dto: AddCartItemDto) {
    const ctx = await this.ctx(userId);
    const cart = await this.getOrCreateCart(ctx);
    const offer = await this.loadOffer(dto.offerId);
    const quantity = Number(dto.quantity);
    const paymentMethod = mapCustomerPaymentMethod(dto.paymentMethod);

    assertMarketplaceOffer(offer, quantity, offer.moq);
    assertAvailability(offer.quantity, quantity);

    const unitPrice = resolveOfferUnitPrice(offer, quantity);
    const existing = cart.items.find((i) => i.offerId === dto.offerId);

    let item;
    if (existing) {
      const nextQty = Number(existing.quantity) + quantity;
      assertMarketplaceOffer(offer, nextQty, offer.moq);
      assertAvailability(offer.quantity, nextQty);
      const nextPrice = resolveOfferUnitPrice(offer, nextQty);
      item = await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: {
          quantity: nextQty,
          unitPrice: nextPrice,
          paymentMethod: paymentMethod ?? existing.paymentMethod,
          priceSnapshotAt: new Date(),
        },
        include: cartItemInclude,
      });
      await this.audit.log({
        action: 'CART_ITEM_UPDATED',
        actorUserId: userId,
        organizationId: ctx.organizationId,
        entityType: EntityOwnerType.CUSTOMER,
        entityId: item.id,
        previousData: {
          quantity: existing.quantity,
          unitPrice: existing.unitPrice,
        },
        newData: { quantity: item.quantity, unitPrice: item.unitPrice },
      });
    } else {
      item = await this.prisma.cartItem.create({
        data: {
          cartId: cart.id,
          offerId: offer.id,
          productId: offer.productId,
          gradeId: offer.gradeId,
          quantity,
          unit: offer.unit,
          unitPrice,
          currency: offer.currency,
          paymentMethod,
          priceSnapshotAt: new Date(),
        },
        include: cartItemInclude,
      });
      await this.audit.log({
        action: 'CART_ITEM_ADDED',
        actorUserId: userId,
        organizationId: ctx.organizationId,
        entityType: EntityOwnerType.CUSTOMER,
        entityId: item.id,
        newData: {
          offerId: offer.id,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        },
      });
    }

    const refreshed = await this.getOrCreateCart(ctx);
    return {
      cart: this.serializeCart(refreshed),
      item: {
        id: item.id,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        paymentMethod: item.paymentMethod,
        offer: toBlindOffer(item.offer),
      },
    };
  }

  async updateItem(userId: string, itemId: string, dto: UpdateCartItemDto) {
    const ctx = await this.ctx(userId);
    const cart = await this.getOrCreateCart(ctx);
    const existing = cart.items.find((i) => i.id === itemId);
    if (!existing) throw new NotFoundException('Cart item not found');

    const offer = await this.loadOffer(existing.offerId);
    const quantity =
      dto.quantity != null ? Number(dto.quantity) : Number(existing.quantity);
    const paymentMethod =
      dto.paymentMethod !== undefined
        ? mapCustomerPaymentMethod(dto.paymentMethod)
        : existing.paymentMethod;

    assertMarketplaceOffer(offer, quantity, offer.moq);
    assertAvailability(offer.quantity, quantity);

    const unitPrice = resolveOfferUnitPrice(offer, quantity);
    if (
      dto.expectedUnitPrice != null &&
      Number(unitPrice) !== Number(dto.expectedUnitPrice)
    ) {
      throw new MarketplaceException(
        'PRICE_CHANGED',
        'Offer unit price has changed since the cart was last priced',
      );
    }

    const item = await this.prisma.cartItem.update({
      where: { id: itemId },
      data: {
        quantity,
        unitPrice,
        paymentMethod,
        priceSnapshotAt: new Date(),
      },
      include: cartItemInclude,
    });

    await this.audit.log({
      action: 'CART_ITEM_UPDATED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.CUSTOMER,
      entityId: item.id,
      previousData: {
        quantity: existing.quantity,
        unitPrice: existing.unitPrice,
        paymentMethod: existing.paymentMethod,
      },
      newData: {
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        paymentMethod: item.paymentMethod,
      },
    });

    const refreshed = await this.getOrCreateCart(ctx);
    return this.serializeCart(refreshed);
  }

  async removeItem(userId: string, itemId: string) {
    const ctx = await this.ctx(userId);
    const cart = await this.getOrCreateCart(ctx);
    const existing = cart.items.find((i) => i.id === itemId);
    if (!existing) throw new NotFoundException('Cart item not found');

    await this.prisma.cartItem.delete({ where: { id: itemId } });
    await this.audit.log({
      action: 'CART_ITEM_REMOVED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.CUSTOMER,
      entityId: itemId,
      previousData: {
        offerId: existing.offerId,
        quantity: existing.quantity,
      },
    });

    const refreshed = await this.getOrCreateCart(ctx);
    return this.serializeCart(refreshed);
  }

  async clear(userId: string) {
    const ctx = await this.ctx(userId);
    const cart = await this.getOrCreateCart(ctx);
    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await this.audit.log({
      action: 'CART_ITEM_REMOVED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.CUSTOMER,
      entityId: cart.id,
      metadata: { cleared: true },
    });
    const refreshed = await this.getOrCreateCart(ctx);
    return this.serializeCart(refreshed);
  }

  async summary(userId: string) {
    const cart = await this.getCart(userId);
    return {
      itemCount: cart.itemCount,
      subtotal: cart.subtotal,
      currency: cart.currency,
      items: cart.items.map((i) => ({
        id: i.id,
        offerId: i.offer.id,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        lineTotal: i.lineTotal,
        currency: i.currency,
        paymentMethod: i.paymentMethod,
      })),
    };
  }

  private async assertAddress(ctx: CustomerContext, addressId?: string) {
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
      throw new MarketplaceException(
        'ADDRESS_NOT_FOUND',
        'Address not found for this customer organization',
      );
    }
  }

  async validate(userId: string, dto: ValidateCartDto) {
    const ctx = await this.ctx(userId);
    const cart = await this.getOrCreateCart(ctx);
    await this.assertAddress(ctx, dto.shippingAddressId);
    await this.assertAddress(ctx, dto.billingAddressId);

    const expectedMap = new Map(
      (dto.expectedPrices ?? []).map((p) => [
        p.cartItemId,
        Number(p.unitPrice),
      ]),
    );

    const issues: Array<{
      cartItemId: string;
      code: string;
      message: string;
      currentUnitPrice?: number;
    }> = [];

    const validatedItems = [];

    for (const item of cart.items) {
      try {
        const offer = await this.loadOffer(item.offerId);
        const quantity = Number(item.quantity);
        assertMarketplaceOffer(offer, quantity, offer.moq);
        assertAvailability(offer.quantity, quantity);
        const unitPrice = resolveOfferUnitPrice(offer, quantity);
        const expected = expectedMap.get(item.id);
        if (expected != null && Number(unitPrice) !== expected) {
          issues.push({
            cartItemId: item.id,
            code: 'PRICE_CHANGED',
            message: 'Offer unit price has changed',
            currentUnitPrice: Number(unitPrice),
          });
        } else if (Number(item.unitPrice) !== Number(unitPrice)) {
          issues.push({
            cartItemId: item.id,
            code: 'PRICE_CHANGED',
            message: 'Cart unit price is stale',
            currentUnitPrice: Number(unitPrice),
          });
        }
        validatedItems.push({
          cartItemId: item.id,
          offerId: offer.id,
          quantity,
          unitPrice: Number(unitPrice),
          currency: offer.currency,
          paymentMethod: item.paymentMethod,
          valid: true,
        });
      } catch (err) {
        const code =
          err instanceof MarketplaceException
            ? ((err.getResponse() as { code?: string })?.code ?? 'INVALID')
            : 'INVALID';
        const message =
          err instanceof Error ? err.message : 'Cart item validation failed';
        issues.push({ cartItemId: item.id, code, message });
        validatedItems.push({
          cartItemId: item.id,
          offerId: item.offerId,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          currency: item.currency,
          paymentMethod: item.paymentMethod,
          valid: false,
        });
      }
    }

    if (cart.items.length === 0) {
      issues.push({
        cartItemId: '',
        code: 'CART_EMPTY',
        message: 'Cart has no items',
      });
    }

    const valid = issues.length === 0;

    await this.audit.log({
      action: 'CHECKOUT_VALIDATED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.CUSTOMER,
      entityId: cart.id,
      newData: { valid, issueCount: issues.length },
    });

    return {
      valid,
      issues,
      items: validatedItems,
      shippingAddressId: dto.shippingAddressId ?? null,
      billingAddressId: dto.billingAddressId ?? null,
    };
  }
}
