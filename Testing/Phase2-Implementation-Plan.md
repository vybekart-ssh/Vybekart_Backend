# VybeKart Phase 2 — Implementation Plan (Build Playbook)

**Product spec:** [`Phase2.md`](./Phase2.md)  
**Build approach:** Complete **one track at a time**; do not skip Track 0.  
**Platforms:** NestJS backend + Prisma + Android (Buyer, Seller, Admin).

---

## Build tracks (order)

| Track | Name | Depends on | Delivers |
|-------|------|------------|----------|
| **0** | Foundation | — | Schema, migration, `MailModule`, shared DTOs, Android `item_expandable_section` |
| **1** | Ratings | 0 | `BuyerRating`, `SellerRating`, penalty hooks (stub), admin override APIs |
| **2** | Replacement | 1 | Full replacement flow + emails + admin queue |
| **3** | Admin Users | 1, 2 | Users tab, customer/seller dossiers, rating UI |
| **4** | Live reward | 0 | Qualification persistence, dashboard card, waiver flag |
| **5** | Post-live cart | 0 | 24h checkout, cart TTL, buyer countdown banner |
| **6** | Follow graph | 1 | DB follow, live-only guard, Following page, public seller card |

**Out of scope (Phase 3):** payments, settlement, invoice.

---

## Track 0 — Foundation

### 0.1 Database — Prisma schema

**File:** [`prisma/schema.prisma`](../prisma/schema.prisma)

Add enums:

```prisma
enum ReplacementStatus {
  REQUESTED
  PENDING_ADMIN_REVIEW
  APPROVED
  REJECTED
  SHIPPED
  DELIVERED
}

enum RatingEntityType {
  BUYER
  SELLER
}
```

Add models:

```prisma
model BuyerRating {
  id                String   @id @default(uuid())
  buyerId           String   @unique
  buyer             Buyer    @relation(fields: [buyerId], references: [id], onDelete: Cascade)
  score             Float    @default(5.0)   // 0-5 internal
  replacementCount  Int      @default(0)
  deliveredCount    Int      @default(0)
  updatedAt         DateTime @updatedAt
  createdAt         DateTime @default(now())
}

model SellerRating {
  id              String   @id @default(uuid())
  sellerId        String   @unique
  seller          Seller   @relation(fields: [sellerId], references: [id], onDelete: Cascade)
  overall         Float    @default(5.0)
  quality         Float    @default(5.0)
  originality     Float    @default(5.0)
  valueForMoney   Float    @default(5.0)
  updatedAt       DateTime @updatedAt
  createdAt       DateTime @default(now())
}

model RatingOverrideLog {
  id           String           @id @default(uuid())
  adminUserId  String
  admin        User             @relation(fields: [adminUserId], references: [id])
  entityType   RatingEntityType
  entityId     String
  field        String
  oldValue     Float
  newValue     Float
  reason       String?
  createdAt    DateTime         @default(now())
  @@index([entityType, entityId])
}

model ReplacementRequest {
  id              String             @id @default(uuid())
  orderId         String
  order           Order              @relation(fields: [orderId], references: [id])
  buyerId         String
  buyer           Buyer              @relation(fields: [buyerId], references: [id])
  sellerId        String
  seller          Seller             @relation(fields: [sellerId], references: [id])
  orderItemId     String?
  status          ReplacementStatus  @default(REQUESTED)
  reason          String             @db.Text
  description     String?            @db.Text
  photoUrls       String[]
  adminNote       String?            @db.Text
  autoApproved    Boolean            @default(false)
  decidedAt       DateTime?
  decidedByAdminId String?
  createdAt       DateTime           @default(now())
  updatedAt       DateTime           @updatedAt
  @@index([sellerId, createdAt])
  @@index([buyerId, createdAt])
  @@index([status])
}

model BuyerSellerFollow {
  id        String   @id @default(uuid())
  buyerId   String
  buyer     Buyer    @relation(fields: [buyerId], references: [id], onDelete: Cascade)
  sellerId  String
  seller    Seller   @relation(fields: [sellerId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  @@unique([buyerId, sellerId])
  @@index([sellerId])
}

model SellerLiveQualificationDay {
  id             String   @id @default(uuid())
  sellerId       String
  seller         Seller   @relation(fields: [sellerId], references: [id], onDelete: Cascade)
  date           DateTime @db.Date  // IST calendar date
  totalSeconds   Int      @default(0)
  qualified      Boolean  @default(false)
  @@unique([sellerId, date])
  @@index([sellerId, date])
}

model StreamSession {
  id               String   @id @default(uuid())
  streamId         String   @unique
  stream           Stream   @relation(fields: [streamId], references: [id], onDelete: Cascade)
  sellerId         String
  durationSeconds  Int
  endedAt          DateTime
  @@index([sellerId, endedAt])
}
```

