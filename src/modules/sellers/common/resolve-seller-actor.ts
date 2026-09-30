import type { PrismaService } from '../../../database/prisma.service.js';

type SellerClient = Pick<
  PrismaService,
  'sellerProfile' | 'sellerManagerAssignment'
>;

/**
 * Seller identity is always resolved from the authenticated user.
 * Callers must not pass a client-supplied seller id into this function.
 */
export async function resolveSellerActor(prisma: SellerClient, userId: string) {
  const owned = await prisma.sellerProfile.findFirst({
    where: { userId, deletedAt: null },
    include: { organization: true },
  });
  if (owned) {
    return { kind: 'OWNER' as const, profile: owned, assignment: null };
  }

  const assignment = await prisma.sellerManagerAssignment.findFirst({
    where: { userId, status: 'ACTIVE' },
    include: {
      sellerProfile: { include: { organization: true } },
    },
    orderBy: [{ isPrimary: 'desc' }, { assignedAt: 'desc' }],
  });

  if (!assignment || assignment.sellerProfile.deletedAt) {
    return null;
  }

  return {
    kind: 'MANAGER' as const,
    profile: assignment.sellerProfile,
    assignment,
  };
}
