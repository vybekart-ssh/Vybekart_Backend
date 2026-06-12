# Tax Invoice PDF — VybeKart

## Environment variables (Render)

| Variable | Example | Purpose |
|----------|---------|---------|
| `ALPHA_COMPANY_LEGAL_NAME` | VybeKart Private Limited | Footer registered office title |
| `VYBEKART_REGISTERED_OFFICE` | Multi-line address | Footer address block |
| `VYBEKART_PLATFORM_GSTIN` | Optional | Platform GST in footer |
| `ALPHA_LOGO_URL` | https://…/vybekart_logo.png | Email/logo (PDF header optional) |
| `SUPPORT_EMAIL` | support@vybekart.co.in | Footer contact |

## API endpoints

| Method | Path | When |
|--------|------|------|
| `GET` | `/orders/:id/invoice` | Buyer, order `DELIVERED` |
| `GET` | `/replacements/:id/invoice` | Buyer, replacement `DELIVERED` |

Returns `application/pdf` with `Content-Disposition: attachment`.

## Seller prerequisites

- Valid **GSTIN** on seller profile
- **Business address** or pickup address on file

## Android

- Order details → **Download Invoice** (delivered orders only)
- Replacement detail sheet → **Download Invoice** (delivered replacements)
- Files save to `Downloads/Vybekart/Invoices/`

## Test checklist

1. Run migration: `npx prisma migrate deploy`
2. Deliver a test order with seller GST + product HSN
3. Download invoice from buyer app → open in PDF viewer
4. Verify GST break-up, amounts, no signature block
5. Re-download → same invoice number
