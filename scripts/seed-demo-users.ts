/**
 * Minimal DigitalOcean / remote seed for demo login users only.
 * Usage:
 *   DATABASE_URL='postgresql://...' npx tsx scripts/seed-demo-users.ts
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

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

const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const bcrypt = await import('bcrypt');
  const passwordHash = await bcrypt.hash('Test@12345', 12);

  const roleCodes = ['CUSTOMER', 'SELLER', 'ADMIN'] as const;
  for (const code of roleCodes) {
    await prisma.role.upsert({
      where: { code },
      update: { name: code },
      create: { code, name: code },
    });
  }

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
      const existing = await prisma.userRole.findFirst({
        where: { userId: user.id, roleId: role.id, organizationId: null },
      });
      if (!existing) {
        await prisma.userRole.create({
          data: { userId: user.id, roleId: role.id },
        });
      }
    }
    console.log(`Upserted ${item.email} (${item.phone})`);
  }

  console.log('Demo users ready: 8240890242 / OTP 123456 / password Test@12345');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
