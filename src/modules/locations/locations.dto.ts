import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Google requires URL/filename-safe tokens of at most 36 chars (UUIDv4 fits). */
const SESSION_TOKEN_REGEX = /^[A-Za-z0-9_-]{8,36}$/;

export class LocationAutocompleteQueryDto {
  @ApiProperty({ example: 'Lich', description: 'Partial address / area / PIN' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  input!: string;

  @ApiProperty({
    description:
      'Client-generated autocomplete session token (UUID). Reuse for all keystrokes and the final place lookup; rotate after selection.',
  })
  @IsString()
  @Matches(SESSION_TOKEN_REGEX, { message: 'sessionToken is invalid' })
  sessionToken!: string;

  @ApiPropertyOptional({ description: 'Bias results near this latitude' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ description: 'Bias results near this longitude' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;
}

export class LocationPlaceDetailsQueryDto {
  @ApiPropertyOptional({
    description: 'Same session token used for autocomplete',
  })
  @IsOptional()
  @IsString()
  @Matches(SESSION_TOKEN_REGEX, { message: 'sessionToken is invalid' })
  sessionToken?: string;

  @ApiPropertyOptional({
    description: 'Display name from the chosen suggestion (primary text)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;
}

export class LocationReverseGeocodeQueryDto {
  @ApiProperty({ example: 22.5726 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ example: 88.3639 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @ApiPropertyOptional({ enum: ['GPS', 'MAP_PIN'], default: 'GPS' })
  @IsOptional()
  @IsIn(['GPS', 'MAP_PIN'])
  source?: 'GPS' | 'MAP_PIN';
}

export const GOOGLE_PLACE_ID_REGEX = /^[A-Za-z0-9_-]{10,300}$/;
