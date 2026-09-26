import {
  CmsBannerPlacement,
  CmsBannerPlatform,
  type CmsBanner,
} from '../../generated/prisma/client.js';

export type CmsAudience = 'CUSTOMER' | 'SELLER';

/** IMAGE_OVERLAY = photo creative; NAVY_GRID = structured navy hero (Customer WEB). */
export type CmsBannerLayoutVariant = 'IMAGE_OVERLAY' | 'NAVY_GRID';

export type PublicCmsBanner = {
  id: string;
  title: string;
  subtitle: string | null;
  placement: CmsBannerPlacement;
  platform: CmsBannerPlatform;
  displayOrder: number;
  startAt: Date | null;
  endAt: Date | null;
  mediaKey: string | null;
  mediaUrl: string | null;
  /** Optional mobile creative (from metadata.mobileImage), falls back to mediaUrl. */
  mobileMediaUrl: string | null;
  targetRoute: string | null;
  ctaText: string;
  ctaAction: string;
  badge: string;
  description: string;
  externalUrl: string | null;
  targetId: string | null;
  priority: number;
  /** Structured layout for Customer WEB hero (navy grid + dual CTAs). */
  layoutVariant: CmsBannerLayoutVariant;
  secondaryCtaText: string | null;
  secondaryCtaAction: string | null;
  secondaryExternalUrl: string | null;
  secondaryTargetId: string | null;
};

const CUSTOMER_PLATFORMS: CmsBannerPlatform[] = [
  CmsBannerPlatform.ALL,
  CmsBannerPlatform.CUSTOMER_ALL,
  CmsBannerPlatform.CUSTOMER_APP,
  CmsBannerPlatform.CUSTOMER_WEB,
];

const SELLER_PLATFORMS: CmsBannerPlatform[] = [
  CmsBannerPlatform.ALL,
  CmsBannerPlatform.SELLER_ALL,
  CmsBannerPlatform.SELLER_APP,
  CmsBannerPlatform.SELLER_WEB,
];

export function isDirectMediaUrl(value?: string | null): boolean {
  return Boolean(value && /^(https?:|data:|blob:)/i.test(value));
}

export function asMetadata(
  value: unknown,
): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function metaString(
  meta: Record<string, unknown>,
  key: string,
): string | null {
  const value = meta[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function layoutVariantFromMeta(
  meta: Record<string, unknown>,
  hasMedia: boolean,
): CmsBannerLayoutVariant {
  const raw = metaString(meta, 'layoutVariant');
  if (raw === 'NAVY_GRID' || raw === 'IMAGE_OVERLAY') return raw;
  // No creative → treat as structured navy grid so Admin can ship text-only heroes.
  return hasMedia ? 'IMAGE_OVERLAY' : 'NAVY_GRID';
}

export function placementBadge(placement: CmsBannerPlacement): string {
  switch (placement) {
    case CmsBannerPlacement.HOME_HERO:
      return 'CAMPAIGN';
    case CmsBannerPlacement.MARKETPLACE:
      return 'MARKETPLACE';
    case CmsBannerPlacement.OFFERS:
      return 'OFFER';
    case CmsBannerPlacement.DASHBOARD:
      return 'UPDATE';
    case CmsBannerPlacement.LOGIN:
      return 'WELCOME';
    default:
      return 'ANNOUNCEMENT';
  }
}

export function publicPlatformsFor(
  audience: CmsAudience,
  requested?: CmsBannerPlatform,
): CmsBannerPlatform[] {
  const allowed =
    audience === 'CUSTOMER' ? CUSTOMER_PLATFORMS : SELLER_PLATFORMS;

  if (!requested || requested === CmsBannerPlatform.ALL) {
    return allowed;
  }

  if (!allowed.includes(requested)) {
    return [];
  }

  const platforms: CmsBannerPlatform[] = [
    CmsBannerPlatform.ALL,
    requested,
  ];

  if (audience === 'CUSTOMER') {
    platforms.push(CmsBannerPlatform.CUSTOMER_ALL);
  } else {
    platforms.push(CmsBannerPlatform.SELLER_ALL);
  }

  return [...new Set(platforms)];
}

export function toPublicBanner(
  row: Pick<
    CmsBanner,
    | 'id'
    | 'title'
    | 'subtitle'
    | 'placement'
    | 'platform'
    | 'displayOrder'
    | 'startAt'
    | 'endAt'
    | 'mediaKey'
    | 'targetRoute'
    | 'metadata'
  >,
  mediaUrl?: string | null,
  mobileMediaUrl?: string | null,
): PublicCmsBanner {
  const meta = asMetadata(row.metadata);
  const imageUrl =
    mediaUrl ?? (isDirectMediaUrl(row.mediaKey) ? row.mediaKey : null);
  const mobileMeta = metaString(meta, 'mobileImage');
  const mobileUrl =
    mobileMediaUrl ??
    (isDirectMediaUrl(mobileMeta) ? mobileMeta : null) ??
    imageUrl;

  const hasMedia = Boolean(imageUrl || mobileUrl);

  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    placement: row.placement,
    platform: row.platform,
    displayOrder: row.displayOrder,
    startAt: row.startAt,
    endAt: row.endAt,
    mediaKey: row.mediaKey,
    mediaUrl: imageUrl,
    mobileMediaUrl: mobileUrl,
    targetRoute: row.targetRoute,
    ctaText: metaString(meta, 'ctaText') ?? (row.targetRoute ? 'Open' : 'View'),
    ctaAction: metaString(meta, 'ctaAction') ?? 'NO_ACTION',
    badge:
      metaString(meta, 'badge') ??
      metaString(meta, 'campaignType') ??
      placementBadge(row.placement),
    description:
      metaString(meta, 'description') ?? row.subtitle ?? row.title,
    externalUrl: metaString(meta, 'externalUrl'),
    targetId: metaString(meta, 'targetId'),
    priority: Number(meta.priority) || 3,
    layoutVariant: layoutVariantFromMeta(meta, hasMedia),
    secondaryCtaText: metaString(meta, 'secondaryCtaText'),
    secondaryCtaAction: metaString(meta, 'secondaryCtaAction'),
    secondaryExternalUrl: metaString(meta, 'secondaryExternalUrl'),
    secondaryTargetId: metaString(meta, 'secondaryTargetId'),
  };
}
