import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { successResponse } from '../../common/utils/response.util.js';
import { CurrentUser } from '../auth/decorators/auth.decorators.js';
import { JwtAuthGuard } from '../auth/index.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';
import {
  GOOGLE_PLACE_ID_REGEX,
  LocationAutocompleteQueryDto,
  LocationPlaceDetailsQueryDto,
  LocationReverseGeocodeQueryDto,
} from './locations.dto.js';
import { LocationException } from './locations.errors.js';
import { LocationsService } from './locations.service.js';

/**
 * Shared location lookup API for Customer + Seller on Web and App.
 * The Google key stays server-side; every client receives the same normalized shape.
 */
@ApiTags('Locations')
@Controller({ path: 'locations', version: '1' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('bearer')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get('config')
  @ApiOperation({ summary: 'Location search capabilities for this deployment' })
  config() {
    return successResponse(this.locations.getConfig(), 'Location config');
  }

  @Get('autocomplete')
  @ApiOperation({
    summary: 'Address / place suggestions (Google Places Autocomplete New)',
  })
  async autocomplete(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LocationAutocompleteQueryDto,
  ) {
    return successResponse(
      await this.locations.autocomplete(user.id, {
        query: query.input,
        sessionToken: query.sessionToken,
        latitude: query.lat,
        longitude: query.lng,
      }),
      'Suggestions retrieved',
    );
  }

  @Get('places/:placeId')
  @ApiOperation({
    summary: 'Resolve a selected suggestion to a normalized address',
  })
  async placeDetails(
    @CurrentUser() user: AuthenticatedUser,
    @Param('placeId') placeId: string,
    @Query() query: LocationPlaceDetailsQueryDto,
  ) {
    if (!GOOGLE_PLACE_ID_REGEX.test(placeId)) {
      throw new LocationException('PLACE_NOT_FOUND');
    }
    return successResponse(
      await this.locations.placeDetails(user.id, {
        placeId,
        sessionToken: query.sessionToken,
        name: query.name,
      }),
      'Place resolved',
    );
  }

  @Get('reverse-geocode')
  @ApiOperation({
    summary: 'Coordinates (GPS / map pin) to a normalized address',
  })
  async reverseGeocode(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LocationReverseGeocodeQueryDto,
  ) {
    return successResponse(
      await this.locations.reverseGeocode(user.id, {
        latitude: query.lat,
        longitude: query.lng,
        source: query.source ?? 'GPS',
      }),
      'Location resolved',
    );
  }
}
