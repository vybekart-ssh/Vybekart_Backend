# VybeKart Android alpha — Gmail export + Resend bulk invite

## 1) Export registrations from Gmail (you)

1. Open [Google Sheets](https://sheets.google.com) → **New** spreadsheet.
2. **Extensions → Apps Script** → delete default code → paste the contents of [`gmail-export-apps-script.gs`](./gmail-export-apps-script.gs) → **Save** (project name e.g. `VybeKart Gmail export`).
3. In `gmail-export-apps-script.gs`, set **`GMAIL_QUERY`** to match your inbox, for example:
   - `label:Vybekart_Registrations`
   - or `to:vybekart88@gmail.com (subject:Shopper OR subject:Seller)`  
   Run **once** from the script editor: select function **`extractRegistrationsToSheet`** → **Run** → authorize **Gmail** and **Sheets**.
4. Return to the Sheet: menu **VybeKart → Extract registrations from Gmail** (or run the function again from the editor).
5. **File → Download → Comma-separated values (.csv)**. Save as `registrations.csv`.

**Field parsing:** The script combines **plain-text body**, **HTML body** (tags stripped), and the **subject line**. Many VybeKart notifications put `Name:` / `Email:` in the **subject** (especially seller mail); older versions only read plain body and wrote **0 rows**. It also runs **multiple Gmail searches** (`label:Vybekart_Registrations`, lowercase variant, and subject keywords) and merges results. Adjust `GMAIL_QUERIES` in the `.gs` file if your label name differs.

**Still 0 rows?** Re-paste the latest `gmail-export-apps-script.gs`, save, authorize Gmail again, and run **VybeKart → Extract registrations from Gmail**. The completion dialog reports **Threads scanned** and how many messages had no detectable email.

**Deduping:** Same email appears only once (first occurrence wins in export order).

---

## 2) Resend + domain (you)

1. In [Resend](https://resend.com), add and verify **`vybekart.co.in`** (DNS records at your registrar).
2. Create an **API key**.
3. In the backend [`.env`](../../.env) (or shell), set:
   - `RESEND_API_KEY=re_...`
   - `MAIL_FROM=VybeKart <noreply@vybekart.co.in>` (must use verified domain)

---

## 3) Optional branding / links (`.env`)

See [`config.example.env`](./config.example.env). Important overrides:

| Variable | Purpose |
|----------|---------|
| `ALPHA_DRIVE_URL` | Google Drive folder for the APK (default is your shared release folder). |
| `ALPHA_WEBSITE_URL` | Landing site (default `https://vybekart.co.in`). |
| `ALPHA_LOGO_URL` | **Direct** HTTPS URL to a PNG/JPEG (must return `Content-Type: image/*`). Supabase: bucket **public**, correct path/case (`Vybekart` vs `vybekart`). If unset, header is text-only. The send script **verifies** the URL before mailing. In **Gmail**, choose *Display images* for your sender if they are blocked. |
| `ALPHA_LOGO_NO_CACHE_BUST` | Set to `true` to stop appending `?v=1` (only if your host rejects unknown query params). |
| `ALPHA_REPLY_TO` | Monitored inbox for replies (e.g. `support@vybekart.co.in`). |
| `ALPHA_SUPPORT_EMAIL` / `ALPHA_SUPPORT_PHONE` / `ALPHA_COMPANY_LEGAL_NAME` | Footer contact block. |
| `ALPHA_TERMS_URL` / `ALPHA_PRIVACY_URL` | Legal links. |
| `REGISTRATIONS_CSV` | Path to CSV if not using `./scripts/alpha-invite/registrations.csv`. |
| `DRY_RUN=true` | Print recipients only; no Resend calls. |
| `ALPHA_SEND_DELAY_MS` | Delay between sends (default `700`). |
| `ALPHA_SEND_LOG` | JSONL log path (default: timestamped file under this folder). |

---

## 4) Send invites (from backend repo root)

Dry run:

```bash
npx ts-node --transpile-only scripts/alpha-invite/send-alpha-invites.ts --dry-run
```

Set `REGISTRATIONS_CSV` if your CSV lives elsewhere, then:

```bash
set REGISTRATIONS_CSV=scripts\alpha-invite\registrations.csv
set DRY_RUN=false
npx ts-node --transpile-only scripts/alpha-invite/send-alpha-invites.ts
```

(PowerShell: `$env:REGISTRATIONS_CSV="..."; $env:DRY_RUN="false"; npx ts-node ...`)

Or use npm:

```bash
npm run alpha-invite:send -- --dry-run
npm run alpha-invite:send
```

---

## 5) Google Drive sharing

The default link points to your shared folder **VYBEKART_RELEASE_APK**. Ensure link access is **Anyone with the link** (Viewer) so users without a Google login can download **Vybekart.apk**.

---

## Files

| File | Role |
|------|------|
| `gmail-export-apps-script.gs` | Paste into Apps Script bound to a Sheet. |
| `send-alpha-invites.ts` | Reads CSV, sends HTML + text via Resend. |
| `registrations.example.csv` | Column reference / smoke test. |
| `config.example.env` | Copy snippets into `.env`. |
