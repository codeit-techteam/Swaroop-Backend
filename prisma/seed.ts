import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import {
  AttributeDataType,
  LocationType,
  MasterStatus,
  PaymentTermType,
  PrismaClient,
} from '../src/generated/prisma/client.js';
import { runCatalogImport } from '../scripts/import-catalog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/swaroop?schema=public';

const needsRelaxedSsl =
  /ondigitalocean\.com/i.test(connectionString) ||
  /[?&]sslmode=/i.test(connectionString);

const cleanUrl = connectionString
  .replace(
    /([?&])(sslmode|ssl|sslrootcert|sslcert|sslkey|sslpassword|uselibpqcompat)=[^&]*/gi,
    '$1',
  )
  .replace(/[?&]$/, '')
  .replace(/\?&/, '?')
  .replace(/&&+/g, '&');

const pool = new Pool({
  connectionString: cleanUrl,
  max: 5,
  connectionTimeoutMillis: 30_000,
  ...(needsRelaxedSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

type NormalizedMasterData = {
  categories: Array<{
    code: string;
    name: string;
    parentGroup:
      | 'POLYMERS'
      | 'COMPOUNDS'
      | 'MASTERBATCH'
      | 'ELASTOMERS'
      | 'CHEMICALS'
      | 'SOLVENTS'
      | 'INTERMEDIATES'
      | 'RECYCLED'
      | 'BASE_OILS'
      | 'SPECIALTY';
  }>;
  grades: Array<{
    code: string;
    name: string;
    displayName: string;
    categoryCode: string;
    description?: string;
    status: 'ACTIVE' | 'INACTIVE';
    customerVisible: boolean;
    sellerVisible: boolean;
    applications: string[];
  }>;
  applications: Array<{ code: string; name: string }>;
};

const ROLES = [
  {
    code: 'SUPER_ADMIN',
    name: 'Super Admin',
    description: 'Full platform access',
  },
  { code: 'ADMIN', name: 'Admin', description: 'Platform administration' },
  {
    code: 'PROCUREMENT_MANAGER',
    name: 'Procurement Manager',
    description: 'Owns procurement workbench',
  },
  {
    code: 'FINANCE_MANAGER',
    name: 'Finance Manager',
    description: 'Payments and settlements',
  },
  {
    code: 'OPERATIONS_MANAGER',
    name: 'Operations Manager',
    description: 'Orders, dispatch, shipments',
  },
  {
    code: 'COMPLIANCE_MANAGER',
    name: 'Compliance Manager',
    description: 'KYC, documents, verification',
  },
  { code: 'CUSTOMER', name: 'Customer', description: 'Customer organization user' },
  { code: 'SELLER', name: 'Seller', description: 'Seller organization user' },
] as const;

const PERMISSIONS = [
  { code: 'USER_READ', name: 'Read users', module: 'users' },
  { code: 'USER_WRITE', name: 'Write users', module: 'users' },
  { code: 'SELLER_READ', name: 'Read sellers', module: 'sellers' },
  { code: 'SELLER_APPROVE', name: 'Approve sellers', module: 'sellers' },
  { code: 'CUSTOMER_READ', name: 'Read customers', module: 'customers' },
  { code: 'CUSTOMER_WRITE', name: 'Write customers', module: 'customers' },
  { code: 'GRADE_READ', name: 'Read grades', module: 'grades' },
  { code: 'GRADE_WRITE', name: 'Write grades', module: 'grades' },
  { code: 'PRODUCT_READ', name: 'Read products', module: 'products' },
  { code: 'PRODUCT_WRITE', name: 'Write products', module: 'products' },
  { code: 'OFFER_CREATE', name: 'Create offers', module: 'offers' },
  { code: 'OFFER_UPDATE', name: 'Update offers', module: 'offers' },
  { code: 'OFFER_APPROVE', name: 'Approve offers', module: 'offers' },
  {
    code: 'PURCHASE_REQUEST_CREATE',
    name: 'Create purchase requests',
    module: 'purchase-requests',
  },
  {
    code: 'PURCHASE_REQUEST_APPROVE',
    name: 'Approve purchase requests',
    module: 'purchase-requests',
  },
  {
    code: 'PROCUREMENT_MANAGE',
    name: 'Manage procurement',
    module: 'procurement',
  },
  { code: 'ORDER_READ', name: 'Read orders', module: 'orders' },
  { code: 'ORDER_UPDATE', name: 'Update orders', module: 'orders' },
  { code: 'PAYMENT_READ', name: 'Read payments', module: 'payments' },
  { code: 'PAYMENT_APPROVE', name: 'Approve payments', module: 'payments' },
  { code: 'SHIPMENT_READ', name: 'Read shipments', module: 'shipments' },
  { code: 'SHIPMENT_UPDATE', name: 'Update shipments', module: 'shipments' },
  { code: 'DOCUMENT_UPLOAD', name: 'Upload documents', module: 'documents' },
  { code: 'DOCUMENT_VERIFY', name: 'Verify documents', module: 'documents' },
  { code: 'SETTLEMENT_READ', name: 'Read settlements', module: 'settlements' },
  {
    code: 'SETTLEMENT_APPROVE',
    name: 'Approve settlements',
    module: 'settlements',
  },
  { code: 'AUDIT_READ', name: 'Read audit logs', module: 'audit' },
  {
    code: 'NOTIFICATION_MANAGE',
    name: 'Manage notifications',
    module: 'notifications',
  },
] as const;

const ROLE_PERMISSION_MAP: Record<string, string[]> = {
  SUPER_ADMIN: PERMISSIONS.map((p) => p.code),
  ADMIN: PERMISSIONS.map((p) => p.code),
  PROCUREMENT_MANAGER: [
    'GRADE_READ',
    'PRODUCT_READ',
    'OFFER_CREATE',
    'OFFER_UPDATE',
    'OFFER_APPROVE',
    'PURCHASE_REQUEST_APPROVE',
    'PROCUREMENT_MANAGE',
    'ORDER_READ',
    'ORDER_UPDATE',
    'DOCUMENT_UPLOAD',
    'DOCUMENT_VERIFY',
  ],
  FINANCE_MANAGER: [
    'PAYMENT_READ',
    'PAYMENT_APPROVE',
    'SETTLEMENT_READ',
    'SETTLEMENT_APPROVE',
    'ORDER_READ',
    'DOCUMENT_VERIFY',
  ],
  OPERATIONS_MANAGER: [
    'ORDER_READ',
    'ORDER_UPDATE',
    'SHIPMENT_READ',
    'SHIPMENT_UPDATE',
    'DOCUMENT_UPLOAD',
  ],
  COMPLIANCE_MANAGER: [
    'SELLER_READ',
    'SELLER_APPROVE',
    'CUSTOMER_READ',
    'DOCUMENT_UPLOAD',
    'DOCUMENT_VERIFY',
    'AUDIT_READ',
  ],
  CUSTOMER: [
    'GRADE_READ',
    'PRODUCT_READ',
    'PURCHASE_REQUEST_CREATE',
    'ORDER_READ',
    'PAYMENT_READ',
    'SHIPMENT_READ',
    'DOCUMENT_UPLOAD',
  ],
  SELLER: [
    'GRADE_READ',
    'PRODUCT_READ',
    'PRODUCT_WRITE',
    'OFFER_CREATE',
    'OFFER_UPDATE',
    'ORDER_READ',
    'ORDER_UPDATE',
    'SHIPMENT_READ',
    'SHIPMENT_UPDATE',
    'SETTLEMENT_READ',
    'DOCUMENT_UPLOAD',
  ],
};

const UNITS = [
  { code: 'KG', name: 'Kilogram', symbol: 'kg', decimalPrecision: 2 },
  { code: 'MT', name: 'Metric Ton', symbol: 'MT', decimalPrecision: 3 },
  { code: 'TON', name: 'Ton', symbol: 't', decimalPrecision: 3 },
  { code: 'LTR', name: 'Litre', symbol: 'L', decimalPrecision: 2 },
  { code: 'PCS', name: 'Pieces', symbol: 'pcs', decimalPrecision: 0 },
  { code: 'DRUM', name: 'Drum', symbol: 'drum', decimalPrecision: 0 },
  { code: 'BAG', name: 'Bag', symbol: 'bag', decimalPrecision: 0 },
] as const;

const ATTRIBUTES = [
  { code: 'MFI', name: 'Melt Flow Index', dataType: AttributeDataType.DECIMAL },
  { code: 'DENSITY', name: 'Density', dataType: AttributeDataType.DECIMAL },
  { code: 'COLOR', name: 'Color', dataType: AttributeDataType.TEXT },
  { code: 'GRADE_TYPE', name: 'Grade Type', dataType: AttributeDataType.SELECT },
  {
    code: 'PACKAGING_TYPE',
    name: 'Packaging Type',
    dataType: AttributeDataType.SELECT,
  },
  { code: 'MOISTURE', name: 'Moisture', dataType: AttributeDataType.DECIMAL },
  {
    code: 'ASH_CONTENT',
    name: 'Ash Content',
    dataType: AttributeDataType.DECIMAL,
  },
] as const;

const PAYMENT_TERMS = [
  {
    code: 'ADVANCE_100',
    name: '100% Advance',
    paymentType: PaymentTermType.ADVANCE,
    days: 0,
    percentage: 100,
    sortOrder: 1,
  },
  {
    code: 'PARTIAL_ADVANCE',
    name: 'Partial Advance',
    paymentType: PaymentTermType.PARTIAL_ADVANCE,
    days: 0,
    percentage: 30,
    sortOrder: 2,
  },
  {
    code: 'ON_LOADING',
    name: 'On Loading',
    paymentType: PaymentTermType.ON_LOADING,
    days: 0,
    percentage: 100,
    sortOrder: 3,
  },
  {
    code: 'ON_DELIVERY',
    name: 'On Delivery',
    paymentType: PaymentTermType.ON_DELIVERY,
    days: 0,
    percentage: 100,
    sortOrder: 4,
  },
  {
    code: 'NET_7',
    name: 'Net 7',
    paymentType: PaymentTermType.NET_TERMS,
    days: 7,
    percentage: 100,
    sortOrder: 5,
  },
  {
    code: 'NET_15',
    name: 'Net 15',
    paymentType: PaymentTermType.NET_TERMS,
    days: 15,
    percentage: 100,
    sortOrder: 6,
  },
  {
    code: 'NET_30',
    name: 'Net 30',
    paymentType: PaymentTermType.NET_TERMS,
    days: 30,
    percentage: 100,
    sortOrder: 7,
  },
  {
    code: 'NET_45',
    name: 'Net 45',
    paymentType: PaymentTermType.NET_TERMS,
    days: 45,
    percentage: 100,
    sortOrder: 8,
  },
  {
    code: 'NET_60',
    name: 'Net 60',
    paymentType: PaymentTermType.NET_TERMS,
    days: 60,
    percentage: 100,
    sortOrder: 9,
  },
  {
    code: 'NET_90',
    name: 'Net 90',
    paymentType: PaymentTermType.NET_TERMS,
    days: 90,
    percentage: 100,
    sortOrder: 10,
  },
] as const;

function loadNormalizedMasterData(): NormalizedMasterData {
  const path = join(__dirname, 'seed-data', 'master-data.normalized.json');
  return JSON.parse(readFileSync(path, 'utf8')) as NormalizedMasterData;
}

async function seedRolesAndPermissions() {
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name, description: role.description },
      create: {
        code: role.code,
        name: role.name,
        description: role.description,
        isSystem: true,
      },
    });
  }

  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      update: {
        name: permission.name,
        module: permission.module,
      },
      create: {
        code: permission.code,
        name: permission.name,
        module: permission.module,
      },
    });
  }

  const roles = await prisma.role.findMany();
  const permissions = await prisma.permission.findMany();
  const roleByCode = Object.fromEntries(roles.map((r) => [r.code, r]));
  const permissionByCode = Object.fromEntries(
    permissions.map((p) => [p.code, p]),
  );

  for (const [roleCode, permissionCodes] of Object.entries(ROLE_PERMISSION_MAP)) {
    const role = roleByCode[roleCode];
    if (!role) continue;

    for (const permissionCode of permissionCodes) {
      const permission = permissionByCode[permissionCode];
      if (!permission) continue;

      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: permission.id,
        },
      });
    }
  }
}

