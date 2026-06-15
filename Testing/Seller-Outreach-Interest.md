# Seller outreach — "I'm Interested" button

## How it works

1. Outreach email includes an **I'm Interested** button.
2. Click opens: `GET /public/seller-outreach/interested?email=...&store=...&contact=...&sig=...`
3. Backend verifies the signed link, then:
   - Emails **you** (CEO / `SELLER_OUTREACH_INTEREST_TO`) that the seller is interested
   - Sends the seller a **confirmation email** from noreply
4. Browser shows a thank-you page.

Links are HMAC-signed with `JWT_SECRET` (or `SELLER_OUTREACH_INTEREST_SECRET`).

## Commands

### 1. Regenerate HTML preview (includes button)

```bash
cd Vybekart_Backend
npm run seller-outreach:preview
```

Opens `scripts/email/seller-outreach-preview.html`. Console prints the **Interest URL** for testing.

### 2. Dry-run send (no email)

```bash
SELLER_OUTREACH_TO=you@example.com \
SELLER_OUTREACH_STORE_NAME="Demo Store" \
SELLER_OUTREACH_CONTACT_NAME="Demo Owner" \
DRY_RUN=true \
npm run seller-outreach:demo
```

### 3. Send test outreach email

```bash
SELLER_OUTREACH_TO=seller@example.com \
SELLER_OUTREACH_STORE_NAME="Anjana Fashion" \
SELLER_OUTREACH_CONTACT_NAME="Team Anjana" \
npm run seller-outreach:demo
```

### 4. Test the interest endpoint (after deploy)

Copy the **Interest URL** from preview/send logs, or open it from the email, e.g.:

```bash
curl -i "https://vybekart-backend.onrender.com/public/seller-outreach/interested?email=...&store=...&contact=...&sig=..."
```

You should get `200` HTML thank-you page and two emails (notify + seller confirmation).

### 5. Local backend test

```bash
npm run start:dev
```

Then open the interest URL with `API_PUBLIC_URL=http://localhost:3000` when generating preview.

## Env (Render / .env)

| Variable | Purpose |
|----------|---------|
| `API_PUBLIC_URL` | Base URL embedded in interest button |
| `JWT_SECRET` | Signs interest links |
| `SELLER_OUTREACH_INTEREST_TO` | Inbox for interest notifications (default: CEO_EMAIL) |
| `RESEND_API_KEY` | Required to send notification emails |
| `CEO_EMAIL` | Default notify address |
