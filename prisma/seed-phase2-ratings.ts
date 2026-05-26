/**
 * Backfill BuyerRating + SellerRating for existing profiles (default 5.0).
 * Run: npx ts-node prisma/seed-phase2-ratings.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const buyers = await prisma.buyer.findMany({
    select: { id: true },
  });
  for (const b of buyers) {
    await prisma.buyerRating.upsert({
      where: { buyerId: b.id },
      create: { buyerId: b.id },
      update: {},
    });
  }

  const sellers = await prisma.seller.findMany({
    select: { id: true },
  });
  for (const s of sellers) {
    await prisma.sellerRating.upsert({
      where: { sellerId: s.id },
      create: { sellerId: s.id },
      update: {},
    });
  }

  console.log(
    `Phase 2 ratings backfill: ${buyers.length} buyers, ${sellers.length} sellers`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