async function seedMasterData() {
  const data = loadNormalizedMasterData();

  for (const [index, category] of data.categories.entries()) {
    await prisma.gradeCategory.upsert({
      where: { code: category.code },
      update: {
        name: category.name,
        displayName: category.name,
        parentGroup: category.parentGroup,
        status: MasterStatus.ACTIVE,
        isActive: true,
        sortOrder: index + 1,
        deletedAt: null,
      },
      create: {
        code: category.code,
        name: category.name,
        displayName: category.name,
        parentGroup: category.parentGroup,
        status: MasterStatus.ACTIVE,
        isActive: true,
        sortOrder: index + 1,
      },
    });
  }

  for (const [index, application] of data.applications.entries()) {
    await prisma.application.upsert({
      where: { code: application.code },
      update: {
        name: application.name,
        displayName: application.name,
        status: MasterStatus.ACTIVE,
        sortOrder: index + 1,
        deletedAt: null,
      },
      create: {
        code: application.code,
        name: application.name,
        displayName: application.name,
        status: MasterStatus.ACTIVE,
        sortOrder: index + 1,
      },
    });
  }

  for (const unit of UNITS) {
    await prisma.unit.upsert({
      where: { code: unit.code },
      update: {
        name: unit.name,
        symbol: unit.symbol,
        decimalPrecision: unit.decimalPrecision,
        status: MasterStatus.ACTIVE,
        deletedAt: null,
      },
      create: {
        code: unit.code,
        name: unit.name,
        symbol: unit.symbol,
        decimalPrecision: unit.decimalPrecision,
        status: MasterStatus.ACTIVE,
      },
    });
  }

  for (const [index, attribute] of ATTRIBUTES.entries()) {
    await prisma.productAttribute.upsert({
      where: { code: attribute.code },
      update: {
        name: attribute.name,
        displayName: attribute.name,
        dataType: attribute.dataType,
        status: MasterStatus.ACTIVE,
        sortOrder: index + 1,
        deletedAt: null,
      },
      create: {
        code: attribute.code,
        name: attribute.name,
        displayName: attribute.name,
        dataType: attribute.dataType,
        status: MasterStatus.ACTIVE,
        sortOrder: index + 1,
      },
    });
  }

  for (const term of PAYMENT_TERMS) {
    await prisma.paymentTerm.upsert({
      where: { code: term.code },
      update: {
        name: term.name,
        displayName: term.name,
        paymentType: term.paymentType,
        days: term.days,
        percentage: term.percentage,
        status: MasterStatus.ACTIVE,
        sortOrder: term.sortOrder,
        deletedAt: null,
      },
      create: {
        code: term.code,
        name: term.name,
        displayName: term.name,
        paymentType: term.paymentType,
        days: term.days,
        percentage: term.percentage,
        status: MasterStatus.ACTIVE,
        sortOrder: term.sortOrder,
      },
    });
  }

  const india = await prisma.location.upsert({
    where: { code: 'IN' },
    update: {
      name: 'India',
      type: LocationType.COUNTRY,
      countryCode: 'IN',
      status: MasterStatus.ACTIVE,
      deletedAt: null,
    },
    create: {
      code: 'IN',
      name: 'India',
      type: LocationType.COUNTRY,
      countryCode: 'IN',
      status: MasterStatus.ACTIVE,
    },
  });

  const maharashtra = await prisma.location.upsert({
    where: { code: 'IN-MH' },
    update: {
      name: 'Maharashtra',
      type: LocationType.STATE,
      parentId: india.id,
      countryCode: 'IN',
      stateCode: 'MH',
      status: MasterStatus.ACTIVE,
      deletedAt: null,
    },
    create: {
      code: 'IN-MH',
      name: 'Maharashtra',
      type: LocationType.STATE,
      parentId: india.id,
      countryCode: 'IN',
      stateCode: 'MH',
      status: MasterStatus.ACTIVE,
    },
  });

  const mumbai = await prisma.location.upsert({
    where: { code: 'IN-MH-MUM' },
    update: {
      name: 'Mumbai',
      type: LocationType.CITY,
      parentId: maharashtra.id,
      countryCode: 'IN',
      stateCode: 'MH',
      status: MasterStatus.ACTIVE,
      deletedAt: null,
    },
    create: {
      code: 'IN-MH-MUM',
      name: 'Mumbai',
      type: LocationType.CITY,
      parentId: maharashtra.id,
      countryCode: 'IN',
      stateCode: 'MH',
      status: MasterStatus.ACTIVE,
    },
  });

  await prisma.warehouse.upsert({
    where: { code: 'WH-MUM-HUB' },
    update: {
      name: 'Mumbai Platform Hub',
      locationId: mumbai.id,
      city: 'Mumbai',
      state: 'Maharashtra',
      country: 'IN',
      isPlatformHub: true,
      status: MasterStatus.ACTIVE,
      isActive: true,
      deletedAt: null,
    },
    create: {
      code: 'WH-MUM-HUB',
      name: 'Mumbai Platform Hub',
      locationId: mumbai.id,
      city: 'Mumbai',
      state: 'Maharashtra',
      country: 'IN',
      isPlatformHub: true,
      status: MasterStatus.ACTIVE,
      isActive: true,
    },
  });

  const categories = await prisma.gradeCategory.findMany();
  const categoryByCode = Object.fromEntries(categories.map((c) => [c.code, c]));
  const applications = await prisma.application.findMany();
  const applicationByName = Object.fromEntries(
    applications.map((a) => [a.name.toLowerCase(), a]),
  );

  for (const [index, grade] of data.grades.entries()) {
    const category = categoryByCode[grade.categoryCode];
    if (!category) continue;

    const upserted = await prisma.grade.upsert({
      where: { code: grade.code },
      update: {
        name: grade.name,
        displayName: grade.displayName,
        categoryId: category.id,
        description: grade.description,
        applications: grade.applications,
        status: grade.status,
        customerVisible: grade.customerVisible,
        sellerVisible: grade.sellerVisible,
        sortOrder: index + 1,
        deletedAt: null,
      },
      create: {
        code: grade.code,
        name: grade.name,
        displayName: grade.displayName,
        categoryId: category.id,
        description: grade.description,
        applications: grade.applications,
        status: grade.status,
        customerVisible: grade.customerVisible,
        sellerVisible: grade.sellerVisible,
        sortOrder: index + 1,
      },
    });

    for (const appName of grade.applications) {
      const application = applicationByName[appName.toLowerCase()];
      if (!application) continue;
      await prisma.gradeApplication.upsert({
        where: {
          gradeId_applicationId: {
            gradeId: upserted.id,
            applicationId: application.id,
          },
        },
        update: {},
        create: {
          gradeId: upserted.id,
          applicationId: application.id,
        },
      });
    }
  }

  return {
    categories: data.categories.length,
    grades: data.grades.length,
    applications: data.applications.length,
  };
}

