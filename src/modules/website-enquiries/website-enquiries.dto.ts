import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  WebsiteEnquiryStatus,
  WebsiteEnquiryTopic,
} from '../../generated/prisma/client.js';
import { PaginationQueryDto } from '../master-data/common/pagination.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateWebsiteEnquiryDto {
  @ApiProperty({ minLength: 2, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  company?: string;

  @ApiProperty({ example: 'buyer@example.com' })
  @Transform(trim)
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^\+91[6-9]\d{9}$/, {
    message: 'phone must be a valid Indian mobile number',
  })
  phone?: string;

  @ApiProperty({ enum: WebsiteEnquiryTopic })
  @IsEnum(WebsiteEnquiryTopic)
  topic!: WebsiteEnquiryTopic;

  @ApiProperty({ minLength: 20, maxLength: 2000 })
  @Transform(trim)
  @IsString()
  @MinLength(20)
  @MaxLength(2000)
  message!: string;

  @ApiPropertyOptional({ description: 'Website path the form was sent from' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  pagePath?: string;

  /** Honeypot: hidden from people, filled in by bots. */
  @ApiPropertyOptional({ description: 'Leave empty' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

export class WebsiteEnquiriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: WebsiteEnquiryStatus })
  @IsOptional()
  @IsEnum(WebsiteEnquiryStatus)
  status?: WebsiteEnquiryStatus;

  @ApiPropertyOptional({ enum: WebsiteEnquiryTopic })
  @IsOptional()
  @IsEnum(WebsiteEnquiryTopic)
  topic?: WebsiteEnquiryTopic;
}

export class UpdateWebsiteEnquiryDto {
  @ApiPropertyOptional({ enum: WebsiteEnquiryStatus })
  @IsOptional()
  @IsEnum(WebsiteEnquiryStatus)
  status?: WebsiteEnquiryStatus;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminNotes?: string;
}
