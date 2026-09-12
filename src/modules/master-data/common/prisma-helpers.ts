import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';

export function handlePrismaUnique(
  error: unknown,
  message = 'Record already exists',
): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    throw new ConflictException(message);
  }
  throw error;
}

export function assertFound<T>(
  value: T | null | undefined,
  message = 'Record not found',
): T {
  if (value == null) {
    throw new NotFoundException(message);
  }
  return value;
}
