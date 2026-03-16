import {
  AddressType,
  NotificationCategory,
  OrderStatus,
  PrismaClient,
  ProductStatus,
  StreamVisibility,
  VerificationStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

const CATEGORIES = [
  { id: 'dummy-cat-fashion', name: 'Fashion', slug: 'fashion' },
  { id: 'dummy-cat-beauty', name: 'Beauty', slug: 'beauty' },
  { id: 'dummy-cat-electronics', name: 'Electronics', slug: 'electronics' },
  { id: 'dummy-cat-home', name: 'Home Decor', slug: 'home-decor' },
];

const FAQS = [
  {
    id: 'dummy-faq-1',
    question: 'How do I track my order?',
    answer: 'Open Orders and tap an order to see live status and shipment details.',
    sortOrder: 1,
  },
  {
    id: 'dummy-faq-2',
    question: 'How can I return a delivered item?',
    answer: 'Open the order details and use Help to request return or exchange.',
    sortOrder: 2,
  },
  {
    id: 'dummy-faq-3',
    question: 'When will my payout be settled?',
    answer: 'Payouts are settled weekly to your linked bank account.',
    sortOrder: 3,
  },
];

async function upsertReferenceData() {
  await prisma.country.upsert({
    where: { code: 'IN' },
    update: { name: 'India' },
    create: { id: 'dummy-country-in', code: 'IN', name: 'India' },
  });

  const india = await prisma.country.findUnique({ where: { code: 'IN' } });
  if (india) {
    const states = [
      { code: 'MH', name: 'Maharashtra' },
      { code: 'KA', name: 'Karnataka' },
      { code: 'DL', name: 'Delhi' },
    ];
    for (const state of states) {
      const existing = await prisma.state.findFirst({
        where: { countryId: india.id, code: state.code },
      });
      if (!existing) {
        await prisma.state.create({
          data: {
            id: `dummy-state-${state.code.toLowerCase()}`,
            countryId: india.id,
            code: state.code,
            name: state.name,
          },
        });
      }
    }
  }

  for (const category of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name },
      create: category,
    });
  }

  for (const faq of FAQS) {
    await prisma.faq.upsert({
      where: { id: faq.id },
      update: { question: faq.question, answer: faq.answer, sortOrder: faq.sortOrder },
      create: faq,
    });
  }
}

