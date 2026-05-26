# VybeKart Phase 2 — Product Specification

| Field | Value |
|-------|--------|
| **Target date** | 14 May 2026 |
| **Status** | Approved for implementation |
| **Platforms** | Backend (NestJS + Prisma), Android (Buyer, Seller, Admin) |
| **Implementation playbook** | [`Phase2-Implementation-Plan.md`](./Phase2-Implementation-Plan.md) — DB, APIs, Android files, 7 build tracks |

---

## Executive summary

Phase 2 adds **trust and engagement** on top of live commerce: seller live-stream rewards (0% commission), a **replacement** pipeline (not returns), dual **rating** systems, **follow** graph, **24-hour post-live cart**, and an **Admin Users** directory with rating overrides. Payments, settlement, and invoicing are **Phase 3**.

---

## Scope

### In scope (7 modules)

| # | Module | Summary |
|---|--------|---------|
| 1 | Live-stream reward | 10 qualified days / 30 days → 0% commission; seller dashboard card |
| 2 | Replacement | 3-day submit, auto-approve if customer rating ≥ 3, emails, admin queue |
| 3 | Seller rating | Overall 0–5 + 3 subratings; penalty at 5 replacements / 30 days |
| 4 | Follow / Following | Live-only follow; buyer Following page + seller profile |
| 5 | Customer rating | Internal 0–5; penalty at 3 replacements / 90 days |
| 6 | Post-live cart | Checkout allowed until 24h after stream ends |
| 7 | Admin Users tab | Customers \| Seller partners, search, full detail, rating overrides |

### Out of scope

- **Returns and refunds** (no money-back flow; `PATCH /orders/:id/return` is legacy — not extended)
- **Payments**, commission engine, gateway, settlement, Amazon-format invoice → **Phase 3**
- **Web admin** (Phase 2 admin UX = **Android Admin app** only)

### Business rules (confirmed)

| Topic | Rule |
|-------|------|
| Live reward | Rolling **30 days**, **10 qualified days**; each day = **≥ 30 min** total live (IST); multiple sessions same day = **1** day |
| Reward duration | Active while **≥ 10 qualified days** remain in the rolling 30-day window |
| Replacement submit | Within **3 days** of `deliveredAt` |
| Replacement policy copy | “Replacement may be available within **7 days** of delivery” (buyer-facing text only) |
| Auto-approve | Customer platform rating **≥ 3** → auto-approve; **< 3** → admin review |
| Emails | `support@vybekart.co.in` (ops); `contact@vybekart.co.in` (buyer) |
| Seller penalty | **5** replacement requests / seller / **30 days** → admin notify + overall rating **−2** (min 0) |
| Customer penalty | **3** replacement requests / buyer / **90 days** → email + rating **−2** (min 0) |
| New buyer rating | Start **5.0** until history exists |
| Replacement % (public) | Approved replacements ÷ fulfilled orders |
| Unfollow | Allowed anytime from Following page |
| Admin Users | Android: **Users** tab → Customers \| Seller partners, search, full detail, **edit all ratings** |

---

## UI / UX standards (all Phase 2 screens)

Phase 2 UI must match existing VybeKart patterns so screens feel like one app—not a bolt-on.

### Reference implementations

| Pattern | Reference files |
|---------|-----------------|
| **Page shell** | `CoordinatorLayout` + `AppBarLayout` + `MaterialToolbar` (`@style/Widget.Vybekart.TopAppBar`) + `NestedScrollView` | [`fragment_admin_seller_detail.xml`](../../VybekartAndroid/app/src/main/res/layout/fragment_admin_seller_detail.xml) |
| **Section cards** | `MaterialCardView` + `@style/Widget.Vybekart.Card`, `@dimen/spacing_md` padding, `@dimen/spacing_sm` between cards | Admin seller detail, [`fragment_buyer_help_support.xml`](../../VybekartAndroid/app/src/main/res/layout/fragment_buyer_help_support.xml) |
| **Section titles** | Bold `@dimen/text_body`, `@color/text_primary`; body `@color/text_secondary` | Admin sections: `admin_section_application`, `admin_section_business`, … |
| **Forms / steps** | Step title + hint caption + inputs; 16dp padding | [`fragment_add_product_step1.xml`](../../VybekartAndroid/app/src/main/res/layout/fragment_add_product_step1.xml) |
| **Lists** | `RecyclerView` + card items; pull-to-refresh on list hosts | [`fragment_admin_sellers.xml`](../../VybekartAndroid/app/src/main/res/layout/fragment_admin_sellers.xml) |
| **Seller dashboard cards** | Chart cards + stat rows | [`fragment_dashboard.xml`](../../VybekartAndroid/app/src/main/res/layout/fragment_dashboard.xml) |

