# Delhivery Integration — VybeKart Seller Orders

Staging setup for same-day / express delivery via Delhivery CMU API.

---

## Environment variables (Render)

| Variable | Example | Notes |
|----------|---------|-------|
| `DELHIVERY_ENV` | `staging` | Use `prod` only when going live |
| `DELHIVERY_API_TOKEN_STAGING` | `<token>` | From Delhivery staging dashboard |
| `DELHIVERY_API_TOKEN_PROD` | `<token>` | Production token (when live) |
| `DELHIVERY_CLIENT_NAME` | Exact client name | Must match Delhivery account |
| `DELHIVERY_PICKUP_LOCATION` | Warehouse name | **Exact** registered warehouse name in Delhivery |

Set these in Render Dashboard → Environment, then redeploy.

---

## Seller app prerequisites

1. **Store pickup address** — Seller profile → pickup address with valid 6-digit pincode.
2. **Buyer shipping address** — Must include a 6-digit pincode (saved at checkout).
3. **Packing video** — Order must be `PAID` → record video → `PACKED` before Delhivery.

---

## Order flow (seller partner)

| Step | Status | Seller action |
|------|--------|---------------|
| 1 | `PAID` | Order received — **New** tab |
| 2 | `PAID` | Record packing video |
| 3 | `PACKED` | Request Delhivery pickup |
| 4 | `SHIPPED` | In transit — waybill + tracking |
| 5 | `DELIVERED` | Auto-updated when Delhivery reports delivered |

---

## API endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/orders/seller?status=PAID&date=today` | List orders |
| `GET` | `/orders/seller/counts?date=today` | Tab badge counts |
| `GET` | `/orders/:id/seller-detail` | Order detail + timeline |
| `POST` | `/orders/:id/packing-video` | Upload pack video → `PACKED` |
| `PATCH` | `/orders/:id/request-delivery` | Create Delhivery shipment → `SHIPPED` |
| `GET` | `/orders/:id/delivery-status` | Poll tracking → may set `DELIVERED` |

---

## Integration test checklist

1. Set all Delhivery env vars on Render; redeploy backend.
2. Confirm warehouse name in Delhivery dashboard matches `DELHIVERY_PICKUP_LOCATION` exactly.
3. Seller: complete pickup address (valid pin).
4. Buyer: place order via Razorpay on a live stream.
5. Seller app → **Orders** → **Today** → **New** tab — order visible with product image.
6. Tap order → bottom sheet → timeline shows **Order received** done.
7. **Record packing video** → upload succeeds → order moves to **Packed**.
8. **Request Delhivery pickup** → waybill returned → **In transit** tab.
9. **Refresh delivery status** → when Delhivery reports delivered, order moves to **Delivered**.
10. Date filter: switch to **Yesterday** / **Pick date** — counts and list update.

### Failure cases to verify

- Missing pickup address → clear error, stays `PACKED`.
- Invalid pincode in shipping address → error on request-delivery.
- Delhivery API failure → order stays `PACKED` (not marked shipped).

---

## Replacement fulfillment (seller)

Same Delhivery env vars apply. Flow mirrors primary orders after buyer approval (and balance payment if due).

| Step | Replacement status | Seller action |
|------|-------------------|---------------|
| 1 | `APPROVED` | Buyer paid any balance; ready to pack |
| 2 | `APPROVED` | Upload packing video → `PACKED` |
| 3 | `PACKED` | Request Delhivery pickup → `SHIPPED` |
| 4 | `SHIPPED` | Poll delivery status → `DELIVERED` |

### Replacement API endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/replacements/seller?date=today` | List replacement requests |
| `GET` | `/replacements/seller/:id` | Detail + timeline + next action |
| `POST` | `/replacements/:id/packing-video` | Upload pack video → `PACKED` |
| `PATCH` | `/replacements/:id/request-delivery` | Delhivery shipment → `SHIPPED` |
| `GET` | `/replacements/:id/delivery-status` | Poll tracking |

### Buyer balance payment (Razorpay)

When replacement variant costs more than original, status is `AWAITING_PAYMENT` until paid:

| Method | Endpoint |
|--------|----------|
| `POST` | `/payments/razorpay/replacement-balance/:replacementId/create-order` |
| `POST` | `/payments/razorpay/replacement-balance/verify` |

Seller fulfillment is blocked until `balancePaymentStatus` is `PAID` (or `balanceDue` is 0).

---

## Staging URLs

- API base: `https://staging-express.delhivery.com`
- Tracking: `https://www.delhivery.com/track/package/{waybill}`