**Extend existing models:**

| Model | Add |
|-------|-----|
| `Buyer` | relations: `rating`, `replacementRequests`, `follows` |
| `Seller` | relations: `rating`, `replacementRequests`, `followers`, `qualificationDays`, `commissionWaiverActive Boolean @default(false)` |
| `Order` | `replacementRequests ReplacementRequest[]` |
| `Stream` | `durationSeconds Int?` (persist on stop), `session StreamSession?` |
| `User` | `ratingOverrideLogs RatingOverrideLog[]` |

**Migration command:**

```bash
cd Vybekart_Backend
npx prisma migrate dev --name phase2_foundation
```

**Seed / backfill script:** `prisma/seed-phase2-ratings.ts` — create `BuyerRating` + `SellerRating` for all existing buyers/sellers at 5.0.

---

### 0.2 Backend — Mail module

**Create:**

| File | Purpose |
|------|---------|
| `src/mail/mail.module.ts` | Global module |
| `src/mail/mail.service.ts` | Resend + SMTP fallback (copy pattern from `daily-db-backup.service.ts`) |
| `src/mail/templates/replacement-support.html` | support@ structured email |
| `src/mail/templates/replacement-buyer-received.html` | contact@ under process |
| `src/mail/templates/replacement-buyer-approved.html` | contact@ initiated |
| `src/mail/templates/replacement-buyer-rejected.html` | contact@ rejected |

**Env vars** (add to [`env.validation.ts`](../src/env.validation.ts)):

```
SUPPORT_EMAIL=support@vybekart.co.in
CONTACT_EMAIL=contact@vybekart.co.in
```

Register `MailModule` in [`app.module.ts`](../src/app.module.ts).

---

### 0.3 Android — Shared UI component

| File | Purpose |
|------|---------|
| `res/layout/item_expandable_section.xml` | Clone FAQ header + chevron + content slot |
| `core/ui/ExpandableSectionHelper.kt` | Toggle, rotation, `savedStateHandle` key per section |
| `res/values/strings_phase2.xml` | All Phase 2 copy |

---

## Track 1 — Ratings (Modules 3 + 5)

### 1.1 Backend

**Create `src/ratings/`:**

| File | Purpose |
|------|---------|
| `ratings.module.ts` | imports Prisma |
| `ratings.service.ts` | CRUD scores, recompute ratio, penalties |
| `ratings.controller.ts` | buyer submit seller rating (optional post-delivery) |
| `dto/submit-seller-rating.dto.ts` | `orderId`, `quality`, `originality`, `valueForMoney` |
| `dto/patch-buyer-rating.dto.ts` | admin |
| `dto/patch-seller-rating.dto.ts` | admin |

**APIs:**

