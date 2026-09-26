import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  CustomerStatus,
  GradeParentGroup,
  GradeStatus,
  InventoryStatus,
  MasterStatus,
  OrganizationType,
  Prisma,
  ProductStatus,
  SellerStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { CryptoService } from './crypto.service.js';

/** Shared Customer + Seller demo identity (Karan Veer). */
export const DEMO_PHONE_E164 = '+918240890242';
const DEMO_CUSTOMER_EMAIL = 'customer@test.local';
const DEMO_SELLER_EMAIL = 'seller@test.local';
const DEMO_ADMIN_EMAIL = 'admin@test.local';
const DEMO_ADMIN_PHONE = '+919900000003';
const DEMO_PASSWORD = 'Test@12345';
const HD_FILM_SKR_CODE = 'HDPE_FILM';
const HD_FILM_SKR_NAME = 'HD Film SKR';

type NormalizedMasterData = {
  categories: Array<{
    code: string;
    name: string;
    parentGroup: keyof typeof GradeParentGroup | string;
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

@Injectable()
export class DemoBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(DemoBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async onModuleInit(): Promise<void> {
    // PetroTrade demo stack keeps admin@test.local / Test@12345 usable on DO.
    // Set ENSURE_DEMO_USERS=false to skip.
    if (process.env.ENSURE_DEMO_USERS === 'false') return;
    try {
      await this.ensureDemoAccounts();
    } catch (error) {
      this.logger.error(
        'Failed to ensure demo accounts on startup',
        error instanceof Error ? error.stack : error,
      );
    }
  }

  isDemoUser(input: { phone?: string | null; email?: string | null }): boolean {
    return (
      input.phone === DEMO_PHONE_E164 ||
      input.phone === DEMO_ADMIN_PHONE ||
      input.email === DEMO_CUSTOMER_EMAIL ||
      input.email === DEMO_SELLER_EMAIL ||
      input.email === DEMO_ADMIN_EMAIL
    );
  }

  /**
   * Idempotent bootstrap for DigitalOcean / empty DBs:
   * seller+customer profiles, Mumbai+Kolkata warehouses, Grade Master,
   * full marketplace catalog listings, and the HD Film SKR SKU.
   */
  async ensureForDemoUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !this.isDemoUser(user)) return;

    try {
      await this.ensureDemoAdminUser();
      // Admin-only logins should not rebuild seller catalog every time.
      if (user.email === DEMO_ADMIN_EMAIL) {
        this.logger.log(`Demo admin ready for user ${userId}`);
        return;
      }
      await this.ensureSellerSide(userId);
      await this.ensureCustomerSide(userId);
      await this.ensureMasterCatalog();
      await this.ensureHdFilmSkrListing(userId);
      await this.ensureFullMarketplaceCatalog(userId);
      this.logger.log(`Demo bootstrap completed for user ${userId}`);
    } catch (error) {
      this.logger.error(
        `Demo bootstrap failed for user ${userId}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /** Ensure demo admin/seller/customer accounts exist (startup + remote seed). */
  async ensureDemoAccounts(): Promise<void> {
    await this.ensureRole(RoleCode.ADMIN);
    await this.ensureRole(RoleCode.SUPER_ADMIN);
    await this.ensureRole(RoleCode.SELLER);
    await this.ensureRole(RoleCode.CUSTOMER);
    await this.ensureDemoAdminUser();
    this.logger.log(
      `Demo accounts ensured (${DEMO_ADMIN_EMAIL} / ${DEMO_PASSWORD})`,
    );
  }

  private async ensureRole(code: RoleCode): Promise<void> {
    await this.prisma.role.upsert({
      where: { code },
      update: { name: code },
      create: { code, name: code },
    });
  }

  /** Upsert admin@test.local so Admin Vercel portal can sign in against DO DB. */
  async ensureDemoAdminUser(): Promise<void> {
    await this.ensureRole(RoleCode.ADMIN);
    await this.ensureRole(RoleCode.SUPER_ADMIN);
    const passwordHash = await this.crypto.hashPassword(DEMO_PASSWORD);

    let admin = await this.prisma.user.findUnique({
      where: { email: DEMO_ADMIN_EMAIL },
    });
    if (!admin) {
      admin = await this.prisma.user.findUnique({
        where: { phone: DEMO_ADMIN_PHONE },
      });
    }

    if (admin) {
      await this.prisma.user.update({
        where: { id: admin.id },
        data: {
          email: DEMO_ADMIN_EMAIL,
          phone: DEMO_ADMIN_PHONE,
          firstName: 'Demo',
          lastName: 'Admin',
          passwordHash,
          status: 'ACTIVE',
          emailVerified: true,
          phoneVerified: true,
        },
      });
    } else {
      admin = await this.prisma.user.create({
        data: {
          email: DEMO_ADMIN_EMAIL,
          phone: DEMO_ADMIN_PHONE,
          firstName: 'Demo',
          lastName: 'Admin',
          passwordHash,
          status: 'ACTIVE',
          emailVerified: true,
          phoneVerified: true,
        },
      });
    }

    for (const roleCode of [RoleCode.ADMIN, RoleCode.SUPER_ADMIN] as const) {
      const role = await this.prisma.role.findUnique({ where: { code: roleCode } });
      if (!role) continue;
      const existing = await this.prisma.userRole.findFirst({
        where: { userId: admin.id, roleId: role.id, organizationId: null },
      });
      if (!existing) {
        await this.prisma.userRole.create({
          data: { userId: admin.id, roleId: role.id },
        });
      }
    }
  }

  private async ensureSellerSide(demoUserId: string): Promise<void> {
    await this.prisma.role.upsert({
      where: { code: RoleCode.SELLER },
      update: { name: 'SELLER' },
      create: { code: RoleCode.SELLER, name: 'SELLER' },
    });

    const passwordHash = await this.crypto.hashPassword(DEMO_PASSWORD);
    let sellerEmailUser = await this.prisma.user.findUnique({
      where: { email: DEMO_SELLER_EMAIL },
    });
    if (sellerEmailUser) {
      await this.prisma.user.update({
        where: { id: sellerEmailUser.id },
        data: {
          passwordHash,
          firstName: 'Karan',
          lastName: 'Veer',
          phone: '+918240890243',
          status: 'ACTIVE',
          emailVerified: true,
          phoneVerified: true,
        },
      });
    } else {
      sellerEmailUser = await this.prisma.user.create({
        data: {
          email: DEMO_SELLER_EMAIL,
          phone: '+918240890243',
          firstName: 'Karan',
          lastName: 'Veer',
          passwordHash,
          status: 'ACTIVE',
          emailVerified: true,
          phoneVerified: true,
          userRoles: {
            create: { role: { connect: { code: RoleCode.SELLER } } },
          },
        },
      });
    }

    for (const userId of [demoUserId, sellerEmailUser.id]) {
      await this.ensureSellerProfileAndWarehouses(userId);
    }
  }

  private async ensureSellerProfileAndWarehouses(userId: string): Promise<void> {
    let profile = await this.prisma.sellerProfile.findFirst({
      where: { userId, deletedAt: null },
    });

    if (!profile) {
      const org = await this.prisma.organization.create({
        data: {
          code: `SELLER-DEMO-${userId.slice(0, 8).toUpperCase()}`,
          name: 'Karan Veer Trading',
          legalName: 'Karan Veer Trading Pvt Ltd',
          type: OrganizationType.SELLER,
          status: 'ACTIVE',
          verificationStatus: 'APPROVED',
          verifiedAt: new Date(),
        },
      });
      await this.prisma.organizationMember.create({
        data: {
          organizationId: org.id,
          userId,
          isPrimary: true,
          joinedAt: new Date(),
        },
      });
      profile = await this.prisma.sellerProfile.create({
        data: {
          userId,
          organizationId: org.id,
          status: SellerStatus.APPROVED,
          approvedAt: new Date(),
        },
      });
      await this.prisma.sellerVerification.create({
        data: {
          sellerProfileId: profile.id,
          gstVerified: true,
          panVerified: true,
          bankVerified: true,
          overallStatus: 'APPROVED',
          reviewedAt: new Date(),
        },
      });
      await this.prisma.sellerOnboarding.create({
        data: {
          sellerProfileId: profile.id,
          status: 'APPROVED',
          currentStep: 'completed',
          completedSteps: [
            'company',
            'gst',
            'pan',
            'bank',
            'address',
            'submitted',
          ],
          companyData: {
            legalName: 'Karan Veer Trading Pvt Ltd',
            name: 'Karan Veer Trading',
          },
          addressData: {
            line1: 'Andheri East',
            city: 'Mumbai',
            state: 'Maharashtra',
            postalCode: '400069',
          },
          locationData: {
            city: 'Mumbai',
            state: 'Maharashtra',
            pincode: '400069',
            warehouseName: 'Mumbai Primary Warehouse',
            warehouseAddress: 'Andheri East, Mumbai',
          },
          submittedAt: new Date(),
          reviewedAt: new Date(),
        },
      });
    } else if (profile.status !== SellerStatus.APPROVED) {
      await this.prisma.sellerProfile.update({
        where: { id: profile.id },
        data: { status: SellerStatus.APPROVED, approvedAt: new Date() },
      });
    }

    await this.ensureWarehouse(profile.organizationId, {
      code: `WH-MUM-${userId.slice(0, 6).toUpperCase()}`,
      name: 'Mumbai Primary Warehouse',
      city: 'Mumbai',
      state: 'Maharashtra',
      postalCode: '400069',
      addressLine: 'Andheri East, Mumbai',
    });

    await this.ensureWarehouse(profile.organizationId, {
      code: `WH-KOL-${userId.slice(0, 6).toUpperCase()}`,
      name: 'Kolkata',
      city: 'Kolkata',
      state: 'West Bengal',
      postalCode: '700001',
      addressLine: 'Kolkata Warehouse',
    });
  }

  private async ensureWarehouse(
    organizationId: string,
    input: {
      code: string;
      name: string;
      city: string;
      state: string;
      postalCode: string;
      addressLine: string;
    },
  ) {
    const existing = await this.prisma.warehouse.findFirst({
      where: {
        organizationId,
        deletedAt: null,
        OR: [
          { code: input.code },
          { name: { equals: input.name, mode: 'insensitive' } },
          { city: { equals: input.city, mode: 'insensitive' } },
        ],
      },
    });
    if (existing) {
      if (!existing.isActive) {
        await this.prisma.warehouse.update({
          where: { id: existing.id },
          data: { isActive: true, status: MasterStatus.ACTIVE },
        });
      }
      return existing;
    }

    return this.prisma.warehouse.create({
      data: {
        organizationId,
        code: input.code,
        name: input.name,
        city: input.city,
        state: input.state,
        country: 'IN',
        postalCode: input.postalCode,
        addressLine: input.addressLine,
        isPlatformHub: false,
        isActive: true,
        status: MasterStatus.ACTIVE,
        metadata: { source: 'demo_bootstrap' },
      },
    });
  }

  private async ensureCustomerSide(userId: string): Promise<void> {
    await this.prisma.role.upsert({
      where: { code: RoleCode.CUSTOMER },
      update: { name: 'CUSTOMER' },
      create: { code: RoleCode.CUSTOMER, name: 'CUSTOMER' },
    });

    const role = await this.prisma.role.findUnique({
      where: { code: RoleCode.CUSTOMER },
    });
    if (role) {
      const existingRole = await this.prisma.userRole.findFirst({
        where: { userId, roleId: role.id, organizationId: null },
      });
      if (!existingRole) {
        await this.prisma.userRole.create({
          data: { userId, roleId: role.id },
        });
      }
    }

    const existing = await this.prisma.customerProfile.findFirst({
      where: { userId, deletedAt: null },
    });
    if (existing) {
      if (existing.status !== CustomerStatus.ACTIVE) {
        await this.prisma.customerProfile.update({
          where: { id: existing.id },
          data: { status: CustomerStatus.ACTIVE },
        });
      }
      return;
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const org = await this.prisma.organization.create({
      data: {
        code: `CUSTOMER-DEMO-${userId.slice(0, 8).toUpperCase()}`,
        name: 'Karan Veer Industries',
        legalName: 'Karan Veer Industries Pvt Ltd',
        type: OrganizationType.CUSTOMER,
        status: 'ACTIVE',
        email: user?.email ?? DEMO_CUSTOMER_EMAIL,
        phone: user?.phone ?? DEMO_PHONE_E164,
        verificationStatus: 'APPROVED',
        verifiedAt: new Date(),
      },
    });
    await this.prisma.organizationMember.create({
      data: {
        organizationId: org.id,
        userId,
        isPrimary: true,
        joinedAt: new Date(),
      },
    });
    await this.prisma.customerProfile.create({
      data: {
        userId,
        organizationId: org.id,
        status: CustomerStatus.ACTIVE,
      },
    });
  }

  private resolveMasterDataPath(): string {
    const candidates = [
      join(process.cwd(), 'prisma/seed-data/master-data.normalized.json'),
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../prisma/seed-data/master-data.normalized.json',
      ),
    ];
    for (const path of candidates) {
      try {
        readFileSync(path, 'utf8');
        return path;
      } catch {
        // try next
      }
    }
    throw new Error('master-data.normalized.json not found');
  }

  private async ensureMasterCatalog(): Promise<void> {
    // Always upsert master data so partial / older DigitalOcean DBs catch up.
    const raw = readFileSync(this.resolveMasterDataPath(), 'utf8');
    const data = JSON.parse(raw) as NormalizedMasterData;

    for (const [index, app] of data.applications.entries()) {
      await this.prisma.application.upsert({
        where: { code: app.code },
        update: { name: app.name, status: MasterStatus.ACTIVE, sortOrder: index },
        create: {
          code: app.code,
          name: app.name,
          status: MasterStatus.ACTIVE,
          sortOrder: index,
        },
      });
    }

    for (const [index, category] of data.categories.entries()) {
      const parentGroup =
        GradeParentGroup[category.parentGroup as keyof typeof GradeParentGroup] ??
        GradeParentGroup.POLYMERS;
      await this.prisma.gradeCategory.upsert({
        where: { code: category.code },
        update: {
          name: category.name,
          displayName: category.name,
          parentGroup,
          status: MasterStatus.ACTIVE,
          isActive: true,
          sortOrder: index,
          deletedAt: null,
        },
        create: {
          code: category.code,
          name: category.name,
          displayName: category.name,
          parentGroup,
          status: MasterStatus.ACTIVE,
          isActive: true,
          sortOrder: index,
        },
      });
    }

    const categories = await this.prisma.gradeCategory.findMany();
    const categoryByCode = Object.fromEntries(
      categories.map((c) => [c.code, c]),
    );

    for (const [index, grade] of data.grades.entries()) {
      const category = categoryByCode[grade.categoryCode];
      if (!category) continue;
      await this.prisma.grade.upsert({
        where: { code: grade.code },
        update: {
          name: grade.name,
          displayName: grade.displayName,
          categoryId: category.id,
          description: grade.description,
          applications: grade.applications,
          status: grade.status === 'ACTIVE' ? GradeStatus.ACTIVE : GradeStatus.INACTIVE,
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
          status: grade.status === 'ACTIVE' ? GradeStatus.ACTIVE : GradeStatus.INACTIVE,
          customerVisible: grade.customerVisible,
          sellerVisible: grade.sellerVisible,
          sortOrder: index + 1,
        },
      });
    }

    await this.ensureHdpeFilmGrade();
    this.logger.log(
      `Synced master catalog: ${data.categories.length} categories, ${data.grades.length} grades`,
    );
  }

  private async ensureHdpeFilmGrade() {
    let category = await this.prisma.gradeCategory.findUnique({
      where: { code: 'HDPE' },
    });
    if (!category) {
      category = await this.prisma.gradeCategory.create({
        data: {
          code: 'HDPE',
          name: 'HDPE',
          displayName: 'HDPE',
          parentGroup: GradeParentGroup.POLYMERS,
          status: MasterStatus.ACTIVE,
          isActive: true,
        },
      });
    }

    await this.prisma.grade.upsert({
      where: { code: 'HDPE_FILM' },
      update: {
        name: 'HD Film',
        displayName: 'HD Film',
        categoryId: category.id,
        status: GradeStatus.ACTIVE,
        customerVisible: true,
        sellerVisible: true,
        deletedAt: null,
      },
      create: {
        code: 'HDPE_FILM',
        name: 'HD Film',
        displayName: 'HD Film',
        categoryId: category.id,
        status: GradeStatus.ACTIVE,
        customerVisible: true,
        sellerVisible: true,
        applications: ['SKR'],
      },
    });
  }

  private async ensureHdFilmSkrListing(userId: string): Promise<void> {
    const profile = await this.prisma.sellerProfile.findFirst({
      where: { userId, deletedAt: null },
    });
    if (!profile) return;

    await this.ensureHdpeFilmGrade();
    const grade = await this.prisma.grade.findUnique({
      where: { code: 'HDPE_FILM' },
    });
    if (!grade) return;

    let warehouse = await this.prisma.warehouse.findFirst({
      where: {
        organizationId: profile.organizationId,
        deletedAt: null,
        OR: [
          { city: { equals: 'Kolkata', mode: 'insensitive' } },
          { name: { equals: 'Kolkata', mode: 'insensitive' } },
          { code: { startsWith: 'WH-KOL-' } },
        ],
      },
    });
    if (!warehouse) {
      warehouse = await this.ensureWarehouse(profile.organizationId, {
        code: `WH-KOL-${userId.slice(0, 6).toUpperCase()}`,
        name: 'Kolkata',
        city: 'Kolkata',
        state: 'West Bengal',
        postalCode: '700001',
        addressLine: 'Kolkata Warehouse',
      });
    }

    const product = await this.prisma.product.upsert({
      where: {
        organizationId_code: {
          organizationId: profile.organizationId,
          code: HD_FILM_SKR_CODE,
        },
      },
      update: {
        name: HD_FILM_SKR_NAME,
        gradeId: grade.id,
        brand: 'SCG',
        manufacturer: 'SCG',
        mfi: '3.2',
        density: '0.95',
        packaging: '25 kg bags',
        unit: 'MT',
        countryOfOrigin: 'India',
        supplyOrigin: 'India',
        status: ProductStatus.ACTIVE,
        sellerProfileId: profile.id,
        technicalSpecs: {
          application: 'SKR',
          polymerType: 'HDPE',
          applications: ['SKR'],
          warehouseLabel: 'Kolkata',
        },
        deletedAt: null,
      },
      create: {
        organizationId: profile.organizationId,
        sellerProfileId: profile.id,
        gradeId: grade.id,
        code: HD_FILM_SKR_CODE,
        name: HD_FILM_SKR_NAME,
        brand: 'SCG',
        manufacturer: 'SCG',
        mfi: '3.2',
        density: '0.95',
        packaging: '25 kg bags',
        unit: 'MT',
        countryOfOrigin: 'India',
        supplyOrigin: 'India',
        status: ProductStatus.ACTIVE,
        technicalSpecs: {
          application: 'SKR',
          polymerType: 'HDPE',
          applications: ['SKR'],
          warehouseLabel: 'Kolkata',
        },
      },
    });

    await this.prisma.inventory.upsert({
      where: {
        productId_warehouseId: {
          productId: product.id,
          warehouseId: warehouse.id,
        },
      },
      update: {
        availableQty: 850,
        minStockQty: 10,
        status: InventoryStatus.AVAILABLE,
        sellerProfileId: profile.id,
        deletedAt: null,
      },
      create: {
        organizationId: profile.organizationId,
        sellerProfileId: profile.id,
        productId: product.id,
        warehouseId: warehouse.id,
        availableQty: 850,
        minStockQty: 10,
        unit: 'MT',
        status: InventoryStatus.AVAILABLE,
      },
    });

    const existingOffer = await this.prisma.offer.findFirst({
      where: {
        productId: product.id,
        organizationId: profile.organizationId,
        deletedAt: null,
      },
    });

    const offer =
      existingOffer ??
      (await this.prisma.offer.create({
        data: {
          referenceNumber: `OFFER-SKR-${product.id.slice(0, 8).toUpperCase()}`,
          organizationId: profile.organizationId,
          sellerProfileId: profile.id,
          productId: product.id,
          gradeId: grade.id,
          warehouseId: warehouse.id,
          quantity: 850,
          moq: 12,
          unit: 'MT',
          basePrice: 94500,
          currency: 'INR',
          status: 'ACTIVE',
          createdById: userId,
        },
      }));

    if (existingOffer && existingOffer.status !== 'ACTIVE') {
      await this.prisma.offer.update({
        where: { id: existingOffer.id },
        data: {
          status: 'ACTIVE',
          basePrice: 94500,
          quantity: 850,
          moq: 12,
          warehouseId: warehouse.id,
        },
      });
    }

    const tierCount = await this.prisma.offerPriceTier.count({
      where: { offerId: offer.id },
    });
    if (!tierCount) {
      await this.prisma.offerPriceTier.createMany({
        data: [
          { offerId: offer.id, minQty: 0, maxQty: 11, price: 96000 },
          { offerId: offer.id, minQty: 12, maxQty: 49, price: 94500 },
          { offerId: offer.id, minQty: 50, maxQty: null, price: 93000 },
        ],
      });
    }

    // Point current location at Kolkata so seller UI is not stuck on empty selection.
    const metadata = {
      ...(profile.metadata &&
      typeof profile.metadata === 'object' &&
      !Array.isArray(profile.metadata)
        ? (profile.metadata as Record<string, unknown>)
        : {}),
      currentWarehouseId: warehouse.id,
    };
    await this.prisma.sellerProfile.update({
      where: { id: profile.id },
      data: { metadata: metadata as Prisma.InputJsonValue },
    });
  }

  private resolveCatalogPath(): string {
    const candidates = [
      join(process.cwd(), 'prisma/seed-data/catalog-products.json'),
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../prisma/seed-data/catalog-products.json',
      ),
    ];
    for (const path of candidates) {
      try {
        readFileSync(path, 'utf8');
        return path;
      } catch {
        // try next
      }
    }
    throw new Error('catalog-products.json not found');
  }

  /**
   * Ensures the full frontend catalog is listed for the demo seller.
   * Skips when enough ACTIVE products already exist (idempotent / fast path).
   */
  private async ensureFullMarketplaceCatalog(userId: string): Promise<void> {
    const profile = await this.prisma.sellerProfile.findFirst({
      where: { userId, deletedAt: null },
    });
    if (!profile) return;

    let catalog: {
      products: Array<{
        sourceId: string;
        name: string;
        productCode: string;
        gradeMasterCode: string;
        materialType?: string;
        description?: string;
        pricePerMt: number;
        unit: string;
        origin?: string;
        warehouseLabel?: string;
        availableQty: number;
        moq: number;
        eta?: string;
        applications: string[];
        supplyOrigin?: string;
        technicalSpecs?: Record<string, string>;
      }>;
    };
    try {
      catalog = JSON.parse(readFileSync(this.resolveCatalogPath(), 'utf8')) as typeof catalog;
    } catch (error) {
      this.logger.warn(
        `Full catalog seed skipped — ${error instanceof Error ? error.message : error}`,
      );
      return;
    }

    const expected = catalog.products?.length ?? 0;
    if (expected === 0) return;

    const existingCount = await this.prisma.product.count({
      where: {
        organizationId: profile.organizationId,
        deletedAt: null,
        status: ProductStatus.ACTIVE,
      },
    });
    // Leave headroom for HD Film SKR + a couple of extras.
    if (existingCount >= expected) {
      this.logger.log(
        `Full catalog already present (${existingCount} products) — skip import`,
      );
      return;
    }

    const hub =
      (await this.prisma.warehouse.findFirst({
        where: {
          organizationId: profile.organizationId,
          deletedAt: null,
          OR: [
            { code: 'WH-MUM-HUB' },
            { code: { startsWith: 'WH-MUM-' } },
            { city: { equals: 'Mumbai', mode: 'insensitive' } },
          ],
        },
      })) ??
      (await this.ensureWarehouse(profile.organizationId, {
        code: 'WH-MUM-HUB',
        name: 'Mumbai Primary Warehouse',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400069',
        addressLine: 'Andheri East, Mumbai',
      }));

    const grades = await this.prisma.grade.findMany({
      where: { deletedAt: null },
      select: { id: true, code: true },
    });
    const gradeByCode = new Map(grades.map((g) => [g.code.toUpperCase(), g]));

    let inserted = 0;
    for (const item of catalog.products) {
      if (
        !item.productCode ||
        item.productCode === 'DEMO-HDPE-FILM' ||
        item.productCode === 'HDPE_FILM'
      ) {
        continue;
      }
      const grade = gradeByCode.get(
        String(item.gradeMasterCode || '').toUpperCase(),
      );
      if (!grade) continue;

      const product = await this.prisma.product.upsert({
        where: {
          organizationId_code: {
            organizationId: profile.organizationId,
            code: item.productCode,
          },
        },
        update: {
          name: item.name,
          gradeId: grade.id,
          brand: 'PRIVATE',
          description: item.description,
          technicalSpecs: {
            ...(item.technicalSpecs ?? {}),
            sourceId: item.sourceId,
            applications: item.applications,
            materialType: item.materialType,
            warehouseLabel: item.warehouseLabel,
          },
          mfi: item.technicalSpecs?.mfi ?? null,
          density: item.technicalSpecs?.density ?? null,
          packaging: '25kg bags',
          unit: item.unit || 'MT',
          countryOfOrigin: item.origin || 'IN',
          supplyOrigin: item.supplyOrigin ?? 'domestic',
          status: ProductStatus.ACTIVE,
          sellerProfileId: profile.id,
          deletedAt: null,
        },
        create: {
          organizationId: profile.organizationId,
          sellerProfileId: profile.id,
          gradeId: grade.id,
          code: item.productCode,
          name: item.name,
          brand: 'PRIVATE',
          description: item.description,
          technicalSpecs: {
            ...(item.technicalSpecs ?? {}),
            sourceId: item.sourceId,
            applications: item.applications,
            materialType: item.materialType,
            warehouseLabel: item.warehouseLabel,
          },
          mfi: item.technicalSpecs?.mfi ?? null,
          density: item.technicalSpecs?.density ?? null,
          packaging: '25kg bags',
          unit: item.unit || 'MT',
          countryOfOrigin: item.origin || 'IN',
          supplyOrigin: item.supplyOrigin ?? 'domestic',
          status: ProductStatus.ACTIVE,
        },
      });

      await this.prisma.inventory.upsert({
        where: {
          productId_warehouseId: {
            productId: product.id,
            warehouseId: hub.id,
          },
        },
        update: {
          availableQty: item.availableQty,
          minStockQty: item.moq,
          status: InventoryStatus.AVAILABLE,
          sellerProfileId: profile.id,
          unit: item.unit || 'MT',
          deletedAt: null,
        },
        create: {
          organizationId: profile.organizationId,
          sellerProfileId: profile.id,
          productId: product.id,
          warehouseId: hub.id,
          availableQty: item.availableQty,
          minStockQty: item.moq,
          unit: item.unit || 'MT',
          status: InventoryStatus.AVAILABLE,
        },
      });

      const offerRef = `OFFER-CAT-${item.productCode
        .replace(/[^A-Z0-9]+/gi, '-')
        .toUpperCase()}`;
      const sellingPrice = Number(item.pricePerMt);
      const moq = Math.max(1, Number(item.moq ?? 1));
      const offer = await this.prisma.offer.upsert({
        where: { referenceNumber: offerRef },
        update: {
          status: 'ACTIVE',
          basePrice: sellingPrice,
          quantity: item.availableQty,
          moq,
          unit: item.unit || 'MT',
          currency: 'INR',
          productId: product.id,
          gradeId: grade.id,
          warehouseId: hub.id,
          deliveryTerms: item.eta ?? null,
          visibility: 'MARKETPLACE',
          deletedAt: null,
          metadata: { gstPercent: 18 } as Prisma.InputJsonValue,
        },
        create: {
          referenceNumber: offerRef,
          organizationId: profile.organizationId,
          sellerProfileId: profile.id,
          productId: product.id,
          gradeId: grade.id,
          warehouseId: hub.id,
          quantity: item.availableQty,
          moq,
          unit: item.unit || 'MT',
          basePrice: sellingPrice,
          currency: 'INR',
          status: 'ACTIVE',
          visibility: 'MARKETPLACE',
          deliveryTerms: item.eta ?? null,
          createdById: userId,
          metadata: { gstPercent: 18 } as Prisma.InputJsonValue,
        },
      });

      const tierCount = await this.prisma.offerPriceTier.count({
        where: { offerId: offer.id },
      });
      if (!tierCount) {
        const tier1Max = Math.max(moq, 24);
        const tier2Min = tier1Max + 1;
        await this.prisma.offerPriceTier.createMany({
          data: [
            {
              offerId: offer.id,
              minQty: moq,
              maxQty: tier1Max,
              price: sellingPrice,
              currency: 'INR',
            },
            {
              offerId: offer.id,
              minQty: tier2Min,
              maxQty: Math.max(tier2Min, 99),
              price: Math.round(sellingPrice * 0.987),
              currency: 'INR',
            },
            {
              offerId: offer.id,
              minQty: Math.max(tier2Min + 1, 100),
              maxQty: null,
              price: Math.round(sellingPrice * 0.972),
              currency: 'INR',
            },
          ],
        });
      }
      inserted += 1;
    }

    this.logger.log(
      `Full catalog sync complete — upserted ${inserted}/${expected} listings (had ${existingCount})`,
    );
  }
}
