import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { successResponse } from '../../common/utils/response.util.js';
import type { AppConfig } from '../../config/configuration.js';

/**
 * Unauthenticated legal / support destinations for login and footer screens.
 * Missing URLs are returned as null with an explicit `missing` list so clients
 * can surface configuration gaps instead of inventing placeholders.
 */
@ApiTags('Public')
@Controller({ path: 'public/legal-links', version: '1' })
export class PublicLegalLinksController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  @ApiOperation({
    summary:
      'Terms, Privacy, and Contact Support URLs for login screens (no auth)',
  })
  get() {
    const legal = this.config.getOrThrow<AppConfig['legal']>('legal');
    const termsUrl = legal.termsUrl || null;
    const privacyUrl = legal.privacyUrl || null;
    const supportUrl = legal.supportUrl || null;
    const supportEmail = legal.supportEmail || null;
    const missing: string[] = [];
    if (!termsUrl) missing.push('PUBLIC_TERMS_URL (or PUBLIC_WEBSITE_URL)');
    if (!privacyUrl) missing.push('PUBLIC_PRIVACY_URL (or PUBLIC_WEBSITE_URL)');
    if (!supportUrl && !supportEmail) {
      missing.push(
        'PUBLIC_SUPPORT_URL / PUBLIC_SUPPORT_EMAIL (or PUBLIC_WEBSITE_URL)',
      );
    }
    return successResponse(
      {
        websiteUrl: legal.websiteUrl || null,
        termsUrl,
        privacyUrl,
        supportUrl,
        supportEmail,
        missing,
      },
      'Legal links',
    );
  }
}
