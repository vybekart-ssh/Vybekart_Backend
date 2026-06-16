# Seller Email 1 & 2 — bulk send (no terminal)

Email **1** = visibility intro (`seller-intro`).  
Email **2** = partner invitation with **I'm Interested** button (`seller-outreach`).

## Web UI (for your client)

After deploy, open:

**https://vybekart-backend.onrender.com/admin/seller-emails**

1. Sign in with a **Vybekart admin** account (same credentials as the admin app).
2. Choose **Email 1** or **Email 2**.
3. Upload Excel saved as **CSV** (or add rows manually in the table).
4. Edit **email**, **store name**, **contact name** in the table if needed.
5. **Preview first row** to check layout.
6. Click **Send emails** (use **Dry run** first to validate without sending).

### Excel → CSV

In Excel: **File → Save As → CSV (Comma delimited)**.

Required columns:

| Column | Example |
|--------|---------|
| `email` | seller@store.com |
| `store_name` | OPUS STORE |
| `contact_name` | Vishal Ugalmugale |
| `phone` | optional |
| `city` | optional |

Template file: `scripts/email/seller-email-template.csv`

## API (used by the web UI)

All routes require `Authorization: Bearer <admin JWT>`.

| Method | Path | Body |
|--------|------|------|
| POST | `/admin/seller-emails/parse-csv` | `{ "csvContent": "..." }` |
| POST | `/admin/seller-emails/preview` | `{ "kind": "email1" \| "email2", "recipient": { email, storeName, contactName } }` |
| POST | `/admin/seller-emails/send` | `{ "kind", "recipients": [...], "dryRun": false }` |

## Env (server)

| Variable | Purpose |
|----------|---------|
| `RESEND_API_KEY` | Required to send |
| `SELLER_OUTREACH_FROM` | From address (defaults to CEO) |
| `CEO_NAME`, `CEO_EMAIL`, `CEO_PHONE` | Signature block |
| `API_PUBLIC_URL` | Email 2 interest button links |
| `JWT_SECRET` or `SELLER_OUTREACH_INTEREST_SECRET` | Sign interest URLs |
| `SELLER_EMAIL_SEND_DELAY_MS` | Pause between sends (default 600ms) |

## CLI (developers only)

```bash
npm run email-1:preview
npm run email-2:preview
```

Legacy names `seller-intro:*` and `seller-outreach:*` still work.

## Branding

All customer-facing copy uses **Vybekart** (lowercase k), never VybeKart.
