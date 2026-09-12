import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AddressType } from '../../../generated/prisma/client.js';

export class CompanyAddressDto {
  @ApiPropertyOptional({ enum: AddressType, default: AddressType.REGISTERED })
  @IsOptional()
  @IsEnum(AddressType)
  type?: AddressType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiProperty({ example: '12 Industrial Estate' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  line1!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  line2?: string;

  @ApiProperty({ example: 'Mumbai' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  city!: string;

  @ApiProperty({ example: 'Maharashtra' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  state!: string;

  @ApiPropertyOptional({ default: 'IN' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  country?: string;

  @ApiProperty({ example: '400001' })
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  postalCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  landmark?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class CompanyBankAccountDto {
  @ApiProperty({ example: 'Acme Polymers Pvt Ltd' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  accountHolder!: string;

  @ApiProperty({ example: 'HDFC Bank' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  bankName!: string;

  @ApiProperty({ example: '50100123456789' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  accountNumber!: string;

  @ApiProperty({ example: 'HDFC0001234' })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  ifsc!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  branch?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdateCompanyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  businessType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  constitutionType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  industry?: string;

  @ApiPropertyOptional({ example: '27AAAAA0000A1Z5' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  gstin?: string;

  @ApiPropertyOptional({ example: 'AAAAA0000A' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  pan?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  cin?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  msmeNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  website?: string;

  @ApiPropertyOptional({ type: () => CompanyAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CompanyAddressDto)
  address?: CompanyAddressDto;

  @ApiPropertyOptional({ type: () => CompanyBankAccountDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CompanyBankAccountDto)
  bankAccount?: CompanyBankAccountDto;
}

export class CompanyQueryDto {
  @ApiPropertyOptional({
    description: 'Required for ADMIN/SUPER_ADMIN review of another seller',
  })
  @IsOptional()
  @IsString()
  sellerProfileId?: string;
}
