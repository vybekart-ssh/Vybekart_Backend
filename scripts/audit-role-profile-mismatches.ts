/**
 * One-off audit (and optional fix) for users whose Role[] doesn't match profile rows.
 *
 * Why: Android previously inferred login mode from profile IDs; if DB has mismatches
 * (e.g., seller row exists but Role.SELLER is missing), users could be routed wrongly.
 *
 * Usage (from Vybekart_Backend):
 *   npx ts-node --transpile-only scripts/audit-role-profile-mismatches.ts
 *
 * Optional fix (explicit opt-in):
 *   APPLY_FIX=true FIX_MODE=add_missing_roles npx ts-node --transpile-only scripts/audit-role-profile-mismatches.ts
 *   APPLY_FIX=true FIX_MODE=remove_stray_profiles npx ts-node --transpile-only scripts/audit-role-profile-mismatches.ts
 *
 * FIX_MODE meanings:
 * - add_missing_roles: if a profile row exists, add corresponding role to User.roles
 * - remove_stray_profiles: if a role is missing, delete the profile row (seller/buyer)
 *
 * Defaults to audit-only (no writes).
 */
import { PrismaClient, Role } from '@prisma/client';

type FixMode = 'add_missing_roles' | 'remove_stray_profiles';

function truthyEnv(name: string): boolean {
  return String(process.env[name] || '').trim().toLowerCase() === 'true';
}

function envFixMode(): FixMode | null {
  const raw = String(process.env.FIX_MODE || '').trim();
  if (raw === 'add_missing_roles' || raw === 'remove_stray_profiles') return raw;
  return null;
}

function hasRole(roles: Role[] | null | undefined, role: Role): boolean {
  return Array.isArray(roles) && roles.includes(role);
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const applyFix = truthyEnv('APPLY_FIX');
  const fixMode = envFixMode();

  if (applyFix && !fixMode) {
    console.error(
      'APPLY_FIX=true requires FIX_MODE=add_missing_roles or FIX_MODE=remove_stray_profiles',
    );
    process.exit(2);
  }

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        phone: true,
        roles: true,
        sellerProfile: { select: { id: true, status: true } },
        buyerProfile: { select: { id: true } },
      },
    });

    const mismatches = users
      .map((u) => {
        const hasSellerProfile = u.sellerProfile != null;
        const hasBuyerProfile = u.buyerProfile != null;
        const hasSeller = hasRole(u.roles, Role.SELLER);
        const hasBuyer = hasRole(u.roles, Role.BUYER);

        const missingSellerRole = hasSellerProfile && !hasSeller;
        const missingBuyerRole = hasBuyerProfile && !hasBuyer;
        const straySellerProfile = !hasSeller && hasSellerProfile;
        const strayBuyerProfile = !hasBuyer && hasBuyerProfile;
        const roleButNoSellerProfile = hasSeller && !hasSellerProfile;
        const roleButNoBuyerProfile = hasBuyer && !hasBuyerProfile;

        const any =
          missingSellerRole ||
          missingBuyerRole ||
          roleButNoSellerProfile ||
          roleButNoBuyerProfile;

        return any
          ? {
              ...u,
              missingSellerRole,
              missingBuyerRole,
              straySellerProfile,
              strayBuyerProfile,
              roleButNoSellerProfile,
              roleButNoBuyerProfile,
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x != null);

    console.log(`Users scanned: ${users.length}`);
    console.log(`Mismatches found: ${mismatches.length}`);

    if (mismatches.length) {
      for (const u of mismatches) {
        console.log('---');
        console.log(
          JSON.stringify(
            {
              id: u.id,
              email: u.email,
              phone: u.phone,
              roles: u.roles,
              sellerProfileId: u.sellerProfile?.id ?? null,
              sellerStatus: u.sellerProfile?.status ?? null,
              buyerProfileId: u.buyerProfile?.id ?? null,
              missingSellerRole: u.missingSellerRole,
              missingBuyerRole: u.missingBuyerRole,
              roleButNoSellerProfile: u.roleButNoSellerProfile,
              roleButNoBuyerProfile: u.roleButNoBuyerProfile,
            },
            null,
            2,
          ),
        );
      }
    }

    if (!applyFix) {
      console.log('Audit only. To fix, re-run with APPLY_FIX=true and FIX_MODE=...');
      return;
    }

    const actionable = mismatches.filter(
      (u) =>
        (fixMode === 'add_missing_roles' &&
          (u.missingSellerRole || u.missingBuyerRole)) ||
        (fixMode === 'remove_stray_profiles' &&
          (u.straySellerProfile || u.strayBuyerProfile)),
    );

    console.log(`Will apply fixMode=${fixMode} to ${actionable.length} users`);

    for (const u of actionable) {
      if (fixMode === 'add_missing_roles') {
        const nextRoles = new Set<Role>(u.roles);
        if (u.missingSellerRole) nextRoles.add(Role.SELLER);
        if (u.missingBuyerRole) nextRoles.add(Role.BUYER);
        await prisma.user.update({
          where: { id: u.id },
          data: { roles: { set: Array.from(nextRoles) } },
        });
        console.log(`Updated roles for user ${u.id}`);
      }

      if (fixMode === 'remove_stray_profiles') {
        if (u.straySellerProfile) {
          await prisma.seller.delete({ where: { userId: u.id } });
          console.log(`Deleted seller profile for user ${u.id}`);
        }
        if (u.strayBuyerProfile) {
          await prisma.buyer.delete({ where: { userId: u.id } });
          console.log(`Deleted buyer profile for user ${u.id}`);
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

