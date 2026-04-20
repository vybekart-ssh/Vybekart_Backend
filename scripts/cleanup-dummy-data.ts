/**
 * One-off cleanup: remove only dummy/QA seeded data to restore consistency.
 *
 * Scope: deletes rows whose IDs start with `dummy-` or `qa-` (and a few known dummy slugs).
 *
 * Usage (from Vybekart_Backend):
 *   APPLY=true npx ts-node --transpile-only scripts/cleanup-dummy-data.ts
 *
 * Dry-run (default):
 *   npx ts-node --transpile-only scripts/cleanup-dummy-data.ts
 */
import { PrismaClient } from '@prisma/client';

function truthyEnv(name: string): boolean {
  return String(process.env[name] || '').trim().toLowerCase() === 'true';
}

const DUMMY_PREFIXES = ['dummy-', 'qa-'] as const;

function isDummyId(id: string | null | undefined): boolean {
  if (!id) return false;
  return DUMMY_PREFIXES.some((p) => id.startsWith(p));
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const apply = truthyEnv('APPLY');

  if (!apply) {
    console.log('DRY RUN: no deletes will be performed. Set APPLY=true to execute.');
  }

  const likeOr = DUMMY_PREFIXES.map((p) => ({ startsWith: p }));

  // Helper to either count or delete.
  async function delMany<T extends { count: (args: any) => Promise<number>; deleteMany: (args: any) => Promise<{ count: number }> }>(
    modelName: string,
    model: T,
    where: any,
  ) {
    const count = await model.count({ where });
    console.log(`${modelName}: ${count}`);
    if (apply && count > 0) {
      const res = await model.deleteMany({ where });
      console.log(`  deleted: ${res.count}`);
    }
  }

  try {
    console.log('=== Dummy/QA data cleanup ===');
    console.log(`Apply mode: ${apply}`);

    // Delete in FK-safe order.
    await delMany('OrderItem', prisma.orderItem, { id: { OR: likeOr } });
    await delMany('Order', prisma.order, { id: { OR: likeOr } });

    await delMany('StreamProduct', prisma.streamProduct, { id: { OR: likeOr } });
    await delMany('Stream', prisma.stream, { id: { OR: likeOr } });

    await delMany('RecentlyViewedProduct', prisma.recentlyViewedProduct, {
      id: { OR: likeOr },
    });
    await delMany('Notification', prisma.notification, { id: { OR: likeOr } });

    await delMany('Product', prisma.product, { id: { OR: likeOr } });

    await delMany('SupportTicket', prisma.supportTicket, { id: { OR: likeOr } });
    await delMany('Address', prisma.address, { id: { OR: likeOr } });

    await delMany('SellerCategory', prisma.sellerCategory, {
      sellerId: { OR: likeOr as any },
    });
    await delMany('Seller', prisma.seller, { id: { OR: likeOr } });
    await delMany('Buyer', prisma.buyer, { id: { OR: likeOr } });

    // Reference data seeded with fixed IDs/slugs.
    await delMany('Faq', prisma.faq, { id: { OR: likeOr } });

    // Categories in seed-dummy.ts use fixed IDs and slugs (fashion/beauty/electronics/home-decor).
    // Only remove rows that are definitely dummy by id prefix.
    await delMany('Category', prisma.category, { id: { OR: likeOr } });

    await delMany('State', prisma.state, { id: { OR: likeOr } });
    await delMany('Country', prisma.country, { id: { OR: likeOr } });

    // Safety: seed-dummy.ts may have created/updated profiles for real users.
    // This cleanup intentionally does NOT delete users or adjust roles.
    if (apply) {
      console.log('Cleanup completed.');
    } else {
      console.log('Dry run completed. Re-run with APPLY=true to delete.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