### Collapsible sections (required for detail-heavy screens)

Use the **FAQ expand pattern** for any screen with more than ~2 logical groups (admin user detail, replacement review, order replacement history):

- Reference: [`item_faq.xml`](../../VybekartAndroid/app/src/main/res/layout/item_faq.xml) — header row (`selectableItemBackground`) + chevron `baseline_expand_more_24` + body `visibility gone/visible`
- Prefer a reusable layout: `item_expandable_section.xml` (header `TextView` + `ImageView`, content container) inside each `MaterialCardView`, or `MaterialCardView` per section with toggle on header
- **Default state:** first section expanded (e.g. Summary), others collapsed
- **Persist expansion** in `ViewModel` / `savedStateHandle` so rotation and back-navigation do not reset (avoids jitter)
- Animate chevron rotation (180°) and content with `TransitionManager.beginDelayedTransition` on the card root—**do not** replace the whole fragment on expand

### Anti-jitter / stability

| Do | Don't |
|----|--------|
| Load detail in one API call; show **skeleton** or progress on first paint | Swap `ScrollView` ↔ `RecyclerView` after load |
| Keep toolbar + search bar **fixed**; scroll only content | Re-layout toolbar on keyboard/search |
| `ListAdapter` + `DiffUtil` for user/replacement lists | `notifyDataSetChanged()` on every keystroke |
| Debounce search **300ms** | Filter on every character with full reload flash |
| Single `UiState` sealed class per screen | Multiple competing `LiveData` toggling visibility |
| `SwipeRefreshLayout` only on list tabs | Full-screen flash reload on pull |
| Save scroll position when navigating to detail and back | Reset list to top |

### Shared components to add (Android)

| Component | Purpose |
|-----------|---------|
| `ExpandableSectionView` or `item_expandable_section.xml` | Admin + buyer detail collapsible blocks |
| `RatingBarEditorView` | Admin override: 0–5 stars + subrating rows |
| `LiveRewardCardView` | Seller dashboard Module 1 |
| `StreamCheckoutBannerView` | Buyer cart: “Checkout within Xh Ym” |

---

## Module 1 — Seller live-stream reward

### Purpose

Reward consistent live selling: **10 qualified days in 30 days** unlocks **0% VybeKart commission** (flag for Phase 3 settlement).

### Rules

- **Qualified day (IST):** sum of completed stream durations that calendar day ≥ **1800 seconds (30 min)**
- Multiple streams same day → **one** qualified day
- **Reward active:** count of qualified days in last 30 rolling days ≥ **10**
- **Reward ends:** when count drops below 10 in the rolling window
- Persist per-stream `durationSeconds` on stop; daily rollup table `SellerLiveQualificationDay`

### Backend

| Method | Route | Notes |
|--------|-------|-------|
| GET | `/sellers/dashboard` | Extend payload: `liveReward` object (see below) |
| — | Stream stop hook | Upsert daily minutes + qualified flag |

**`liveReward` DTO (illustrative)**

```json
{
  "minutesToday": 22,
  "minutesRequiredToday": 30,
  "qualifiedDaysInWindow": 7,
  "qualifiedDaysRequired": 10,
  "windowDays": 30,
  "rewardActive": false,
  "commissionWaiverActive": false
}
```

### Seller UI — dashboard card

- **Placement:** [`fragment_dashboard.xml`](../../VybekartAndroid/app/src/main/res/layout/fragment_dashboard.xml) — new card below header / above revenue chart (same card style as charts)
- **Content:** circular or linear progress “22 / 30 min today”, “7 / 10 days”, chip “Reward active” / “Keep streaming”
- **No layout jump:** card height fixed; use `ProgressBar` / `LinearProgressIndicator` for values, not swapping layouts when data loads

### Acceptance criteria

- [ ] Stream duration saved on every stop
- [ ] IST day boundary correct for qualification
- [ ] Dashboard card shows progress and reward status
- [ ] `commissionWaiverActive` available on seller profile/API for Phase 3

### Current codebase

- Duration only in stop summary JSON — [`streams.service.ts`](../src/streams/streams.service.ts)
- Dashboard has no live reward card — [`sellers.service.ts`](../src/sellers/sellers.service.ts)

