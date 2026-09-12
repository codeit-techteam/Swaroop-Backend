import { Injectable } from '@nestjs/common';
import { MasterStatus, Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { paginationMeta, skipTake } from '../common/pagination.js';
import { assertFound, handlePrismaUnique } from '../common/prisma-helpers.js';
import type {
  CreatePaymentTermDto,
  PaymentTermQueryDto,
  UpdatePaymentTermDto,
} from './payment-terms.dto.js';

@Injectable()
export class PaymentTermsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePaymentTermDto) {
    try {
      return await this.prisma.paymentTerm.create({
        data: {
          code: dto.code.trim().toUpperCase(),
          name: dto.name.trim(),
          displayName: (dto.displayName ?? dto.name).trim(),
          description: dto.description,
          paymentType: dto.paymentType,
          days: dto.days ?? 0,
          percentage: dto.percentage,
          status: dto.status ?? MasterStatus.ACTIVE,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
    } catch (error) {
      handlePrismaUnique(error, 'Payment term code already exists');
    }
  }

  async findAll(query: PaymentTermQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.PaymentTermWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.paymentType) where.paymentType = query.paymentType;
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [total, items] = await this.prisma.$transaction([
      this.prisma.paymentTerm.count({ where }),
      this.prisma.paymentTerm.findMany({
        where,
        orderBy: { sortOrder: query.sortOrder === 'desc' ? 'desc' : 'asc' },
        skip,
        take,
      }),
    ]);
    return { items, meta: paginationMeta(page, limit, total) };
  }

  async findActive() {
    return this.prisma.paymentTerm.findMany({
      where: { deletedAt: null, status: MasterStatus.ACTIVE },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findOne(id: string) {
    return assertFound(
      await this.prisma.paymentTerm.findFirst({
        where: { id, deletedAt: null },
      }),
      'Payment term not found',
    );
  }

  async update(id: string, dto: UpdatePaymentTermDto) {
    await this.findOne(id);
    try {
      return await this.prisma.paymentTerm.update({
        where: { id },
        data: {
          code: dto.code?.trim().toUpperCase(),
          name: dto.name?.trim(),
          displayName: dto.displayName?.trim(),
          description: dto.description,
          paymentType: dto.paymentType,
          days: dto.days,
          percentage: dto.percentage,
          status: dto.status,
          sortOrder: dto.sortOrder,
        },
      });
    } catch (error) {
      handlePrismaUnique(error, 'Payment term code already exists');
    }
  }

  async softDelete(id: string) {
    await this.findOne(id);
    await this.prisma.paymentTerm.update({
      where: { id },
      data: { deletedAt: new Date(), status: MasterStatus.INACTIVE },
    });
    return { id, deleted: true };
  }
}