async function seedDevUsers() {
  const bcrypt = await import('bcrypt');
  const passwordHash = await bcrypt.hash('Test@12345', 12);

  /**
   * Shared PetroTrade/Swaroop demo identity used across Customer + Seller panels:
   * phone 8240890242 · OTP 123456 (frontend/dev) · password Test@12345
   * Phone is unique in DB — attached to the customer account; seller keeps email login
   * and mirrors the same display name for UI consistency.
   */
  const users = [
    {
      email: 'customer@test.local',
      phone: '+918240890242',
      firstName: 'Karan',
      lastName: 'Veer',
      roles: ['CUSTOMER', 'SELLER'] as const,
    },
    {
      email: 'seller@test.local',
      phone: '+918240890243',
      firstName: 'Karan',
      lastName: 'Veer',
      roles: ['SELLER'] as const,
    },
    {
      email: 'admin@test.local',
      phone: '+919900000003',
      firstName: 'Demo',
      lastName: 'Admin',
      roles: ['ADMIN'] as const,
    },
  ] as const;

  for (const item of users) {
    const user = await prisma.user.upsert({
      where: { email: item.email },
      update: {
        phone: item.phone,
        firstName: item.firstName,
        lastName: item.lastName,
        passwordHash,
        status: 'ACTIVE',
        emailVerified: true,
        phoneVerified: true,
      },
      create: {
        email: item.email,
        phone: item.phone,
        firstName: item.firstName,
        lastName: item.lastName,
        passwordHash,
        status: 'ACTIVE',
        emailVerified: true,
        phoneVerified: true,
      },
    });

    for (const roleCode of item.roles) {
      const role = await prisma.role.findUnique({ where: { code: roleCode } });
      if (!role) continue;

      const existingRole = await prisma.userRole.findFirst({
        where: {
          userId: user.id,
          roleId: role.id,
          organizationId: null,
        },
      });

      if (!existingRole) {
        await prisma.userRole.create({
          data: {
            userId: user.id,
            roleId: role.id,
          },
        });
      }
    }
  }
}

