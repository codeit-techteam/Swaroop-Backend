import { describe, expect, it } from 'vitest';
import {
  CmsBannerPlacement,
  CmsBannerPlatform,
} from '../../generated/prisma/client.js';
import {
  placementBadge,
  publicPlatformsFor,
  toPublicBanner,
} from './cms.mapper.js';

describe('cms mapper', () => {
  it('scopes customer web requests to web + shared platforms', () => {
    expect(
      publicPlatformsFor('CUSTOMER', CmsBannerPlatform.CUSTOMER_WEB),
    ).toEqual([
      CmsBannerPlatform.ALL,
      CmsBannerPlatform.CUSTOMER_WEB,
      CmsBannerPlatform.CUSTOMER_ALL,
    ]);
  });

  it('rejects seller platforms on the customer audience', () => {
    expect(
      publicPlatformsFor('CUSTOMER', CmsBannerPlatform.SELLER_WEB),
    ).toEqual([]);
  });

  it('maps public CTA fields from metadata and resolves https media', () => {
    const banner = toPublicBanner({
      id: '11111111-1111-1111-1111-111111111111',
      title: 'PP Spot Deal',
      subtitle: 'This week only',
      placement: CmsBannerPlacement.HOME_HERO,
      platform: CmsBannerPlatform.CUSTOMER_WEB,
      displayOrder: 1,
      startAt: null,
      endAt: null,
      mediaKey: 'https://cdn.example.com/hero.jpg',
      targetRoute: '/marketplace',
      metadata: {
        ctaText: 'Browse grades',
        ctaAction: 'OPEN_MARKETPLACE',
        badge: 'PROMO',
        description: 'Verified polymer grades at live prices.',
      },
    });

    expect(banner.mediaUrl).toBe('https://cdn.example.com/hero.jpg');
    expect(banner.mobileMediaUrl).toBe('https://cdn.example.com/hero.jpg');
    expect(banner.ctaText).toBe('Browse grades');
    expect(banner.ctaAction).toBe('OPEN_MARKETPLACE');
    expect(banner.badge).toBe('PROMO');
    expect(banner.description).toContain('Verified polymer');
  });

  it('falls back to placement badges', () => {
    expect(placementBadge(CmsBannerPlacement.OFFERS)).toBe('OFFER');
  });
});
