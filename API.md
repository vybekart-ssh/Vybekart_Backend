# VybeKart Backend API Reference

Base URL: `http://localhost:3000` (or your deployed URL)

All POST/PATCH requests must use `Content-Type: application/json`.

Protected endpoints require a Bearer token: `Authorization: Bearer <access_token>`.

---

## Table of Contents

1. [Auth](#auth)
2. [Users](#users)
3. [Products](#products)
4. [Streams](#streams)
5. [Orders](#orders)
6. [Categories](#categories)
7. [Buyers](#buyers)
8. [Sellers](#sellers)
9. [Health](#health)
10. [Pagination](#pagination)
11. [WebSocket](#websocket-streams)
12. [Errors](#error-responses)

---

## Auth

All auth endpoints are public (no Bearer token required).

### POST `/auth/login`

Login with email and password.

**Request body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "roles": ["BUYER"],
    "sellerProfileId": null,
    "buyerProfileId": "uuid"
  }
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'
```

---

### POST `/auth/refresh`

Refresh access token using a refresh token.

**Request body:**
```json
{
  "refresh_token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"YOUR_REFRESH_TOKEN"}'
```

---

### POST `/auth/otp/send`

Send OTP to email or phone. At least one of `email` or `phone` is required.

**Request body:**
```json
{ "email": "user@example.com" }
```
or
```json
{ "phone": "+919876543210" }
```

**Response:** `{ "message": "OTP sent successfully" }`

**Note:** Phone must be E.164 format (e.g. `+919876543210`).

---

### POST `/auth/otp/verify`

Verify OTP. Returns tokens if existing user, or `{ isNewUser: true }` if new.

**Request body:**
```json
{ "email": "user@example.com", "code": "123456" }
```
or
```json
{ "phone": "+919876543210", "code": "123456" }
```

**Response (existing user):** `access_token`, `refresh_token`, `user`

**Response (new user):** `{ "isNewUser": true, "email"?: string, "phone"?: string }`

---

### POST `/auth/register/buyer`

Register a new buyer.

**Request body:**
```json
{
  "email": "buyer@example.com",
  "password": "password123",
  "name": "Jane Doe",
  "phone": "+919876543210"
}
```

| Field    | Type   | Required | Notes        |
|----------|--------|----------|--------------|
| email    | string | Yes      | Valid email  |
| password | string | Yes      | Min 6 chars  |
| name     | string | Yes      |              |
| phone    | string | No       | E.164 format |

---

### POST `/auth/register/seller`

Register a new seller.

**Request body:**
```json
{
  "email": "seller@example.com",
  "password": "password123",
  "name": "John Seller",
  "phone": "+919876543210",
  "businessName": "My Store",
  "description": "Selling great products",
  "gstNumber": "29AABCT1332L1ZV",
  "categoryIds": ["uuid-1", "uuid-2"],
  "pickupAddress": {
    "line1": "123 Main St",
    "line2": "Block A",
    "city": "Mumbai",
    "state": "Maharashtra",
    "zip": "400001"
  },
  "bankAccount": "1234567890",
  "ifscCode": "HDFC0001234"
}
```

| Field        | Type   | Required | Notes                      |
|--------------|--------|----------|----------------------------|
| email        | string | Yes      | Valid email                |
| password     | string | Yes      | Min 6 chars                |
| name         | string | Yes      |                            |
| businessName | string | Yes      |                            |
| phone        | string | No       | E.164 format               |
| description  | string | No       |                            |
| gstNumber    | string | No       |                            |
| categoryIds  | string[]| No       | UUIDs of categories        |
| pickupAddress| object | No       | line1, line2?, city, state, zip (6 digits) |
| bankAccount  | string | No       | 9–18 digits                |
| ifscCode     | string | No       | 11 chars (e.g. HDFC0001234)|

---

## Users

### GET `/users`

List all users (paginated). Public.

**Query params:** `page` (default 1), `limit` (default 20, max 100)

**Example:**
```bash
curl "http://localhost:3000/users?page=1&limit=20"
```

---

## Products

### POST `/products`

Create a product. **Auth:** Seller only.

**Request body:**
```json
{
  "name": "Cool T-Shirt",
  "description": "Comfortable cotton tee",
  "price": 999.99,
  "stock": 50,
  "images": ["https://example.com/img1.jpg"],
  "videoUrl": "https://example.com/video.mp4",
  "categoryId": "uuid"
}
```

| Field       | Type    | Required | Notes          |
|-------------|---------|----------|----------------|
| name        | string  | Yes      |                |
| description | string  | No       |                |
| price       | number  | Yes      | ≥ 0            |
| stock       | number  | No       | ≥ 0, default 0 |
| images      | string[]| No       | URLs           |
| videoUrl    | string  | No       | Valid URL      |
| categoryId  | string  | No       | UUID           |

**Example:**
```bash
curl -X POST http://localhost:3000/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"name":"T-Shirt","price":999,"stock":50}'
```

---

### GET `/products`

List all products. Public. **Query params:** `page`, `limit`

---

### GET `/products/my-listings`

List products owned by the authenticated seller. **Auth:** Seller only. **Query params:** `page`, `limit`

---

### GET `/products/:id`

Get a product by ID. Public.

---

### PATCH `/products/:id`

Update a product. **Auth:** Seller (owner only). **Request body:** Same fields as create (all optional, partial update)

---

### DELETE `/products/:id`

Delete a product. **Auth:** Seller (owner only).

---

## Streams

### POST `/streams`

Create a live stream. **Auth:** Seller only.

Returns stream with `token`, `livekitUrl`, `livekitRoomName` for connecting to LiveKit.

**Request body:**
```json
{
  "title": "My Live Sale",
  "description": "Exciting deals today!"
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/streams \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"title":"Live Sale","description":"Deals!"}'
```

---

### GET `/streams/active`

List active (live) streams. Public. **Query params:** `page`, `limit`

---

### GET `/streams/:id`

Get a stream by ID. Public.

---

### POST `/streams/:id/token`

Get a LiveKit join token. **Auth:** Required (buyer or seller).

- **Seller (owner):** receives publisher token (can publish video)
- **Others:** receive subscriber token (can only watch)

**Request body:**
```json
{
  "identity": "user-display-name",
  "metadata": "optional-metadata"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "livekitUrl": "https://your-project.livekit.cloud",
  "roomName": "stream-uuid"
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/streams/STREAM_ID/token \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"identity":"viewer-123"}'
```

---

### PATCH `/streams/:id`

Update a stream. **Auth:** Seller (owner only). **Request body:** `{ "title"?: string, "description"?: string }`

---

### PATCH `/streams/:id/stop`

Stop a stream. **Auth:** Seller (owner only).

Stops LiveKit egress, sets `endedAt`, begins replay processing. **Likes/comments Redis keys are retained** for archive replay (48h TTL); they are cleared on stream delete only. If a seller-phone HD copy is already the replay (`replaySource: DEVICE`), the egress result does not replace it.

---

### POST `/streams/:id/device-recording/upload-session`

Seller-phone HD copy: get a signed resumable (TUS) upload to Supabase Storage. **Auth:** Seller (owner only).

**Body:** `{ "sizeBytes": number (int ≥ 1), "durationSec"?: number }`

**Response:** `{ "alreadyUploaded": false, "endpoint": "https://<ref>.storage.supabase.co/storage/v1/upload/resumable/sign", "signature": "<token>", "bucket", "objectName": "vybekart-replays/device/<streamId>.mp4", "contentType": "video/mp4", "chunkSizeBytes": 6291456, "expiresInSeconds": 7200 }` — or `{ "alreadyUploaded": true, ... }` when the device copy is already `READY`.

Client sends every TUS request with headers `x-signature: <signature>`, `Tus-Resumable: 1.0.0`; create with `x-upsert: true` and `Upload-Metadata` (`bucketName`, `objectName`, `contentType`). **Errors:** 400 too large (`DEVICE_RECORDING_MAX_BYTES`, default 10 GB), 403 not owner, 404 stream gone, 502/503 storage unavailable.

---

### POST `/streams/:id/device-recording/complete`

Confirms the upload. **Auth:** Seller (owner only). **Body:** `{ "sizeBytes": number, "durationSec"?: number }`

Verifies the object exists with the same size, then sets `replayUrl` (device copy), `replayStatus: READY`, `replaySource: DEVICE`, `deviceRecordingStatus: READY`. **400** when the object is missing / size differs (client re-uploads).

---

### POST `/streams/:id/device-recording/status`

App-side progress for ops/admin. **Auth:** Seller (owner only). **Body:** `{ "status": "RECORDING" | "PENDING_UPLOAD" | "FAILED", "error"?: string (≤ 500) }`. Never downgrades a `READY` device copy.

---

### GET `/streams/:id/live-state`

Single round-trip for live or **archive** UI: engagement summary, view count, comments tail, `archiveAvailable` flag. **Auth:** Required (buyer or seller).

Works for ended streams within the archive window (and for stream owner after public expiry).

---

### GET `/streams/:id/archive`

Validate and return metadata for watching an **archived live replay**. **Auth:** Required (buyer or seller).

| Rule | Detail |
|------|--------|
| Archive window | **24 hours** after `endedAt` for buyers (`ARCHIVE_AVAILABILITY_HOURS`) |
| Owner override | Seller (stream owner) may replay after public expiry |
| Replay | Requires `replayStatus: READY` and `replayUrl` for buyers; owner may see processing state |
| Engagement | Likes/comments/follow remain in Redis for **48h** after stream end |

**Response (abbreviated):**
```json
{
  "streamId": "uuid",
  "title": "Festive Kurtis Live",
  "thumbnailUrl": "https://…",
  "replayUrl": "https://…/replay.mp4",
  "replayStatus": "READY",
  "viewCount": 248,
  "engagement": { "likes": 42, "comments": 12 },
  "products": [ … ],
  "expired": false,
  "archiveExpiresAt": "2026-09-03T12:00:00.000Z"
}
```

**Query:** `prefetch=1` (or `true`) — app is buffering this replay in the background (buyer reels); **no view is counted**. Count it later with `POST /streams/:id/views`.

---

### GET `/streams/:id/viewer-token`

LiveKit subscriber token for a live stream (alias `GET /streams/viewer-token/:id`). **Auth:** none. **Query:** `identity` (LiveKit identity, e.g. `buyer-<uuid>`), `prefetch=1` (or `true`) — background pre-connect for the buyer reels feed, **no view is counted**. Without `prefetch` the first token per identity per 10 min increments `viewCount` (unchanged behavior).

**Response:** `{ "token": "…", "wsUrl": "wss://…", "roomName": "…" }`. `400` if the stream is not live.

---

### POST `/streams/:id/views`

Counts one view when a preloaded reel becomes visible. **Auth:** Required. **Body:** `{ "identity"?: string (≤ 160) }` — send the same LiveKit identity used for `viewer-token` for live streams.

| Stream state | Dedupe key (same as existing counters) |
|--------------|----------------------------------------|
| Live | `stream:viewer:join:{id}:{identity}` for 10 min (falls back to `viewer-{userId}`) |
| Ended (replay) | `stream:archive:view:{id}:{userId}` for 1 h |
| Owner | never counted |

**Response:** `{ "counted": true | false }`. `404` if the stream does not exist.

---

### POST `/streams/:id/comments`

Add a comment. **Auth:** Required. Allowed during **live and archive** (within availability rules). Seller replies include `isSeller: true`.

---

### POST `/streams/:id/like`

Toggle like. **Auth:** Required. Allowed during live and archive.

---

### POST `/streams/:id/follow`

Follow seller from stream. **Auth:** Buyer. Allowed during live and archive.

---

### DELETE `/streams/:id`

Delete a stream. **Auth:** Seller (owner only).

---

## Orders

### POST `/orders`

Create an order. **Auth:** Buyer only.

**Request body:**
```json
{
  "items": [
    { "productId": "uuid", "quantity": 2 },
    { "productId": "uuid-2", "quantity": 1 }
  ],
  "shippingAddress": "123 Main St, Mumbai 400001"
}
```

| Field           | Type   | Required | Notes                    |
|-----------------|--------|----------|--------------------------|
| items           | array  | Yes      | At least one item        |
| items[].productId| string| Yes      | UUID                     |
| items[].quantity| number| Yes      | ≥ 1                      |
| shippingAddress | string | No       |                          |

---

### GET `/orders`

List orders for the authenticated buyer. **Auth:** Buyer only. **Query params:** `page`, `limit`

---

### GET `/orders/seller`

List orders containing the seller’s products. **Auth:** Seller only. **Query params:** `page`, `limit` (max 100), `status`, `date` (`today` or a single IST day `YYYY-MM-DD`), or an inclusive IST range `from` + `to` (`YYYY-MM-DD`; `400` if `from` > `to`). `date` wins when both are sent.

---

### GET `/orders/:id`

Get order details. **Auth:** Buyer or seller (must be related to the order).

---

### POST `/orders/:id/packing-video`

Upload the packing video for a paid live-stream order (also `POST /replacements/:id/packing-video` for replacements). **Auth:** verified seller. **Body:** multipart `video` (≤ 120 MB request limit). On success the order becomes `PACKED` and `packingVideoUrl` points to permanent Supabase Storage.

| Error | Meaning |
|-------|---------|
| `413` | Storage rejected the file size — record a shorter video |
| `503` | Storage unavailable after 3 attempts — order unchanged, retry |

---

### PATCH `/orders/:id/ship`

Mark order as shipped. **Auth:** Seller only. Order must be PAID.

**Request body:**
```json
{
  "trackingId": "TRK123456789",
  "carrierName": "Bluedart"
}
```

---

### PATCH `/orders/:id/deliver`

Mark order as delivered. **Auth:** Seller only. Order must be SHIPPED.

---

### PATCH `/orders/:id/cancel`

Cancel an order. **Auth:** Buyer only. Order must be PENDING or PAID.

---

### PATCH `/orders/:id/return`

Request return on a delivered order. **Auth:** Buyer only. Order must be DELIVERED.

---

## Categories

### GET `/categories`

List all categories. Public.

---

### GET `/categories/:id`

Get a category by ID. Public.

---

## Buyers

### GET `/buyers/profile`

Get the authenticated buyer’s profile. **Auth:** Buyer only.

**Example:**
```bash
curl http://localhost:3000/buyers/profile \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### GET `/buyers/sellers/:sellerId/channel`

Seller channel page for buyers (one store's lives and replays; the app's reels feed in channel mode swipes only through these). **Auth:** Buyer. `404` if the seller does not exist or is not `VERIFIED`.

**Response:**
```json
{
  "seller": {
    "id": "uuid", "businessName": "…", "description": "…", "logoUrl": "…", "bannerUrl": "…",
    "sellerId": "uuid", "overall": 4.6, "quality": 4.5, "originality": 4.7, "valueForMoney": 4.4,
    "replacementPercent": 2
  },
  "following": true,
  "liveStreams": [
    { "id": "uuid", "title": "…", "viewCount": 120, "isLive": true, "thumbnailUrl": "…",
      "startedAt": "…", "categoryId": "…",
      "seller": { "id": "uuid", "businessName": "…", "logoUrl": "…" },
      "streamProducts": [ { "product": { … } } ] }
  ],
  "archivedLives": [
    { "id": "uuid", "title": "…", "thumbnailUrl": "…", "endedAt": "…", "replayUrl": "…",
      "replayDurationSec": 1800, "viewCount": 248,
      "seller": { "id": "uuid", "businessName": "…", "logoUrl": "…" } }
  ]
}
```

- `liveStreams`: same rules as `GET /streams/active` (live, broadcasting, not ended), newest first, max 20.
- `archivedLives`: same rules as the buyer feed (public, `READY` replay, within the archive window), newest first, max 50.

---

## Sellers

### GET `/sellers/profile`

Get the authenticated seller’s profile. **Auth:** Seller only.

---

### PATCH `/sellers/profile`

Update seller profile. **Auth:** Seller only.

**Request body:**
```json
{
  "description": "Updated store description",
  "bankAccount": "1234567890",
  "ifscCode": "HDFC0001234",
  "logoUrl": "https://example.com/logo.png",
  "bannerUrl": "https://example.com/banner.png"
}
```

---

### GET `/sellers/dashboard`

Get seller dashboard stats. **Auth:** Seller only.

**Response (abbreviated):**
```json
{
  "todayRevenue": 1421,
  "todayOrders": 15,
  "followers": 1204,
  "revenueLast7Days": [ { "dayLabel": "26 Aug", "amount": 200 } ],
  "ordersLast7Days": [ { "dayLabel": "26 Aug", "count": 3 } ],
  "scheduledLiveSessions": [ { "id": "…", "title": "…", "startedAt": "…" } ],
  "activeLiveSession": null,
  "archivedLiveSessions": [
    {
      "id": "uuid",
      "title": "Festive Kurtis Live",
      "thumbnailUrl": "https://…",
      "endedAt": "2026-09-02T10:00:00.000Z",
      "replayUrl": "https://…",
      "replayDurationSec": 2700,
      "replayStatus": "READY",
      "viewCount": 248
    }
  ],
  "liveReward": { "minutesToday": 18, "rewardActive": false }
}
```

`archivedLiveSessions`: seller's own ended streams from the **last 24h** with `replayStatus` `READY` or `RECORDING` (max **15** on dashboard).

---

### GET `/sellers/insights`

Sales insights for a reporting window (dashboard cards, Orders page). **Auth:** verified seller (`JwtAuthGuard`, `RolesGuard`, `SellerVerifiedGuard`).

**Query params:**

| Param | Values |
|-------|--------|
| `period` | `daily` (today, default) · `weekly` (last 7 days incl. today) · `monthly` (1st of month → today) · `custom` |
| `from`, `to` | `YYYY-MM-DD`, required for `custom`; inclusive, max **366** days, not in the future (`400` otherwise) |

All windows are **IST** calendar days. Each is compared with the window of the same length immediately before it (yesterday, previous 7 days, same span last month, previous period).

**Counting rules:** orders in `PAID`, `PACKED`, `SHIPPED`, `DELIVERED`. Revenue = the seller's item subtotal (price × qty, GST-inclusive); buyer-paid delivery and Vybekart-funded coupons are excluded. Payout uses the same calculator as the add-product estimate (gateway 2% + GST, logistics, commission unless waived, TDS 0.1%, TCS 0.5%). Seller-paid shipping uses the recorded Delhivery fee, or the ₹75 estimate if none was recorded.

**Response (abbreviated):**
```json
{
  "period": "weekly",
  "from": "2026-10-06",
  "to": "2026-10-12",
  "label": "6 Oct – 12 Oct 2026",
  "granularity": "day",
  "previous": { "from": "2026-09-29", "to": "2026-10-05", "label": "29 Sep – 5 Oct 2026" },
  "gstRegistered": true,
  "commissionWaiverActive": false,
  "summary": {
    "revenue": 17321.87, "orders": 15, "units": 22, "avgOrderValue": 1154.79,
    "estimatedPayout": 15240.12, "totalDeductions": 2081.75, "totalCollected": 17896.87,
    "previousRevenue": 15100, "previousOrders": 12, "previousPayout": 13290.4,
    "revenueChangePercent": 14.7, "ordersChangePercent": 25, "payoutChangePercent": 14.7
  },
  "payout": {
    "grossSales": 17321.87, "taxableValue": 14679.55, "productGst": 2642.32,
    "gatewayFee": 408.8, "logisticsFee": 1327.5, "commission": 0, "tds": 14.68, "tcs": 73.4,
    "totalDeductions": 2081.75, "netPayout": 15240.12,
    "gatewayGst": 62.36, "logisticsGst": 202.5, "commissionGst": 0, "inputGstCredits": 338.26,
    "buyerDeliveryFees": 575, "couponDiscounts": 0
  },
  "series": [ { "label": "6 Oct", "revenue": 2100, "orders": 2, "payout": 1846.19 } ]
}
```

- `*ChangePercent` is `null` when the previous window was 0 and the current one is not ("new").
- `granularity`: `hour3` (8 three-hour buckets, single day) · `day` (≤ 62 days) · `week` (≤ 182 days) · `month`.
- `netPayout` = `grossSales` − `totalDeductions`; each order's deductions are rounded first so per-order rows add up to the totals exactly.

---

### GET `/sellers/insights/revenue`

Same as `/sellers/insights` plus `orders[]` (every counted order in the window, newest first) for the Revenue page. **Auth:** verified seller.

```json
{
  "orders": [
    {
      "id": "uuid", "shortId": "AB12", "invoiceNumber": "VK/2026/00012",
      "createdAt": "2026-10-12T10:15:00.000Z", "status": "DELIVERED", "buyerName": "Rahul",
      "title": "Leather Sneakers +1 more", "thumbnailUrl": "https://…", "units": 2,
      "itemSales": 2100, "totalPaid": 2175, "buyerDeliveryFee": 75, "couponDiscount": 0,
      "shippingPayer": "BUYER", "totalDeductions": 253.81, "netPayout": 1846.19,
      "items": [ { "name": "Leather Sneakers", "variantLabel": "Size 9", "quantity": 1, "unitPrice": 1500, "lineTotal": 1500, "imageUrl": "https://…" } ],
      "breakdown": { "customerPrice": 2100, "netSettlement": 1846.19, "deductions": [], "taxes": [], "info": [], "disclaimers": [] }
    }
  ]
}
```

`breakdown` uses the same `SellerPayoutBreakdown` shape as the add-product payout sheet (`netSettlement` = the order's `netPayout`).

---

### GET `/sellers/insights/report`

Download the GST / payout audit workbook (`.xlsx`) for the same `period` / `from` / `to` params. **Auth:** verified seller.

Response: `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment; filename="Vybekart_Payout_Report_<Store>_<from>_to_<to>.xlsx"`, `Cache-Control: no-store`.

| Sheet | Contents |
|-------|----------|
| Summary | Seller (store, owner, contact, GSTIN, registration status, address, commission status), period, key figures, settlement breakdown, GST summary, buyer payments, notes |
| Orders | One row per order: IDs, invoice, IST date/time, status, buyer, address, products, units, gross / taxable / GST, buyer delivery and coupon, every deduction, net payout, GST on fees, Razorpay payment ID, packed / shipped / delivered dates, carrier, tracking. Totals row (`SUBTOTAL`) |
| Line items | One row per product line: SKU, HSN, GST %, qty, unit price, line total, taxable value, GST amount |
| Daily summary | Every day in the range (orders, units, sales, deductions, payout), including zero days |

Frozen headers, auto-filter, INR number format (`₹`), IST timestamps.

---

### GET `/sellers/archived-lives`

List seller's archived live replays for the **View all** screen. **Auth:** Seller only.

Same shape as `archivedLiveSessions` items above; returns up to **50** streams (24h window, `READY` or `RECORDING`).

**Example:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://vybekart-backend.onrender.com/sellers/archived-lives
```

---

### GET `/sellers/pending`

List sellers pending approval. **Auth:** Admin only.

---

### PATCH `/sellers/:id/approve`

Approve a pending seller. **Auth:** Admin only.

---

### PATCH `/sellers/:id/reject`

Reject a pending seller. **Auth:** Admin only.

**Request body:**
```json
{ "reason": "Optional rejection reason" }
```

---

## Health

### GET `/health`

Health check (database connectivity). Public.

**Example:**
```bash
curl http://localhost:3000/health
```

---

## Pagination

Endpoints that return paginated lists use this response shape:

```json
{
  "data": [...],
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 20,
    "totalPages": 5,
    "hasNext": true,
    "hasPrev": false
  }
}
```

---

## WebSocket (Streams)

Connect to the streams namespace for chat, likes, and product pins:

**URL:** `ws://localhost:3000/streams` (or your server URL)

**Events (client → server):**

| Event        | Payload                                      | Description       |
|--------------|----------------------------------------------|-------------------|
| join_room    | `{ streamId: string }`                       | Join stream room  |
| chat_message | `{ streamId, message, senderName? }`         | Send chat message |
| like_stream  | `{ streamId }`                               | Send a like       |
| pin_product  | `{ streamId, productId, productName? }`      | Pin a product     |

**Events (server → client):**

| Event          | Payload                                                       |
|----------------|---------------------------------------------------------------|
| viewer_count   | `{ streamId, count }`                                         |
| new_message    | `{ streamId, message, senderName, senderId, timestamp }`      |
| floating_hearts| `{ streamId, from }`                                          |
| pinned_product | `{ streamId, productId, productName, timestamp }`             |

---

## Error Responses

Errors use HTTP status codes and a JSON body:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request"
}
```

Common status codes: `400` (Bad Request), `401` (Unauthorized), `403` (Forbidden), `404` (Not Found), `409` (Conflict).
