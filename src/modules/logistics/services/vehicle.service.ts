import { Injectable } from '@nestjs/common';
import {
  Prisma,
  VehicleOperationalStatus,
  VehicleType,
  type Vehicle,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { LogisticsException } from '../common/logistics.errors.js';
import { cmpQty, toQty } from '../common/quantity.util.js';
import {
  toAdminVehicle,
  toSellerVehicle,
} from '../common/blind-logistics.mapper.js';

export type CreateVehicleInput = {
  type?: VehicleType;
  numberPlate: string;
  transporterName?: string;
  driverName?: string;
  driverPhone?: string;
  capacityMt?: number;
  driverId?: string;
  insuranceExpiry?: string;
  fitnessExpiry?: string;
  permitExpiry?: string;
  pollutionExpiry?: string;
};

export type UpdateVehicleInput = Partial<CreateVehicleInput> & {
  status?: VehicleOperationalStatus;
  isActive?: boolean;
};

@Injectable()
export class VehicleService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    organizationId: string | null,
    input: CreateVehicleInput,
  ): Promise<Vehicle> {
    try {
      return await this.prisma.vehicle.create({
        data: {
          organizationId: organizationId ?? undefined,
          type: input.type ?? VehicleType.TRUCK,
          numberPlate: input.numberPlate.trim().toUpperCase(),
          transporterName: input.transporterName,
          driverName: input.driverName,
          driverPhone: input.driverPhone,
          capacityMt:
            input.capacityMt != null ? toQty(input.capacityMt) : undefined,
          driverId: input.driverId,
          insuranceExpiry: parseDate(input.insuranceExpiry),
          fitnessExpiry: parseDate(input.fitnessExpiry),
          permitExpiry: parseDate(input.permitExpiry),
          pollutionExpiry: parseDate(input.pollutionExpiry),
          status: VehicleOperationalStatus.AVAILABLE,
          isActive: true,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new LogisticsException(
          'VEHICLE_NOT_COMPLIANT',
          'Vehicle number plate already exists',
        );
      }
      throw err;
    }
  }

  async update(
    id: string,
    input: UpdateVehicleInput,
    opts?: { organizationId?: string },
  ): Promise<Vehicle> {
    await this.requireVehicle(id, opts?.organizationId);
    return this.prisma.vehicle.update({
      where: { id },
      data: {
        ...(input.type != null ? { type: input.type } : {}),
        ...(input.numberPlate != null
          ? { numberPlate: input.numberPlate.trim().toUpperCase() }
          : {}),
        ...(input.transporterName !== undefined
          ? { transporterName: input.transporterName }
          : {}),
        ...(input.driverName !== undefined
          ? { driverName: input.driverName }
          : {}),
        ...(input.driverPhone !== undefined
          ? { driverPhone: input.driverPhone }
          : {}),
        ...(input.capacityMt !== undefined
          ? { capacityMt: toQty(input.capacityMt) }
          : {}),
        ...(input.driverId !== undefined ? { driverId: input.driverId } : {}),
        ...(input.insuranceExpiry !== undefined
          ? { insuranceExpiry: parseDate(input.insuranceExpiry) }
          : {}),
        ...(input.fitnessExpiry !== undefined
          ? { fitnessExpiry: parseDate(input.fitnessExpiry) }
          : {}),
        ...(input.permitExpiry !== undefined
          ? { permitExpiry: parseDate(input.permitExpiry) }
          : {}),
        ...(input.pollutionExpiry !== undefined
          ? { pollutionExpiry: parseDate(input.pollutionExpiry) }
          : {}),
        ...(input.status != null ? { status: input.status } : {}),
        ...(input.isActive != null ? { isActive: input.isActive } : {}),
      },
    });
  }

  async list(params: {
    organizationId?: string;
    skip: number;
    take: number;
    type?: VehicleType;
    status?: VehicleOperationalStatus;
    search?: string;
  }) {
    const where: Prisma.VehicleWhereInput = {
      ...(params.organizationId
        ? { organizationId: params.organizationId }
        : {}),
      ...(params.type ? { type: params.type } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.search
        ? {
            OR: [
              {
                numberPlate: {
                  contains: params.search,
                  mode: 'insensitive',
                },
              },
              {
                transporterName: {
                  contains: params.search,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.vehicle.count({ where }),
    ]);
    return { items, total };
  }

  async get(id: string, organizationId?: string) {
    return this.requireVehicle(id, organizationId);
  }

  async requireVehicle(id: string, organizationId?: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: {
        id,
        ...(organizationId ? { organizationId } : {}),
      },
    });
    if (!vehicle) {
      throw new LogisticsException('VEHICLE_NOT_FOUND');
    }
    return vehicle;
  }

  /**
   * Compliance for assignment: active, AVAILABLE (or ASSIGNED only if same dispatch),
   * docs not expired when set, capacity >= quantity.
   */
  assertAssignable(
    vehicle: Vehicle,
    quantity: Prisma.Decimal | number | string,
  ): void {
    if (!vehicle.isActive) {
      throw new LogisticsException(
        'VEHICLE_NOT_COMPLIANT',
        'Vehicle is inactive',
      );
    }
    if (
      vehicle.status !== VehicleOperationalStatus.AVAILABLE &&
      vehicle.status !== VehicleOperationalStatus.ASSIGNED
    ) {
      throw new LogisticsException(
        'VEHICLE_NOT_COMPLIANT',
        `Vehicle status ${vehicle.status} is not assignable`,
      );
    }

    const now = new Date();
    const expiries: Array<[string, Date | null]> = [
      ['insurance', vehicle.insuranceExpiry],
      ['fitness', vehicle.fitnessExpiry],
      ['permit', vehicle.permitExpiry],
      ['pollution', vehicle.pollutionExpiry],
    ];
    for (const [label, expiry] of expiries) {
      if (expiry && expiry.getTime() < now.getTime()) {
        throw new LogisticsException(
          'VEHICLE_DOCUMENT_EXPIRED',
          `${label} document expired`,
        );
      }
    }

    if (vehicle.capacityMt == null) {
      throw new LogisticsException(
        'VEHICLE_CAPACITY_INSUFFICIENT',
        'Vehicle capacity is not set',
      );
    }
    if (cmpQty(vehicle.capacityMt, quantity) < 0) {
      throw new LogisticsException('VEHICLE_CAPACITY_INSUFFICIENT');
    }
  }

  toSellerView(v: Vehicle) {
    return toSellerVehicle(v);
  }

  toAdminView(v: Vehicle) {
    return toAdminVehicle(v);
  }
}

function parseDate(value?: string | null): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return new Date(value);
}
