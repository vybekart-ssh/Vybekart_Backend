import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CATEGORIES = [
  { name: 'Fashion', slug: 'fashion' },
  { name: 'Fashion & Apparel', slug: 'fashion-apparel' },
  { name: 'Beauty', slug: 'beauty' },
  { name: 'Handmade', slug: 'handmade' },
  { name: 'Art', slug: 'art' },
] as const;

const FAQS = [
  { question: 'How do I add a new product?', answer: 'Go to Products tab and tap the + button. Fill in name, price, stock, and upload images.', sortOrder: 1 },
  { question: 'How do I schedule a live stream?', answer: 'From the dashboard tap Schedule Live. Set title, date, time and add products to showcase.', sortOrder: 2 },
  { question: 'When do I receive my payouts?', answer: 'Payouts are processed weekly to your registered bank account. Ensure bank details are correct in Payout Settings.', sortOrder: 3 },
  { question: 'How do I print shipping labels?', answer: 'Open Orders, select the orders and tap Print Labels. Labels can be printed in bulk.', sortOrder: 4 },
];

const COUNTRIES = [
  { code: 'IN', name: 'India' },
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'SG', name: 'Singapore' },
];

const INDIAN_STATES = [
  { code: 'AN', name: 'Andaman and Nicobar Islands' },
  { code: 'AP', name: 'Andhra Pradesh' },
  { code: 'AR', name: 'Arunachal Pradesh' },
  { code: 'AS', name: 'Assam' },
  { code: 'BR', name: 'Bihar' },
  { code: 'CH', name: 'Chandigarh' },
  { code: 'CT', name: 'Chhattisgarh' },
  { code: 'DN', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: 'DL', name: 'Delhi' },
  { code: 'GA', name: 'Goa' },
  { code: 'GJ', name: 'Gujarat' },
  { code: 'HR', name: 'Haryana' },
  { code: 'HP', name: 'Himachal Pradesh' },
  { code: 'JK', name: 'Jammu and Kashmir' },
  { code: 'JH', name: 'Jharkhand' },
  { code: 'KA', name: 'Karnataka' },
  { code: 'KL', name: 'Kerala' },
  { code: 'LA', name: 'Ladakh' },
  { code: 'LD', name: 'Lakshadweep' },
  { code: 'MP', name: 'Madhya Pradesh' },
  { code: 'MH', name: 'Maharashtra' },
  { code: 'MN', name: 'Manipur' },
  { code: 'ML', name: 'Meghalaya' },
  { code: 'MZ', name: 'Mizoram' },
  { code: 'NL', name: 'Nagaland' },
  { code: 'OR', name: 'Odisha' },
  { code: 'PY', name: 'Puducherry' },
  { code: 'PB', name: 'Punjab' },
  { code: 'RJ', name: 'Rajasthan' },
  { code: 'SK', name: 'Sikkim' },
  { code: 'TN', name: 'Tamil Nadu' },
  { code: 'TG', name: 'Telangana' },
  { code: 'TR', name: 'Tripura' },
  { code: 'UP', name: 'Uttar Pradesh' },
  { code: 'UT', name: 'Uttarakhand' },
  { code: 'WB', name: 'West Bengal' },
];

async function main() {
  for (const cat of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name },
      create: cat,
    });
  }
  console.log('Categories seeded.');

  for (const c of COUNTRIES) {
    await prisma.country.upsert({
      where: { code: c.code },
      update: { name: c.name },
      create: { code: c.code, name: c.name },
    });
  }

  const india = await prisma.country.findUnique({ where: { code: 'IN' } });
  if (india) {
    const existingCount = await prisma.state.count({ where: { countryId: india.id } });
    if (existingCount === 0) {
      await prisma.state.createMany({
        data: INDIAN_STATES.map((s) => ({
          countryId: india.id,
          code: s.code,
          name: s.name,
        })),
      });
    }
  }
  console.log('Countries seeded (India, USA, UK, UAE, Singapore); Indian states seeded.');

  const faqCount = await prisma.faq.count();
  if (faqCount === 0) {
    await prisma.faq.createMany({ data: FAQS });
    console.log('FAQs seeded.');
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
