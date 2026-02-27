# VybeKart Backend – API Testing Guide

What you need to provide and how to test all APIs.

---

## 1. Environment (required)

Create a `.env` file in the project root with at least:

```env
# Required – app will not start without these
DATABASE_URL="postgresql://postgres:password@localhost:5432/vybekart?schema=public"
JWT_SECRET="your-secret-at-least-16-chars"

# Optional – defaults shown
PORT=3000
REDIS_HOST=localhost
REDIS_PORT=6379
NODE_ENV=development
JWT_EXPIRES_IN=7d

# Optional – for refresh tokens (login will return refresh_token if set)
JWT_REFRESH_SECRET="another-secret-at-least-16-chars"
JWT_REFRESH_EXPIRES_IN=30d

# Optional – CORS (comma-separated origins)
CORS_ORIGIN=http://localhost:3000,http://localhost:5173
```

- **JWT_SECRET** must be at least **16 characters** (validated at startup).
- **Redis** must be running for: refresh tokens, stream viewer counts, Socket.io (optional for basic HTTP APIs).

### Upstash Redis (optional – no Docker)

If you use **Upstash** for Redis:

1. Go to [console.upstash.com](https://console.upstash.com) → sign in → **Create database**.
2. Choose region, name, then **Create**.
3. Open the database → **Redis Connect** (or **REST API**).
4. Copy the **Redis URL** (starts with `rediss://` – TLS).

In `.env` set **only**:

```env
REDIS_URL="rediss://default:YOUR_PASSWORD@YOUR_ENDPOINT.upstash.io:6379"
```

Do **not** set `REDIS_HOST` / `REDIS_PORT` when using `REDIS_URL`; the app will use the URL. For local Docker Redis, omit `REDIS_URL` and use `REDIS_HOST=localhost` and `REDIS_PORT=6379`.

---

## 2. Run infrastructure and app

```bash
# 1. Start Postgres + Redis
docker compose up -d

# 2. Apply migrations (first time only)
npx prisma migrate dev --name init

# 3. Start the server
npm run start:dev
```

Base URL: **http://localhost:3000** (or your `PORT`).

---

## 3. What to provide per API

### Health (no auth)

| What to provide | Example |
|-----------------|--------|
| Method + URL    | `GET http://localhost:3000/health` |
| Headers         | None |

---

### Auth

**Register seller**

| What to provide | Example |
|-----------------|--------|
| Method + URL    | `POST http://localhost:3000/auth/register/seller` |
| Headers         | `Content-Type: application/json` |
| Body            | `email`, `password` (min 6), `name`, `businessName`; optional: `phone`, `gstNumber` |

```json
{
  "email": "seller@test.com",
  "password": "password123",
  "name": "Test Seller",
  "businessName": "My Shop",
  "phone": "+919876543210",
  "gstNumber": "29XXXXX1234X1Z5"
}
```

**Register buyer**

| What to provide | Example |
|-----------------|--------|
| Method + URL    | `POST http://localhost:3000/auth/register/buyer` |
| Headers         | `Content-Type: application/json` |
| Body            | `email`, `password` (min 6), `name`; optional: `phone` |

```json
{
  "email": "buyer@test.com",
  "password": "password123",
  "name": "Test Buyer",
  "phone": "+919876543210"
}
```

**Login**

| What to provide | Example |
|-----------------|--------|
| Method + URL    | `POST http://localhost:3000/auth/login` |
| Headers         | `Content-Type: application/json` |
| Body            | `email`, `password` |

```json
{
  "email": "seller@test.com",
  "password": "password123"
}
```

Response includes `access_token` (and `refresh_token` if `JWT_REFRESH_SECRET` is set). Use `access_token` in **Authorization** for protected routes.

**Refresh token** (optional – only if `JWT_REFRESH_SECRET` is set)

| What to provide | Example |
|-----------------|--------|
| Method + URL    | `POST http://localhost:3000/auth/refresh` |
| Headers         | `Content-Type: application/json` |
| Body            | `refresh_token` (from login) |

```json
{
  "refresh_token": "<value from login response>"
}
```

---

### Users (no auth; no password in response)

| What to provide | Example |
|-----------------|--------|
| Method + URL    | `GET http://localhost:3000/users?page=1&limit=20` |
| Headers         | None |
| Query           | Optional: `page`, `limit` (defaults 1, 20) |

---

### Sellers (JWT required)

| What to provide | Example |
|-----------------|--------|
| Method + URL    | `GET http://localhost:3000/sellers/profile` |
| Headers         | `Authorization: Bearer <access_token>` |

Use a **seller** user’s token (from login after register/seller).

---

### Buyers (JWT required)

| What to provide | Example |
|-----------------|--------|
| Method + URL    | `GET http://localhost:3000/buyers/profile` |
| Headers         | `Authorization: Bearer <access_token>` |

Use a **buyer** user’s token.

---

### Streams

**Create stream** (JWT + Seller)

| What to provide | Example |
|-----------------|--------|
| Method + URL    | `POST http://localhost:3000/streams` |
| Headers         | `Authorization: Bearer <seller_access_token>`, `Content-Type: application/json` |
| Body            | `title`; optional: `description` (no `sellerId` – taken from JWT) |

```json
{
  "title": "Live Sneaker Sale",
  "description": "Vintage kicks today"
}
```

**List active streams** (no auth)

| What to provide | Example |
|-----------------|--------|
| Method + URL    | `GET http://localhost:3000/streams/active?page=1&limit=20` |
| Query           | Optional: `page`, `limit` |

**Get one stream** (no auth)

| What to provide | Example |
|-----------------|--------|
| Method + URL    | `GET http://localhost:3000/streams/<streamId>` |

**Update / Stop / Delete stream** (JWT + Seller, owner only)

- `PATCH http://localhost:3000/streams/<streamId>` – body: `title` and/or `description`
- `PATCH http://localhost:3000/streams/<streamId>/stop`
- `DELETE http://localhost:3000/streams/<streamId>`

Headers: `Authorization: Bearer <seller_access_token>`.

---

### Products

**Create product** (JWT + Seller)

| What to provide | Example |
|-----------------|--------|
| Method + URL    | `POST http://localhost:3000/products` |
| Headers         | `Authorization: Bearer <seller_access_token>`, `Content-Type: application/json` |
| Body            | `name`, `price`; optional: `description`, `stock`, `images[]`, `categoryId` (UUID) |

```json
{
  "name": "Vintage Air Max",
  "description": "Classic 90s",
  "price": 129.99,
  "stock": 10,
  "images": ["https://example.com/img1.jpg"],
  "categoryId": "<uuid-or-omit>"
}
```

**List all products** (no auth)

- `GET http://localhost:3000/products?page=1&limit=20`

**My listings** (JWT + Seller)

- `GET http://localhost:3000/products/my-listings?page=1&limit=20`  
- Headers: `Authorization: Bearer <seller_access_token>`

**Get one product** (no auth)

- `GET http://localhost:3000/products/<productId>`

**Update / Delete product** (JWT + Seller, owner only)

- `PATCH http://localhost:3000/products/<productId>` – body: same fields as create (partial).
- `DELETE http://localhost:3000/products/<productId>`  
- Headers: `Authorization: Bearer <seller_access_token>`.

---

### Orders (JWT + Buyer for create/list; JWT for get one)

**Create order** (JWT + Buyer)

| What to provide | Example |
|-----------------|--------|
| Method + URL    | `POST http://localhost:3000/orders` |
| Headers         | `Authorization: Bearer <buyer_access_token>`, `Content-Type: application/json` |
| Body            | `items[]` with `productId` (UUID) and `quantity`; optional: `shippingAddress` |

```json
{
  "items": [
    { "productId": "<product-uuid>", "quantity": 2 }
  ],
  "shippingAddress": "123 Main St, City, PIN"
}
```

**My orders** (JWT + Buyer)

- `GET http://localhost:3000/orders?page=1&limit=20`  
- Headers: `Authorization: Bearer <buyer_access_token>`

**Get one order** (JWT – only own orders)

- `GET http://localhost:3000/orders/<orderId>`  
- Headers: `Authorization: Bearer <access_token>`

---

## 4. Quick test flow (copy-paste friendly)

Assume base URL is `http://localhost:3000`. Replace `<BASE>` and tokens/IDs as you get them.

1. **Health**
   ```bash
   curl -s http://localhost:3000/health | jq
   ```

2. **Register seller + get token**
   ```bash
   curl -s -X POST http://localhost:3000/auth/register/seller \
     -H "Content-Type: application/json" \
     -d '{"email":"seller@test.com","password":"password123","name":"Seller","businessName":"Shop"}' | jq
   ```
   Copy `access_token` → `SELLER_TOKEN`.

3. **Create stream (seller)**
   ```bash
   curl -s -X POST http://localhost:3000/streams \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $SELLER_TOKEN" \
     -d '{"title":"My First Stream","description":"Test"}' | jq
   ```
   Copy `id` → `STREAM_ID` if needed.

4. **Create product (seller)**
   ```bash
   curl -s -X POST http://localhost:3000/products \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $SELLER_TOKEN" \
     -d '{"name":"Cool Sneakers","price":99.99,"stock":5}' | jq
   ```
   Copy `id` → `PRODUCT_ID`.

5. **Register buyer + get token**
   ```bash
   curl -s -X POST http://localhost:3000/auth/register/buyer \
     -H "Content-Type: application/json" \
     -d '{"email":"buyer@test.com","password":"password123","name":"Buyer"}' | jq
   ```
   Copy `access_token` → `BUYER_TOKEN`.

6. **Create order (buyer)**
   ```bash
   curl -s -X POST http://localhost:3000/orders \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $BUYER_TOKEN" \
     -d "{\"items\":[{\"productId\":\"$PRODUCT_ID\",\"quantity\":1}]}" | jq
   ```

7. **List active streams**
   ```bash
   curl -s "http://localhost:3000/streams/active?page=1&limit=10" | jq
   ```

8. **List users (paginated)**
   ```bash
   curl -s "http://localhost:3000/users?page=1&limit=5" | jq
   ```

---

## 5. Socket.io (optional)

- **Namespace**: `/streams`
- **URL**: `http://localhost:3000` (same origin as HTTP API).
- **Events to emit (client)**:
  - `join_room` – payload: `{ streamId: "<stream-uuid>" }`
  - `chat_message` – payload: `{ streamId, message, senderName? }`
  - `like_stream` – payload: `{ streamId }`
  - `pin_product` – payload: `{ streamId, productId, productName? }`
- **Events you receive (server)**:
  - `viewer_count` – `{ streamId, count }`
  - `new_message` – chat message for the room
  - `floating_hearts` – like notification
  - `pinned_product` – product pin for the room

Use a Socket.io client (e.g. browser or Postman with Socket.io) and connect to `http://localhost:3000/streams`.

---

## 6. Checklist before testing

- [ ] `.env` has `DATABASE_URL` and `JWT_SECRET` (min 16 chars).
- [ ] Postgres and Redis are running (`docker compose up -d`).
- [ ] Migrations applied (`npx prisma migrate dev`).
- [ ] Server running (`npm run start:dev`).
- [ ] For protected routes: use `Authorization: Bearer <access_token>`.
- [ ] For seller-only: register/login as seller and use that token.
- [ ] For buyer-only (e.g. create order): register/login as buyer and use that token.
- [ ] For refresh token: set `JWT_REFRESH_SECRET` in `.env` and use `refresh_token` from login in `POST /auth/refresh`.

If you use Postman/Insomnia: create an environment variable `access_token` and set it from the login/register response, then use `Authorization: Bearer {{access_token}}` on protected requests.