| Method | Route | Guard | Body / response |
|--------|-------|-------|-----------------|
| POST | `/ratings/seller` | Buyer | `{ orderId, quality, originality, valueForMoney }` → `{ overall }` |
| GET | `/ratings/seller/:sellerId/public` | Public/JWT | `{ overall, quality, originality, valueForMoney, replacementPercent }` |
| GET | `/ratings/buyer/me` | Buyer | **404 or hidden** — internal only |
| PATCH | `/admin/users/buyers/:id/rating` | Admin | `{ score, reason? }` |
| PATCH | `/admin/users/sellers/:id/rating` | Admin | `{ overall?, quality?, originality?, valueForMoney?, reason? }` |

**Service rules:**

- New buyer/seller on register → create rating row at **5.0**
- `getBuyerScore(buyerId)` used by replacement auto-approve
- Penalty stubs: `onReplacementRequested(sellerId, buyerId)` increment counts; at thresholds call mail + decrement (Track 2 wires fully)

---

### 1.2 Android — Seller rating prompt (buyer)

| Layer | File |
|-------|------|
| API | Add to `BuyerApi.kt`: `POST ratings/seller` |
| Model | `SubmitSellerRatingRequest.kt`, `SellerPublicRatingDto.kt` |
| UI | `bottom_sheet_rate_seller.xml` + invoke from order delivered state |
| VM | Hook in order detail ViewModel after `DELIVERED` |

---

## Track 2 — Replacement (Module 2)

### 2.1 Backend

**Create `src/replacements/`:**

| File | Purpose |
|------|---------|
| `replacements.module.ts` | |
| `replacements.service.ts` | create, decide, ship, list |
| `replacements.controller.ts` | buyer + seller + admin routes |
| `dto/create-replacement.dto.ts` | `reason`, `description?`, `orderItemId?`, `photoUrls?` |
| `dto/decide-replacement.dto.ts` | `approved`, `adminNote?` |

**APIs:**

| Method | Route | Actor | Notes |
|--------|-------|-------|-------|
| POST | `/orders/:orderId/replacement` | Buyer | 3-day check, product returnable |
| GET | `/orders/:orderId/replacement` | Buyer/Seller | current request |
| GET | `/replacements/seller` | Seller | paginated |
| PATCH | `/replacements/:id/ship` | Seller | tracking optional |
| PATCH | `/replacements/:id/deliver` | Seller | |
| GET | `/admin/replacements` | Admin | `?status=&page=&limit=` |
| GET | `/admin/replacements/:id` | Admin | full dossier for email fields |
| PATCH | `/admin/replacements/:id/decide` | Admin | approve/reject |

**Create flow (`replacements.service.ts`):**

1. Validate `DELIVERED`, `deliveredAt + 3d`, no open request  
2. Create `ReplacementRequest` status `REQUESTED`  
3. Load buyer rating → if `>= 3` set `APPROVED`, `autoApproved=true`; else `PENDING_ADMIN_REVIEW`  
4. `MailService.sendReplacementSupportEmail(...)` → support@  
5. `MailService.sendReplacementBuyerReceived(...)` → contact@  
6. On approve → buyer approved template; call `ratingsService.onReplacementRequested`  
7. Seller penalty at 5 in 30d → admin email  

**Deprecate:** hide buyer UI for `PATCH /orders/:id/return` (do not remove API yet).

---

### 2.2 Android — Buyer

| Layer | File | Action |
|-------|------|--------|
| API | `BuyerApi.kt` | `POST orders/{id}/replacement`, `GET orders/{id}/replacement` |
| Model | `ReplacementRequestDto.kt`, `CreateReplacementRequest.kt` | |
| Layout | `fragment_buyer_replacement_request.xml` | Add-product style form |
| Layout | `fragment_buyer_order_detail.xml` | Add CTA + status chip (modify existing) |
| Fragment | `BuyerReplacementRequestFragment.kt` | |
| VM | `BuyerReplacementViewModel.kt` | |
| Nav | `nav_graph.xml` | `buyerOrderDetail → buyerReplacementRequest` |
| Strings | Policy: 7-day copy; error: 3-day enforcement |

---

### 2.3 Android — Seller

