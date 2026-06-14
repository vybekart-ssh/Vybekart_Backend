# Tax Invoice PDF — VybeKart

Legal entity details match [vybekart.co.in/legal](https://vybekart.co.in/legal) (LIVORA RETAIL / BHAVANA KAMLESH PRAJAPATI, proprietorship).

## Logo assets (bundled)

| File | Source |
|------|--------|
| `assets/brand/vybekart_logo.svg` | Primary — rasterized via sharp for PDF |
| `assets/brand/vybekart-logo.png` | Fallback |

Copied from `VybekartAndroid/app/src/main/assets/brand/vybekart_logo.svg` and `ic_launcher-playstore.png`.

## Optional env overrides (Render)

| Variable | Default |
|----------|---------|
| `VYBEKART_TRADE_NAME` | LIVORA RETAIL |
| `VYBEKART_LEGAL_NAME` | BHAVANA KAMLESH PRAJAPATI |
| `VYBEKART_PLATFORM_GSTIN` | 27BPYPP3775D1Z6 |
| `VYBEKART_REGISTERED_OFFICE` | Multi-line address from GST certificate |
| `SUPPORT_EMAIL` / `VYBEKART_CONTACT_EMAIL` | contact@vybekart.co.in |

## Sample PDF (layout preview)

```bash
npm run invoice:sample
```

Opens `Testing/sample-tax-invoice.pdf`. Or hit `GET /invoices/sample` in the browser (no auth).

## API endpoints

| Method | Path | When |
|--------|------|------|
| `GET` | `/invoices/sample` | Public sample layout |
| `GET` | `/orders/:id/invoice` | Buyer, order `DELIVERED` |
| `GET` | `/replacements/:id/invoice` | Buyer, replacement `DELIVERED` |

## Seller prerequisites

- **Business name** and **address** (or pickup address) on file
- **GSTIN** is optional — omitted on the invoice when not set

## Test checklist

1. Run migration: `npx prisma migrate deploy`
2. Deliver a test order with seller GST + product HSN
3. Download invoice from buyer app → open in PDF viewer
4. Verify LIVORA RETAIL footer, GSTIN 27BPYPP3775D1Z6, ₹ amounts, logo
5. Re-download → same invoice number
