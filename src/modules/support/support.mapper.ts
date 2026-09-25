import type {
  Organization,
  SupportTicket,
  SupportTicketMessage,
  User,
} from '../../generated/prisma/client.js';

type TicketWithRelations = SupportTicket & {
  messages?: SupportTicketMessage[];
  organization?: Pick<Organization, 'id' | 'name' | 'legalName' | 'type'> | null;
  requesterUser?: Pick<
    User,
    'id' | 'displayName' | 'firstName' | 'lastName' | 'email' | 'phone'
  > | null;
};

const CATEGORY_LABELS: Record<string, string> = {
  PAYMENT: 'Payment',
  ORDERS: 'Order',
  SHIPMENT: 'Shipment',
  INVOICE: 'Documents',
  GST: 'GST',
  TECHNICAL: 'Technical',
  MARKETPLACE: 'Marketplace',
  CREDIT: 'Account',
  INVENTORY: 'Inventory',
  DISPATCH: 'Dispatch',
  COMPLIANCE: 'Compliance',
  ACCOUNT: 'Account',
  OTHERS: 'Other',
};

function displayName(
  user?: Pick<User, 'displayName' | 'firstName' | 'lastName'> | null,
) {
  if (!user) return 'User';
  if (user.displayName?.trim()) return user.displayName.trim();
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name || 'User';
}

export function toSupportTicketDto(
  row: TicketWithRelations,
  options?: { includeInternal?: boolean },
) {
  const orgName =
    row.organization?.legalName?.trim() ||
    row.organization?.name?.trim() ||
    null;
  const requesterName = displayName(row.requesterUser);

  return {
    id: row.id,
    ticketNumber: row.ticketNumber,
    ticketId: row.ticketNumber,
    requesterType: row.requesterType,
    requesterUserId: row.requesterUserId,
    requesterName,
    requesterEmail: row.requesterUser?.email ?? null,
    requesterPhone: row.requesterUser?.phone ?? null,
    organizationId: row.organizationId,
    organizationName: orgName,
    category: row.category,
    categoryLabel: CATEGORY_LABELS[row.category] ?? row.category,
    priority: row.priority,
    status: row.status,
    subject: row.subject,
    description: row.description,
    relatedOrderId: row.relatedOrderId,
    attachmentName: row.attachmentName,
    assignedToName: row.assignedToName,
    assignedToUserId: row.assignedToUserId,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    messages: (row.messages ?? []).map((m) => ({
      id: m.id,
      sender: m.sender,
      senderName: m.senderName,
      body: m.body,
      attachmentName: m.attachmentName,
      createdAt: m.createdAt.toISOString(),
    })),
    ...(options?.includeInternal
      ? {
          source:
            row.requesterType === 'CUSTOMER'
              ? 'Customer'
              : ('Seller' as const),
        }
      : {}),
  };
}

export type SupportTicketDto = ReturnType<typeof toSupportTicketDto>;
