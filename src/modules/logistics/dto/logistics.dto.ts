import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DeliveryExceptionReason,
  DeliveryStatus,
  DispatchStatus,
  DriverStatus,
  ShipmentStatus,
  VehicleOperationalStatus,
  VehicleSlotStatus,
  VehicleType,
} from '../../../generated/prisma/client.js';
import { PaginationQueryDto } from '../../master-data/common/pagination.js';

export class CreateDispatchDto {
  @ApiProperty()
  @IsUUID()
  purchaseOrderId!: string;

  @ApiProperty({ example: 40 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  plannedDispatchDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  originWarehouseId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  destinationRegion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class AssignVehicleDto {
  @ApiProperty()
  @IsUUID()
  vehicleId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  driverId?: string;
}

export class UpsertEwayBillDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  ewayBillNumber!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  documentKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  documentId?: string;
}

export class TrackingEventDto {
  @ApiProperty({ enum: ShipmentStatus })
  @IsEnum(ShipmentStatus)
  status!: ShipmentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}

export class UpdateEtaDto {
  @ApiProperty()
  @IsDateString()
  eta!: string;
}

export class MarkDeliveredDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  deliveredAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  receivedBy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  deliveryNote?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  deliveredQuantity?: number;
}

export class UploadPodDto {
  @ApiProperty()
  @IsString()
  @MaxLength(512)
  documentKey!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  documentId?: string;
}

export class DeliveryExceptionDto {
  @ApiProperty({ enum: DeliveryExceptionReason })
  @IsEnum(DeliveryExceptionReason)
  reason!: DeliveryExceptionReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreateVehicleDto {
  @ApiPropertyOptional({ enum: VehicleType })
  @IsOptional()
  @IsEnum(VehicleType)
  type?: VehicleType;

  @ApiProperty({ example: 'MH12AB1234' })
  @IsString()
  @MaxLength(32)
  numberPlate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  transporterName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  driverName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  driverPhone?: string;

  @ApiPropertyOptional({ example: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  capacityMt?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  driverId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  insuranceExpiry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fitnessExpiry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  permitExpiry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  pollutionExpiry?: string;
}

export class UpdateVehicleDto {
  @ApiPropertyOptional({ enum: VehicleType })
  @IsOptional()
  @IsEnum(VehicleType)
  type?: VehicleType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  numberPlate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  transporterName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  driverName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  driverPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  capacityMt?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  driverId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  insuranceExpiry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fitnessExpiry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  permitExpiry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  pollutionExpiry?: string;

  @ApiPropertyOptional({ enum: VehicleOperationalStatus })
  @IsOptional()
  @IsEnum(VehicleOperationalStatus)
  status?: VehicleOperationalStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateDriverDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  licenseNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  licenseExpiry?: string;
}

export class UpdateDriverDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  licenseNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  licenseExpiry?: string;

  @ApiPropertyOptional({ enum: DriverStatus })
  @IsOptional()
  @IsEnum(DriverStatus)
  status?: DriverStatus;
}

export class CreateVehicleSlotDto {
  @ApiProperty()
  @IsUUID()
  warehouseId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  dispatchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @ApiProperty({ example: '2026-09-15' })
  @IsDateString()
  slotDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  startTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  endTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timeSlot?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  loadingBay?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantityMt?: number;
}

export class LogisticsListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DispatchStatus })
  @IsOptional()
  @IsEnum(DispatchStatus)
  dispatchStatus?: DispatchStatus;

  @ApiPropertyOptional({ enum: ShipmentStatus })
  @IsOptional()
  @IsEnum(ShipmentStatus)
  shipmentStatus?: ShipmentStatus;

  @ApiPropertyOptional({ enum: DeliveryStatus })
  @IsOptional()
  @IsEnum(DeliveryStatus)
  deliveryStatus?: DeliveryStatus;

  @ApiPropertyOptional({ enum: VehicleSlotStatus })
  @IsOptional()
  @IsEnum(VehicleSlotStatus)
  slotStatus?: VehicleSlotStatus;
}
