# Delhivery + Orders — Go-live checklist

Full flow: **live stream → Razorpay checkout → seller packs → Delhivery shipment + pickup → tracking → DELIVERED → invoice**.

---

## 1. Environment variables (Render Dashboard)

Set these, then **redeploy** the backend.

### Delhivery (required for shipping)

| Variable | Value | Notes |
|----------|--------|--------|
| `DELHIVERY_ENV` | `prod` | Uses `https://track.delhivery.com` |
| `DELHIVERY_API_TOKEN_PROD` | Your live API token | From Delhivery One → Settings → API Setup |
| `DELHIVERY_CLIENT_NAME` | Exact HQ/client name | Case-sensitive — from Delhivery account manager |
| `DELHIVERY_PICKUP_LOCATION` | Exact warehouse name | Must match registered warehouse in Delhivery |
| `DELHIVERY_AUTO_PICKUP_REQUEST` | `true` | Schedules pickup after AWB creation (recommended) |
| `DELHIVERY_PICKUP_TIME` | `15:00:00` | IST pickup slot (hh:mm:ss) |

### Razorpay (required for checkout)

| Variable | Value |
|----------|--------|
| `RAZORPAY_KEY_ID` | `rzp_live_...` or `rzp_test_...` for testing |
| `RAZORPAY_KEY_SECRET` | Matching secret |

### Already on Render (verify)

| Variable | Purpose |
|----------|---------|
| `API_PUBLIC_URL` | `https://vybekart-backend.onrender.com` |
| `JWT_SECRET` | Auth |
| `DATABASE_URL` / `REDIS_URL` | Data |
| `SUPABASE_URL` | Uploads / email logos |

### Invoice PDF (optional overrides)

See `Testing/Invoice-Setup.md` — defaults work without extra vars.

---

## 2. Get from Delhivery (before first shipment)

1. **Live API token** — Delhivery One → Settings → API Setup  
2. **Client name** (`DELHIVERY_CLIENT_NAME`) — exact string Delhivery uses for your account  
3. **Warehouse / pickup location name** (`DELHIVERY_PICKUP_LOCATION`) — exact registered name  
4. Confirm **Express** mode is enabled on your account (app sends `shipping_mode: Express`)  
5. Optional: ask BD manager to schedule **daily auto-pickup** if you prefer panel over API

---

## 3. Safe connectivity test (no shipment)

After deploy, call as **admin** (JWT from `POST /auth/login`):

```http
GET /admin/delhivery/status?pin=400001
Authorization: Bearer <admin_token>
```

Expected when configured:

```json
{
  "configured": true,
  "env": "prod",
  "baseUrl": "https://track.delhivery.com",
  "hasClientName": true,
  "hasPickupLocation": true,
  "autoPickupRequest": true,
  "pincodeTest": { "pin": "400001", "serviceable": true },
  "quoteTest": { "fee": 0, "currency": "INR", ... }
}
```

If `configured: false` → set `DELHIVERY_API_TOKEN_PROD`.  
If `hasClientName` or `hasPickupLocation` is false → set those env vars.

---

## 4. Seller + buyer prerequisites

| Who | Requirement |
|-----|-------------|
| **Seller** | Verified seller account |
| **Seller** | Pickup address with valid **6-digit pincode** |
| **Seller** | At least one product |
| **Buyer** | Shipping address with **6-digit pincode** in address |
| **Buyer** | Phone number on profile |

---

## 5. End-to-end order flow

| Step | Status | Action |
|------|--------|--------|
| 1 | Live stream | Seller goes live; buyer joins |
| 2 | Checkout | Buyer pays via Razorpay |
| 3 | `PAID` | Seller sees order in **New** tab |
| 4 | `PAID` | Seller records **packing video** |
| 5 | `PACKED` | Seller taps **Request Delhivery pickup** |
| 6 | `SHIPPED` | AWB created + pickup scheduled (if auto enabled) |
| 7 | Tracking | App polls Delhivery via `GET /orders/:id/delivery-status` |
| 8 | `DELIVERED` | When Delhivery reports delivered |
| 9 | Invoice | Buyer downloads from order details |

### API endpoints

| Method | Endpoint |
|--------|----------|
| `POST` | `/payments/razorpay/create-order` + `/verify` |
| `POST` | `/orders/:id/packing-video` |
| `PATCH` | `/orders/:id/request-delivery` |
| `GET` | `/orders/:id/delivery-status` |
| `GET` | `/orders/:id/invoice` (after `DELIVERED`) |

Replacements use the same Delhivery vars on `/replacements/:id/request-delivery`.

---

## 6. What happens on “Request Delhivery pickup”

1. **Create shipment** — `POST /api/cmu/create.json` → waybill  
2. **Schedule pickup** — `POST /fm/request/new/` (when `DELHIVERY_AUTO_PICKUP_REQUEST=true`)  
3. Order → `SHIPPED` with `trackingId` = waybill  

If shipment fails, order stays `PACKED` (not marked shipped).

---

## 7. Local `.env` template

Copy into `Vybekart_Backend/.env` for local testing:

```env
DELHIVERY_ENV=prod
DELHIVERY_API_TOKEN_PROD=your_live_token_here
DELHIVERY_CLIENT_NAME=Your Exact Client Name
DELHIVERY_PICKUP_LOCATION=Your Exact Warehouse Name
DELHIVERY_AUTO_PICKUP_REQUEST=true
DELHIVERY_PICKUP_TIME=15:00:00

RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
API_PUBLIC_URL=http://localhost:3000
```

---

## 8. Troubleshooting

| Symptom | Fix |
|---------|-----|
| “Delhivery is not configured” | Set `DELHIVERY_API_TOKEN_PROD` + `DELHIVERY_ENV=prod` |
| “could not create shipment” | Check client name + pickup location spelling (case-sensitive) |
| Missing pickup pincode | Seller pickup address needs 6-digit `zip` |
| Missing destination pincode | Buyer address must contain 6-digit pin in text |
| AWB created but no pickup | Check logs for pickup API; verify `DELHIVERY_PICKUP_TIME` is in working hours |
| Invoice not available | Order must be `DELIVERED` |

---

## 9. Tracking URL

`https://www.delhivery.com/track/package/{waybill}`