---

## Module 2 — Replacement policy

### Purpose

Let buyers request **replacement** (exchange) with automated trust checks and admin fallback. **Not** returns/refunds.

### Policy layers

| Layer | Rule |
|-------|------|
| Marketing | “Replacement may be available within **7 days** of delivery” |
| Enforcement | Submit only if `deliveredAt` + **3 days** ≥ now |
| Product | Honor `Product.returnable` (treat as **replaceable** in copy) |
| Eligibility | All buyers; system + admin decide per request |

### Status machine

```
REPLACEMENT_REQUESTED
  → (rating ≥ 3) REPLACEMENT_APPROVED
  → (rating < 3) PENDING_ADMIN_REVIEW → REPLACEMENT_APPROVED | REPLACEMENT_REJECTED
REPLACEMENT_APPROVED → REPLACEMENT_SHIPPED → REPLACEMENT_DELIVERED
```

### Emails

| Event | To | From | Content |
|-------|-----|------|---------|
| Request created | support@vybekart.co.in | system | Structured: order, lines, buyer id, **customer rating**, replacement history, seller id, **seller rating**, replacement % |
| Request received | buyer email | contact@vybekart.co.in | Professional “under process” — match seller registration email tone |
| Approved | buyer | contact@vybekart.co.in | “Replacement initiated” |
| Rejected | buyer | contact@vybekart.co.in | Reason |

Template reference: [`scripts/alpha-invite/`](../scripts/alpha-invite/) and seller registration mailers.

### Backend APIs

| Method | Route | Actor |
|--------|-------|-------|
| POST | `/orders/:id/replacement` | Buyer |
| GET | `/orders/:id/replacements` | Buyer / seller (own orders) |
| GET | `/admin/replacements` | Admin (filter: status, needs_review) |
| PATCH | `/admin/replacements/:id` | Admin approve/reject + note |

### Buyer UI

- **Entry:** Order detail (delivered, within 3 days) → “Request replacement” (Material button, same as order actions elsewhere)
- **Form:** Reason (dropdown), description, optional photos — step style like add product (caption + `TextInputLayout`)
- **After submit:** status chip on order detail; no full-screen reload

### Admin UI — replacement queue

- **Access:** Admin app — from **Users** detail or dedicated “Replacements” entry on seller/customer detail (collapsible **Replacement history** section)
- **List item:** order id, buyer name, seller store, status chip, customer rating badge
- **Detail:** collapsible sections: **Summary** (expanded), **Customer**, **Seller**, **Order lines**, **Actions** (Approve / Reject)

### Acceptance criteria

- [ ] Submit blocked after 3 days with clear message
- [ ] support@ email on every request
- [ ] contact@ emails on submit and approval/rejection
- [ ] Auto-approve iff customer rating ≥ 3
- [ ] Admin queue for rating < 3
- [ ] Seller can ship replacement statuses in-app
- [ ] No refund/return payment logic

### Current codebase

- `returnOrder` → `RETURNED` only — [`orders.service.ts`](../src/orders/orders.service.ts)
- No replacement model in Prisma

---

## Module 3 — Seller partner rating

### Purpose

Public trust signal for sellers: overall + three subratings; penalize high replacement volume.

### Structure

| Field | Range | Notes |
|-------|-------|-------|
| Overall | 0–5 | Shown on profile, stream store, admin |
| Quality | 0–5 | Subrating |
| Originality | 0–5 | Live stream vs product received |
| Value for money | 0–5 | Subrating |

- **Default:** 5.0 overall until first buyer rating
- **Collection:** buyer optional prompt post-delivery; prompt after replacement closed
- **Penalty:** 5th replacement request against seller in 30 days → admin notification + **overall − 2**

### UI

- **Buyer:** bottom sheet or inline card after delivery (star row — same touch targets as Play Store style, min 48dp)
- **Admin:** editable in Module 7 **Ratings** collapsible section

### Acceptance criteria

- [ ] Stored on seller; exposed on follow profile and stream store
- [ ] Penalty fires on 5th request in window
- [ ] Admin can override (Module 7)

---

## Module 4 — Followers and following

### Purpose

Social graph: follow during live only; browse followed sellers on buyer app.

### Rules

- `POST /streams/:id/follow` only if `stream.isLive === true`
- Persist `BuyerSellerFollow` in DB (migrate off Redis-only)
- **Unfollow:** `DELETE /buyers/following/:sellerId`
- **Following page:** list → seller profile card