async function seedProfilesAndRelatedData() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    include: { sellerProfile: true, buyerProfile: true },
  });

  if (!users.length) {
    console.log('No users found. Skipped user-dependent dummy data.');
    return;
  }

  const categories = await prisma.category.findMany({ orderBy: { name: 'asc' } });
  if (!categories.length) {
    throw new Error('No categories found. Run reference seed first.');
  }

  const buyers: { id: string; userId: string; name: string }[] = [];
  const sellers: { id: string; userId: string; businessName: string }[] = [];

  for (let i = 0; i < users.length; i += 1) {
    const user = users[i];
    const buyer = await prisma.buyer.upsert({
      where: { userId: user.id },
      update: { interests: ['Fashion', 'Beauty', 'Electronics'] },
      create: {
        id: `dummy-buyer-${i + 1}`,
        userId: user.id,
        interests: ['Fashion', 'Beauty', 'Electronics'],
      },
    });
    buyers.push({ id: buyer.id, userId: user.id, name: user.name });

    const isSellerCandidate = i % 2 === 0;
    if (isSellerCandidate) {
      const seller = await prisma.seller.upsert({
        where: { userId: user.id },
        update: {
          businessName: `Dummy Store ${i + 1}`,
          status: VerificationStatus.VERIFIED,
        },
        create: {
          id: `dummy-seller-${i + 1}`,
          userId: user.id,
          businessName: `Dummy Store ${i + 1}`,
          description: 'Dummy seller profile for testing flows.',
          businessAddress: '123 Demo Street, Demo City',
          status: VerificationStatus.VERIFIED,
          primaryCategoryId: categories[i % categories.length].id,
        },
      });
      sellers.push({
        id: seller.id,
        userId: user.id,
        businessName: seller.businessName,
      });
    }

    const addressId = `dummy-address-${i + 1}`;
    await prisma.address.upsert({
      where: { id: addressId },
      update: {},
      create: {
        id: addressId,
        userId: user.id,
        type: AddressType.SHIPPING,
        isDefault: true,
        line1: `${100 + i} Demo Lane`,
        line2: 'Near Test Market',
        city: 'Pune',
        state: 'Maharashtra',
        zip: `4110${(i % 9) + 1}`,
        country: 'IN',
      },
    });
  }

  for (let i = 0; i < sellers.length; i += 1) {
    const seller = sellers[i];
    const primaryCategory = categories[i % categories.length];
    const secondaryCategory = categories[(i + 1) % categories.length];

    await prisma.sellerCategory.upsert({
      where: {
        sellerId_categoryId: {
          sellerId: seller.id,
          categoryId: primaryCategory.id,
        },
      },
      update: {},
      create: { sellerId: seller.id, categoryId: primaryCategory.id },
    });

    await prisma.sellerCategory.upsert({
      where: {
        sellerId_categoryId: {
          sellerId: seller.id,
          categoryId: secondaryCategory.id,
        },
      },
      update: {},
      create: { sellerId: seller.id, categoryId: secondaryCategory.id },
    });
  }

  const products: {
    id: string;
    sellerId: string;
    price: number;
    name: string;
  }[] = [];

  for (let i = 0; i < sellers.length; i += 1) {
    for (let p = 1; p <= 3; p += 1) {
      const productId = `dummy-product-${i + 1}-${p}`;
      const category = categories[(i + p) % categories.length];
      const price = 299 + p * 100;
      const product = await prisma.product.upsert({
        where: { id: productId },
        update: {
          stock: 30 + p,
          status: ProductStatus.ACTIVE,
          price,
        },
        create: {
          id: productId,
          name: `Dummy Product ${i + 1}-${p}`,
          description: 'This is dummy seeded product data.',
          price,
          stock: 30 + p,
          images: ['https://picsum.photos/seed/vybe/600/600'],
          sellerId: sellers[i].id,
          categoryId: category.id,
          status: ProductStatus.ACTIVE,
          sku: `DMY-${i + 1}-${p}`,
        },
      });
      products.push({
        id: product.id,
        sellerId: product.sellerId,
        price: product.price,
        name: product.name,
      });
    }
  }

  for (let i = 0; i < sellers.length; i += 1) {
    const streamId = `dummy-stream-${i + 1}`;
    const category = categories[i % categories.length];
    await prisma.stream.upsert({
      where: { id: streamId },
      update: {
        isLive: i % 2 === 0,
        viewCount: 100 + i * 20,
      },
      create: {
        id: streamId,
        sellerId: sellers[i].id,
        categoryId: category.id,
        title: `Dummy Live ${i + 1}`,
        description: 'Dummy live stream for testing buyer feed.',
        isLive: i % 2 === 0,
        visibility: StreamVisibility.PUBLIC,
        viewCount: 100 + i * 20,
        livekitRoomName: `dummy-room-${i + 1}`,
      },
    });

    const sellerProducts = products.filter((x) => x.sellerId === sellers[i].id).slice(0, 2);
    for (let j = 0; j < sellerProducts.length; j += 1) {
      const spId = `dummy-stream-product-${i + 1}-${j + 1}`;
      await prisma.streamProduct.upsert({
        where: { id: spId },
        update: { sortOrder: j },
        create: {
          id: spId,
          streamId,
          productId: sellerProducts[j].id,
          sortOrder: j,
        },
      });
    }
  }

  for (let i = 0; i < buyers.length; i += 1) {
    const productA = products[i % products.length];
    const productB = products[(i + 1) % products.length];
    const orderId = `dummy-order-${i + 1}`;
    const subtotal = productA.price + productB.price;
    await prisma.order.upsert({
      where: { id: orderId },
      update: {
        totalAmount: subtotal + 90,
        status: [OrderStatus.DELIVERED, OrderStatus.PENDING, OrderStatus.SHIPPED][i % 3],
      },
      create: {
        id: orderId,
        buyerId: buyers[i].id,
        shippingAddress: `${100 + i} Demo Lane, Pune, Maharashtra, 411001`,
        status: [OrderStatus.DELIVERED, OrderStatus.PENDING, OrderStatus.SHIPPED][i % 3],
        totalAmount: subtotal + 90,
      },
    });

    await prisma.orderItem.upsert({
      where: { id: `dummy-order-item-${i + 1}-1` },
      update: { quantity: 1, price: productA.price },
      create: {
        id: `dummy-order-item-${i + 1}-1`,
        orderId,
        productId: productA.id,
        quantity: 1,
        price: productA.price,
      },
    });
    await prisma.orderItem.upsert({
      where: { id: `dummy-order-item-${i + 1}-2` },
      update: { quantity: 1, price: productB.price },
      create: {
        id: `dummy-order-item-${i + 1}-2`,
        orderId,
        productId: productB.id,
        quantity: 1,
        price: productB.price,
      },
    });

    await prisma.notification.upsert({
      where: { id: `dummy-notification-${i + 1}` },
      update: { isRead: i % 2 === 0 },
      create: {
        id: `dummy-notification-${i + 1}`,
        buyerId: buyers[i].id,
        title: 'Order update',
        body: `Your order ${orderId} is now being processed.`,
        category: NotificationCategory.ORDERS,
        isRead: i % 2 === 0,
      },
    });

    await prisma.recentlyViewedProduct.upsert({
      where: { id: `dummy-rvp-${i + 1}` },
      update: { productId: productA.id },
      create: {
        id: `dummy-rvp-${i + 1}`,
        buyerId: buyers[i].id,
        productId: productA.id,
      },
    });
  }

  for (let i = 0; i < users.length; i += 1) {
    await prisma.supportTicket.upsert({
      where: { id: `dummy-ticket-${i + 1}` },
      update: {
        subject: 'Demo support ticket',
        message: 'This is a seeded ticket for QA and UI testing.',
      },
      create: {
        id: `dummy-ticket-${i + 1}`,
        userId: users[i].id,
        subject: 'Demo support ticket',
        message: 'This is a seeded ticket for QA and UI testing.',
      },
    });
  }
}

async function main() {
  await upsertReferenceData();
  await seedProfilesAndRelatedData();
  console.log('Dummy data seeded for all non-User tables.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

