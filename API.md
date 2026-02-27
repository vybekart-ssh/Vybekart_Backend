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

List orders containing the seller’s products. **Auth:** Seller only. **Query params:** `page`, `limit`

---

### GET `/orders/:id`

Get order details. **Auth:** Buyer or seller (must be related to the order).

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

Get dashboard stats (product count, sales). **Auth:** Seller only.

**Response:**
```json
{
  "productCount": 42,
  "sales": 0
}
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