### Profile card fields

- Store logo, name, description
- Overall rating
- Replacement %

### Buyer UI

- **Follow button:** existing [`BuyerLiveStreamFragment`](../../VybekartAndroid/app/src/main/java/com/dev/vybekart/features/buyer/presentation/BuyerLiveStreamFragment.kt) — disable/hide when stream not live
- **Following page:** replace “coming soon” on profile — `RecyclerView` of followed sellers; tap → profile fragment (collapsible: **About**, **Stats**)

### Acceptance criteria

- [ ] Follow rejected when stream ended
- [ ] List + unfollow APIs
- [ ] Real follower count on seller dashboard

### Current codebase

- Redis follow, no live guard — [`streams.service.ts`](../src/streams/streams.service.ts)

---

## Module 5 — Customer rating (platform internal)

### Purpose

Internal risk score for auto-approve and admin context. **Never shown to buyers.**

### Rules

- **0–5**, starting **5.0**
- **Formula (documented):** e.g. `5.0 - (replacementRequestCount / max(1, deliveredOrderCount)) * 2`, clamped [0, 5]; tune in implementation
- **Penalty:** 3 requests in 90 days → email + rating − 2
- **Gate:** threshold **3.0** for Module 2 auto-approve

### Admin UI

- Visible only in Module 7 customer detail — **Ratings** section (collapsible), edit overall

### Acceptance criteria

- [ ] Not exposed on buyer-facing APIs/UI
- [ ] Included in support@ replacement email
- [ ] Overrides in admin affect auto-approve immediately

---

## Module 6 — Post-live cart (24 hours)

### Purpose

Buyers can checkout cart items from a ended stream for **24 hours**.

### Rules

- Valid until `stream.endedAt + 24h`
- Redis cart key TTL or scheduled cleanup at expiry
- **Change:** remove block in `assertStreamAndProducts` that rejects ended streams — allow if within 24h window

### Buyer UI

- **Banner** on cart/checkout: “Checkout within 2h 15m” — persistent `MaterialCardView` below toolbar (do not flash/remove on tick; update text only once per minute)
- After expiry: empty cart illustration + CTA back to home

### Acceptance criteria

- [ ] Checkout works 1–24h after stream end
- [ ] Cart cleared after 24h
- [ ] Replay cannot checkout

### Current codebase

- Checkout blocked when `!isLive` — [`orders.service.ts`](../src/orders/orders.service.ts)

---

## Module 7 — Admin Users tab

### Purpose

Master directory for **customers** and **seller partners**: search, full dossier, **rating overrides**.

### Navigation

Extend [`admin_bottom_nav.xml`](../../VybekartAndroid/app/src/main/res/menu/admin_bottom_nav.xml):

```
Sellers (existing — verification queue)
Videos  (existing)
Users   (NEW)
```

**Users screen**

- `TabLayout` or segmented control: **Customers** | **Seller partners**
- `SearchView` / `TextInputLayout` fixed at top (no scroll away)
- `RecyclerView` + `SwipeRefreshLayout`
- Tap row → detail fragment

**Tab roles**

| Tab | Role |
|-----|------|
| **Sellers** (existing) | Onboarding: pending verification, approve/reject |
| **Users → Seller partners** | All sellers: ops, ratings, replacements, live stats |

### List columns

**Customers:** name, email/phone, rating badge, replacement count, joined date  
**Seller partners:** store name, owner, verification chip, overall rating, replacement %, joined date

### Customer detail — collapsible sections

Use `item_expandable_section` / FAQ pattern inside `NestedScrollView`:

| Section | Default | Content |
|---------|---------|---------|
| **Summary** | Expanded | Name, email, phone, rating, status chip |
| **Registration** | Collapsed | Account dates, ids |
| **Ratings** | Collapsed | Current score, edit overall (admin), penalty history |
| **Replacements** | Collapsed | List (max 5 + “View all”) |
| **Orders** | Collapsed | Recent orders summary |
| **Addresses** | Collapsed | Shipping addresses |
| **Following** | Collapsed | Followed sellers |
| **Support** | Collapsed | Tickets / issues |
| **Activity** | Collapsed | Last order, last replacement, last active |

**Save expanded state** in `AdminCustomerDetailViewModel.savedStateHandle`.

### Seller partner detail