| Layer | File |
|-------|------|
| API | `OrdersApi.kt` — `GET replacements/seller`, `PATCH replacements/{id}/ship` |
| Layout | `fragment_seller_replacements.xml`, `item_seller_replacement.xml` |
| Fragment | `SellerReplacementsFragment` — list with collapsible detail per row (optional) |
| Nav | Seller orders area or new menu entry |

---

### 2.4 Android — Admin replacement queue

| Layer | File |
|-------|------|
| API | `AdminApi.kt` — replacements list + decide |
| Layout | `fragment_admin_replacements.xml`, `fragment_admin_replacement_detail.xml` |
| Fragment | Collapsible: Summary, Customer, Seller, Order, Actions |
| Nav | From `AdminCustomerDetail` / `AdminSellerDetail` or standalone entry in Users tab toolbar |

---

## Track 3 — Admin Users (Module 7)

### 3.1 Backend

**Extend `src/admin/admin.service.ts` + `admin.controller.ts`:**

| Method | Route | Response highlights |
|--------|-------|---------------------|
| GET | `/admin/users/buyers?q=&page=&limit=` | `{ items: [{ buyerId, name, email, phone, score, replacementCount, createdAt }], total }` |
| GET | `/admin/users/buyers/:id` | Full dossier (see below) |
| GET | `/admin/users/sellers?q=&page=&limit=` | Directory (all statuses) |
| GET | `/admin/users/sellers/:id` | Extend existing `getSellerDetail` + ratings + liveReward + replacements |
| PATCH | `/admin/users/buyers/:id/rating` | Delegates to `RatingsService` + audit log |
| PATCH | `/admin/users/sellers/:id/rating` | Same |

**`GET /admin/users/buyers/:id` response shape:**

```json
{
  "buyer": { "id", "user": { "name", "email", "phone", "createdAt" } },
  "rating": { "score", "replacementCount", "deliveredCount" },
  "replacements": [{ "id", "status", "orderId", "createdAt" }],
  "orders": [{ "id", "status", "totalAmount", "sellerName", "createdAt" }],
  "addresses": [...],
  "following": [{ "sellerId", "businessName", "logoUrl" }],
  "supportTickets": [{ "id", "subject", "createdAt" }],
  "activity": { "lastOrderAt", "lastReplacementAt" }
}
```

---

### 3.2 Android — Admin Users tab

| Layer | File | Action |
|-------|------|--------|
| Menu | `admin_bottom_nav.xml` | Add `admin_nav_users` |
| Main | `AdminMainFragment.kt` | Case `admin_nav_users → AdminUsersFragment()` |
| Layout | `fragment_admin_users.xml` | `TabLayout` + `SearchView` + `ViewPager2` |
| Layout | `fragment_admin_users_list.xml` | RecyclerView + SwipeRefresh (×2 tabs) |
| Layout | `item_admin_user_row.xml` | Row for buyer/seller |
| Layout | `fragment_admin_customer_detail.xml` | Collapsible sections (Track 0 component) |
| Layout | `include_admin_rating_editor.xml` | Star rows + save |
| Fragment | `AdminUsersFragment.kt`, `AdminUsersListFragment.kt` (customers/sellers) |
| Fragment | `AdminCustomerDetailFragment.kt` | |
| Extend | `AdminSellerDetailFragment.kt` + XML | Collapsible cards + ratings section |
| API | `AdminApi.kt` | All `/admin/users/*` + rating PATCH |
| Model | `AdminBuyerListItem.kt`, `AdminBuyerDetail.kt`, etc. | |
| Repository | `AdminRepository.kt` | New methods |
| VM | `AdminUsersViewModel.kt`, `AdminCustomerDetailViewModel.kt` | Debounced search 300ms |
| Nav | `nav_graph.xml` | `adminUsers → adminCustomerDetail`, `adminSellerDetail` (existing) |

