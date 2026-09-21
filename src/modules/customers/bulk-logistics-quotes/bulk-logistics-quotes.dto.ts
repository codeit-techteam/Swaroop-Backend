import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateBulkLogisticsQuoteDto {
  @ApiProperty({ example: 'Rahul Sharma' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  contactName!: string;

  @ApiProperty({ example: 'Industrial Polymers Pvt. Ltd.' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  companyName!: string;

  @ApiProperty({ example: 'rahul@industrialpolymers.in' })
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @ApiProperty({ example: '9876543210' })
  @IsString()
  @Matches(/^[6-9]\d{9}$/, {
    message: 'phone must be a valid 10-digit Indian mobile number',
  })
  phone!: string;

  @ApiProperty({ example: 'HDPE Film / High-Density PE' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  materialName!: string;

  @ApiProperty({ example: 500 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(1)
  quantityMt!: number;

  @ApiProperty({ example: 'Mundra Port, Gujarat' })
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  pickupLocation!: string;

  @ApiProperty({ example: 'Pune, Maharashtra' })
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  deliveryLocation!: string;

  @ApiPropertyOptional({ example: '2026-10-15' })
  @IsOptional()
  @IsDateString()
  preferredDate?: string;

  @ApiPropertyOptional({ example: 'Need covered trucks and multi-drop delivery.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}