**Extend** [`AdminSellerDetailFragment`](../../VybekartAndroid/app/src/main/java/com/dev/vybekart/features/admin/presentation/AdminSellerDetailFragment.kt) / [`fragment_admin_seller_detail.xml`](../../VybekartAndroid/app/src/main/res/layout/fragment_admin_seller_detail.xml):

- Convert existing static cards (Application, Business, Bank, …) to **collapsible** sections (same visual style, add chevron header)
- **Add sections:** Ratings (overall + 3 subratings, editable), Replacement %, Live reward progress, Recent replacements, Follower count

### Rating override

- `RatingBar` + numeric display for overall; three subrating rows for sellers
- **Save** → `PATCH /admin/users/buyers/:id/rating` or `.../sellers/:id/rating`
- Audit log: `adminUserId`, field, old, new, timestamp

### Backend APIs

| Method | Route |
|--------|-------|
| GET | `/admin/users/buyers?q=&page=` |
| GET | `/admin/users/buyers/:id` |
| PATCH | `/admin/users/buyers/:id/rating` |
| GET | `/admin/users/sellers?q=&page=` |
| GET | `/admin/users/sellers/:id` (extend existing seller detail) |
| PATCH | `/admin/users/sellers/:id/rating` |

### Acceptance criteria

- [ ] Users tab in bottom nav
- [ ] Customers \| Seller partners + debounced search
- [ ] Customer full dossier with collapsible sections
- [ ] Seller detail extended with ratings + collapsible sections
- [ ] Rating override persisted + audited
- [ ] Replacement queue reachable from user detail

### Current codebase

- Admin: sellers + videos only — [`admin.controller.ts`](../src/admin/admin.controller.ts)
- No buyer admin APIs

---

## Data model (illustrative Prisma additions)

```
SellerLiveQualificationDay  (sellerId, date, totalSeconds, qualified)
ReplacementRequest          (orderId, buyerId, sellerId, status, reason, ...)
BuyerRating                   (buyerId, score, replacementRatio, ...)
SellerRating                  (sellerId, overall, quality, originality, valueForMoney, ...)
BuyerSellerFollow             (buyerId, sellerId, createdAt)
RatingOverrideLog             (adminUserId, entityType, entityId, field, oldValue, newValue)
```

---

## Email matrix (quick reference)

| Event | To | From |
|-------|-----|------|
| Replacement requested | support@vybekart.co.in | system |
| Replacement received | buyer | contact@vybekart.co.in |
| Replacement approved | buyer | contact@vybekart.co.in |
| Replacement rejected | buyer | contact@vybekart.co.in |
| Seller 5-replacement threshold | admin | system |
| Customer 3rd replacement penalty | buyer | contact@vybekart.co.in |

---

## Implementation order (recommended)

1. **Module 5 + 3** — rating storage (needed by replacement)  
2. **Module 2** — replacement flow + emails + admin queue  
3. **Module 7** — admin Users tab (uses ratings + replacements)  
4. **Module 1** — live qualification + dashboard card  
5. **Module 6** — post-live cart  
6. **Module 4** — follow DB + Following page  

---

## Phase 3 (deferred)

Payments, commission (5%), payment gateway (2%), logistics, settlement, and Amazon-format invoice — see original notes archived separately; not part of Phase 2 delivery.

---

## Source requirements (original notes)

The following raw items are fully specified above:

1. Live 30 min / 10 days, dashboard card, 0% commission  
2. Replacement policy, emails, admin review, customer analysis  
3. Seller rating + subratings + 5-replacement penalty  
4. Follow live-only + profile fields  
5. Customer internal rating + 3-replacement penalty  
6. 24h cart after live  
7. Admin Users tab with full detail + ratings  

---

## Appendix — UI file checklist for implementers

| Screen | Suggested layout file |
|--------|------------------------|
| Seller live reward card | `include_dashboard_live_reward.xml` |
| Buyer replacement request | `fragment_buyer_replacement_request.xml` |
| Admin users list | `fragment_admin_users.xml` |
| Admin customer detail | `fragment_admin_customer_detail.xml` |
| Expandable section item | `item_expandable_section.xml` (clone FAQ pattern) |
| Admin rating editor | `include_admin_rating_editor.xml` |
| Cart checkout banner | `include_stream_checkout_countdown.xml` |
| Buyer following list | `fragment_buyer_following.xml` |
| Buyer seller profile | `fragment_buyer_seller_profile.xml` |

All must use: `@style/Widget.Vybekart.Card`, `@dimen/spacing_*`, `@color/text_primary` / `text_secondary`, `Widget.Vybekart.TopAppBar`.
