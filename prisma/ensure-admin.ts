/**
 * Resets the VybeKart master admin password and ADMIN role.
 * Run against the same DATABASE_URL as production: `npm run seed:admin`
 *
 * Use when login fails: the row may be missing, or the email was registered
 * earlier with a different password — this overwrites the password.
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const ADMIN_EMAIL_LOWER = 'vybekart88@gmail.com';
const ADMIN_PASSWORD = 'Vybekart@1234';

async function main() {
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const existing = await prisma.user.findFirst({
    where: {
      email: { equals: ADMIN_EMAIL_LOWER, mode: 'insensitive' },
    },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        email: ADMIN_EMAIL_LOWER,
        password: hash,
        roles: [Role.ADMIN],
        name: 'VybeKart Master',
      },
    });
    console.log(`Updated admin user: ${ADMIN_EMAIL_LOWER} (id=${existing.id})`);
  } else {
    await prisma.user.create({
      data: {
        email: ADMIN_EMAIL_LOWER,
        password: hash,
        roles: [Role.ADMIN],
        name: 'VybeKart Master',
      },
    });
    console.log(`Created admin user: ${ADMIN_EMAIL_LOWER}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