**UI rules:** See [`Phase2.md`](./Phase2.md) — fixed search bar, `DiffUtil`, persist expansion in `savedStateHandle`.

---

## Track 4 — Live reward (Module 1)

### 4.1 Backend

**Modify `src/streams/streams.service.ts`:**

- On `stopStream`: compute `durationSeconds`, upsert `StreamSession`, add seconds to `SellerLiveQualificationDay` (IST date), set `qualified` if `totalSeconds >= 1800`
- Method `getLiveRewardStatus(sellerId)` → rolling 30d qualified day count
- Update `commissionWaiverActive` on Seller when count >= 10

**Modify `src/sellers/sellers.service.ts` `getMyDashboardStats()`:**

```json
"liveReward": {
  "minutesToday": 22,
  "minutesRequiredToday": 30,
  "qualifiedDaysInWindow": 7,
  "qualifiedDaysRequired": 10,
  "rewardActive": false,
  "commissionWaiverActive": false
}
```

---

### 4.2 Android — Seller dashboard

| Layer | File |
|-------|------|
| Model | Extend `DashboardResponse.kt` with `LiveRewardDto` |
| Layout | `include_dashboard_live_reward.xml` |
| Layout | `fragment_dashboard.xml` | Include above charts |
| Fragment | `DashboardFragment.kt` | Bind progress; fixed card height |
| API | Already `SellersApi.getDashboard()` — no new endpoint |

---

## Track 5 — Post-live cart (Module 6)

### 5.1 Backend

**Modify `src/orders/orders.service.ts`:**

- `saveCartState`: store `streamEndedAt`, `cartExpiresAt` in Redis JSON; `EXPIRE` key at TTL seconds
- `assertStreamAndProducts`: if stream ended, allow when `now < cartExpiresAt` (24h)
- `getCart`: return `checkoutExpiresAt`, `secondsRemaining`
- Cron optional: `CartExpiryJob` every 15m to sweep stale keys

**Redis cart shape (extended):**

```json
{
  "streamId": "...",
  "items": [...],
  "streamEndedAt": "ISO",
  "cartExpiresAt": "ISO"
}
```

---

### 5.2 Android — Buyer cart / checkout

| Layer | File |
|-------|------|
| Model | Extend `BuyerCartResponse` with `checkoutExpiresAt`, `secondsRemaining` |
| Layout | `include_stream_checkout_countdown.xml` |
| Cart screen | Show banner; update text every 60s (not every second) |
| Checkout | No change if API accepts ended stream within window |
| Empty state | After expiry — clear messaging |

---

## Track 6 — Follow graph (Module 4)

### 6.1 Backend

**Modify `src/streams/streams.service.ts` `followSeller`:**

- Throw `400` if `!stream.isLive`
- Write `BuyerSellerFollow` via Prisma (remove Redis-only or dual-write then remove Redis)

**Create / extend `src/buyers/buyers.controller.ts`:**

| Method | Route | Notes |
|--------|-------|-------|
| GET | `/buyers/following` | List followed sellers with public rating + replacement % |
| DELETE | `/buyers/following/:sellerId` | Unfollow |
| GET | `/buyers/sellers/:sellerId/public-profile` | Logo, name, description, rating, replacement % |

**Modify `src/sellers/sellers.service.ts` dashboard:** real `followers` count from `BuyerSellerFollow`.

---

### 6.2 Android — Buyer

| Layer | File |
|-------|------|
| API | `BuyerApi.kt` — `GET buyers/following`, `DELETE buyers/following/{id}`, `GET buyers/sellers/{id}/public-profile` |
| Layout | `fragment_buyer_following.xml`, `item_followed_seller.xml` |
| Layout | `fragment_buyer_seller_profile.xml` | Collapsible About / Stats |
| Fragment | Replace “coming soon” in `BuyerProfileFragment.kt` |
| Live | `BuyerLiveStreamFragment` — disable follow when not live; handle 400 |

---

## API integration matrix (Android)