async function seedSellerDemoData() {
  const sellerUser = await prisma.user.findUnique({
    where: { email: 'seller@test.local' },
  });
  const customerUser = await prisma.user.findUnique({
    where: { email: 'customer@test.local' },
  });
  if (!sellerUser || !customerUser) return;

  let sellerProfile = await prisma.sellerProfile.findUnique({
    where: { userId: sellerUser.id },
  });

  if (!sellerProfile) {
    const org = await prisma.organization.create({
      data: {
        code: 'SELLER-DEMO-01',
        name: 'Demo Seller Polymers',
        legalName: 'Demo Seller Polymers Pvt Ltd',
        type: 'SELLER',
        status: 'ACTIVE',
        gstin: '27AABCD1234A1Z5',
        pan: 'AABCD1234A',
        verificationStatus: 'APPROVED',
        verifiedAt: new Date(),
      },
    });
    await prisma.organizationMember.create({
      data: {
        organizationId: org.id,
        userId: sellerUser.id,
        isPrimary: true,
        joinedAt: new Date(),
      },
    });
    sellerProfile = await prisma.sellerProfile.create({
      data: {
        userId: sellerUser.id,
        organizationId: org.id,
        status: 'APPROVED',
        approvedAt: new Date(),
      },
    });
    await prisma.sellerVerification.create({
      data: {
        sellerProfileId: sellerProfile.id,
        gstVerified: true,
        panVerified: true,
        bankVerified: true,
        overallStatus: 'APPROVED',
        reviewedAt: new Date(),
      },
    });
    await prisma.sellerOnboarding.create({
      data: {
        sellerProfileId: sellerProfile.id,
        status: 'APPROVED',
        currentStep: 'completed',
        completedSteps: [
          'company',
          'gst',
          'pan',
          'bank',
          'address',
          'documents',
          'submitted',
        ],
        companyData: { legalName: 'Demo Seller Polymers Pvt Ltd', name: 'Demo Seller Polymers' },
        gstData: { gstin: '27AABCD1234A1Z5' },
        panData: { pan: 'AABCD1234A' },
        bankData: {
          accountHolder: 'Demo Seller Polymers',
          bankName: 'HDFC Bank',
          accountNumber: '1234567890',
          ifsc: 'HDFC0001234',
        },
        addressData: {
          line1: 'Andheri East',
          city: 'Mumbai',
          state: 'Maharashtra',
          postalCode: '400069',
        },
        submittedAt: new Date(),
        reviewedAt: new Date(),
      },
    });
  } else {
    await prisma.sellerProfile.update({
      where: { id: sellerProfile.id },
      data: { status: 'APPROVED', approvedAt: new Date() },
    });
    await prisma.sellerOnboarding.upsert({
      where: { sellerProfileId: sellerProfile.id },
      update: { status: 'APPROVED', currentStep: 'completed' },
      create: {
        sellerProfileId: sellerProfile.id,
        status: 'APPROVED',
        currentStep: 'completed',
      },
    });
  }

  let customerOrg = await prisma.organization.findFirst({
    where: { code: 'CUSTOMER-DEMO-01' },
  });
  if (!customerOrg) {
    customerOrg = await prisma.organization.create({
      data: {
        code: 'CUSTOMER-DEMO-01',
        name: 'Confidential Buyer Industries',
        legalName: 'Confidential Buyer Industries Pvt Ltd',
        type: 'CUSTOMER',
        status: 'ACTIVE',
        email: 'buyer-secret@test.local',
        phone: '+919900009999',
      },
    });
    await prisma.organizationMember.create({
      data: {
        organizationId: customerOrg.id,
        userId: customerUser.id,
        isPrimary: true,
        joinedAt: new Date(),
      },
    });
    await prisma.customerProfile.upsert({
      where: { userId: customerUser.id },
      update: { organizationId: customerOrg.id, status: 'ACTIVE' },
      create: {
        userId: customerUser.id,
        organizationId: customerOrg.id,
        status: 'ACTIVE',
      },
    });
  }

  const grade = await prisma.grade.findFirst({
    where: { code: 'HDPE_FILM', deletedAt: null },
  });
  const warehouse = await prisma.warehouse.findUnique({
    where: { code: 'WH-MUM-HUB' },
  });
  if (!grade || !warehouse) return;

  const product = await prisma.product.upsert({
    where: {
      organizationId_code: {
        organizationId: sellerProfile.organizationId,
        code: 'DEMO-HDPE-FILM',
      },
    },
    update: {
      name: 'Demo HDPE Film',
      gradeId: grade.id,
      status: 'ACTIVE',
      sellerProfileId: sellerProfile.id,
    },
    create: {
      organizationId: sellerProfile.organizationId,
      sellerProfileId: sellerProfile.id,
      gradeId: grade.id,
      code: 'DEMO-HDPE-FILM',
      name: 'Demo HDPE Film',
      unit: 'MT',
      status: 'ACTIVE',
      packaging: '25kg bags',
    },
  });

  await prisma.inventory.upsert({
    where: {
      productId_warehouseId: {
        productId: product.id,
        warehouseId: warehouse.id,
      },
    },
    update: {
      availableQty: 120,
      minStockQty: 10,
      status: 'AVAILABLE',
      sellerProfileId: sellerProfile.id,
    },
    create: {
      organizationId: sellerProfile.organizationId,
      sellerProfileId: sellerProfile.id,
      productId: product.id,
      warehouseId: warehouse.id,
      availableQty: 120,
      minStockQty: 10,
      unit: 'MT',
      status: 'AVAILABLE',
    },
  });

  const offer = await prisma.offer.upsert({
    where: { referenceNumber: 'OFFER-2026-000001' },
    update: {
      status: 'ACTIVE',
      basePrice: 95,
      quantity: 100,
      productId: product.id,
      gradeId: grade.id,
    },
    create: {
      referenceNumber: 'OFFER-2026-000001',
      organizationId: sellerProfile.organizationId,
      sellerProfileId: sellerProfile.id,
      productId: product.id,
      gradeId: grade.id,
      warehouseId: warehouse.id,
      quantity: 100,
      moq: 10,
      unit: 'MT',
      basePrice: 95,
      currency: 'INR',
      status: 'ACTIVE',
      createdById: sellerUser.id,
    },
  });

  await prisma.offerPriceTier.deleteMany({ where: { offerId: offer.id } });
  await prisma.offerPriceTier.createMany({
    data: [
      { offerId: offer.id, minQty: 0, maxQty: 9, price: 98 },
      { offerId: offer.id, minQty: 10, maxQty: 49, price: 96 },
      { offerId: offer.id, minQty: 50, maxQty: null, price: 94 },
    ],
  });

  await prisma.purchaseRequest.upsert({
    where: { referenceNumber: 'PR-2026-000123' },
    update: {
      status: 'SOURCING',
      sellerOrgId: sellerProfile.organizationId,
      destinationRegion: 'West India',
      deliveryLocation: 'Andheri East, Mumbai, Maharashtra 400069',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    create: {
      referenceNumber: 'PR-2026-000123',
      customerOrgId: customerOrg.id,
      sellerOrgId: sellerProfile.organizationId,
      createdById: customerUser.id,
      status: 'SOURCING',
      paymentMethod: 'ADVANCE',
      destinationRegion: 'West India',
      deliveryLocation: 'Andheri East, Mumbai, Maharashtra 400069',
      requiredByDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      submittedAt: new Date(),
      notes: 'Need natural film grade',
      items: {
        create: [
          {
            gradeId: grade.id,
            productId: product.id,
            quantity: 100,
            unit: 'MT',
            packaging: '25kg bags',
          },
        ],
      },
    },
  });
}

async function main() {
  console.log('Seeding SWAROOP Phase 4/5 master + seller demo data...');
  await seedRolesAndPermissions();
  const counts = await seedMasterData();
  await seedDevUsers();
  await seedSellerDemoData();
  const catalog = await runCatalogImport(prisma);
  console.log(
    `Seed completed: ${counts.categories} categories, ${counts.grades} grades, catalog products inserted=${catalog.products.inserted} updated=${catalog.products.updated}, offers inserted=${catalog.listings.inserted}, and DEVELOPMENT users.`,
  );
}

main()
  .catch((error) => {
    console.error('Seed failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