| API interface | New methods | Track |
|---------------|-------------|-------|
| [`BuyerApi.kt`](../../VybekartAndroid/app/src/main/java/com/dev/vybekart/features/buyer/data/api/BuyerApi.kt) | replacement, following, public-profile, rate seller | 2, 6, 1 |
| [`OrdersApi.kt`](../../VybekartAndroid/app/src/main/java/com/dev/vybekart/features/order/data/api/OrdersApi.kt) | seller replacements ship | 2 |
| [`AdminApi.kt`](../../VybekartAndroid/app/src/main/java/com/dev/vybekart/features/admin/data/api/AdminApi.kt) | users/buyers, users/sellers, replacements, rating patch | 3, 2 |
| [`SellersApi.kt`](../../VybekartAndroid/app/src/main/java/com/dev/vybekart/features/seller/data/api/SellersApi.kt) | (dashboard DTO only) | 4 |

**DI:** Register new modules in existing Hilt network module (same Retrofit instance).

---

## Navigation graph additions

**File:** [`nav_graph.xml`](../../VybekartAndroid/app/src/main/res/navigation/nav_graph.xml)

| Action | Destination fragment |
|--------|---------------------|
| `buyerOrderDetail → buyerReplacementRequest` | `BuyerReplacementRequestFragment` |
| `buyerProfile → buyerFollowing` | `BuyerFollowingFragment` |
| `buyerFollowing → buyerSellerProfile` | `BuyerSellerProfileFragment` |
| `adminMain` (child) `adminUsers` | `AdminUsersFragment` |
| `adminUsers → adminCustomerDetail` | `AdminCustomerDetailFragment` |
| `adminUsers → adminSellerDetail` | existing |
| `adminCustomerDetail → adminReplacements` | optional filter |
| Seller nav | `sellerReplacements` | `SellerReplacementsFragment` |

---

## Backend module map

```
src/
├── mail/                 # Track 0
├── ratings/              # Track 1
├── replacements/         # Track 2
├── admin/                # Track 3 (extend)
├── streams/              # Track 4, 6 (modify)
├── orders/               # Track 2, 5 (modify)
├── sellers/              # Track 4 (modify)
└── buyers/               # Track 6 (extend)
```

---

## Testing checklist (per track)

| Track | Backend test | Android test |
|-------|--------------|--------------|
| 0 | Migration applies; mail sends in dev | Expandable section rotates |
| 1 | Rating create on register; admin patch | — |
| 2 | Auto-approve ≥3; emails sent | Buyer submit + admin decide |
| 3 | Buyer dossier JSON complete | Users tab search + detail |
| 4 | 30min qualifies day; dashboard JSON | Dashboard card |
| 5 | Checkout 2h after end works | Countdown banner |
| 6 | Follow blocked when ended | Following list |

---

## Suggested PR / branch split

| PR | Branch | Tracks |
|----|--------|--------|
| 1 | `phase2/track-0-foundation` | 0 |
| 2 | `phase2/track-1-ratings` | 1 |
| 3 | `phase2/track-2-replacement` | 2 |
| 4 | `phase2/track-3-admin-users` | 3 |
| 5 | `phase2/track-4-live-reward` | 4 |
| 6 | `phase2/track-5-cart-24h` | 5 |
| 7 | `phase2/track-6-follow` | 6 |

---

## How to execute “one by one”

1. Open this file and [`Phase2.md`](./Phase2.md) side by side.  
2. Start **Track 0** — merge before any feature work.  
3. For each track: backend first (API testable via Postman), then Android (Buyer → Seller → Admin).  
4. Mark track complete when all checkboxes in **Testing checklist** pass.  
5. Do not start Phase 3 payments until all 7 tracks are done.

**First implementation prompt to use:**

> “Implement Phase 2 Track 0 (Foundation) per `Testing/Phase2-Implementation-Plan.md`.”

Then Track 1, 2, … in order.
