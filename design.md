# Vybekart Backend — Design (Brand, Email, Legal)

> Visual and copy standards for **server-rendered** surfaces: transactional email, outreach HTML, invoices, public interest pages.  
> Android light UI is defined in `VybekartAndroid/design.md`. Landing cinematic dark UI is in Landing `design.md`.  
> Shared brand cores must stay aligned.

---

## 1. Brand identity

| Item | Value |
|------|--------|
| Platform brand | **Vybekart** (`VYBEKART_BRAND_NAME`) |
| Slogan | Just Vybe It! |
| Trade name | LIVORA RETAIL |
| Legal name | BHAVANA KAMLESH PRAJAPATI |
| GSTIN | `27BPYPP3775D1Z6` |
| PAN | `BPYPP3775D` |
| Constitution | Proprietorship |
| Website | `https://vybekart.co.in` |
| Contact | `contact@vybekart.co.in` |
| Support / ops | `support@vybekart.co.in` |
| Source | `src/company/company-info.ts` (+ env overrides) |

Do not hardcode a divergent legal block in templates — call `getVybeKartCompanyInfo()`.

---

## 2. Color system (`VYBE_THEME`)

Defined in `src/mail/templates/vybekart-email-layout.ts`:

| Token | Hex | Role |
|-------|-----|------|
| `cyan` | `#00C6FF` | Accent |
| `royal` | `#003BFF` | Brand royal |
| `navy` | `#0B1E5B` | Deep brand / headers |
| `primary` | `#1E88E5` | Primary |
| `primaryDark` | `#1565C0` | Gradient / emphasis |
| `bgLight` | `#F0F4F8` | Email body background |
| `surfaceLight` | `#FFFFFF` | Cards |
| `textLight` | `#1A1D24` | Body text |
| `textMutedLight` | `#64748B` | Secondary |
| `borderLight` | `#E2E8F0` | Dividers |

Email header gradient stops (SVG tile): `#00C6FF` → `#1E88E5` → `#1565C0` → `#0B1E5B`.

**Rule:** Transactional email is **light-mode oriented** (Gmail dark-mode quirks — layout forces readable light patterns). Do not ship dark cinematic landing backgrounds in order/welcome mail.

---

## 3. Typography (email)

- System-safe web fonts in HTML (`Arial`, `Helvetica`, sans-serif stacks).  
- Do not rely on Inter/Manrope loading in email clients.  
- Hierarchy: bold header brand → title → body → muted footer links (Terms / Privacy / site).

---

## 4. Email layout rules

1. Use `vybekart-email-layout.ts` shell for branded HTML.  
2. Prefer HTTPS logo URL (`normalizeLogoUrlForEmail`); SVG/data URI is fallback only.  
3. Escape all user-provided strings (`escapeHtml`).  
4. Footer: legal operator line + website + support.  
5. Seller outreach may use plain text for Gmail Primary placement when that pipeline requires it — keep HTML for previews/admin.  
6. From identities:

| Kind | Typical env |
|------|-------------|
| Transactional | `NOREPLY_EMAIL` / noreply@vybekart.co.in |
| Buyer contact tone | `CONTACT_EMAIL` |
| Ops | `SUPPORT_EMAIL` |
| Seller outreach | `SELLER_OUTREACH_FROM` |

---

## 5. Invoice / PDF design

- PDFKit invoices use DejaVu fonts for glyph coverage.  
- Show platform brand + legal trade details consistent with `company-info`.  
- Keep amounts/taxes unambiguous; English labels.

---

## 6. Public HTML pages served by API

Examples: seller-outreach thank-you, `/admin/seller-emails` UI, `/viewer` LiveKit test.

- Prefer Vybekart navy/cyan/primary accents.  
- Do not invent a third brand palette.  
- Keep copy English.

---

## 7. Alignment with clients

| Client | Relationship |
|--------|----------------|
| Android | Same brand hex cores; app is light Material — emails should feel related, not identical chrome |
| Landing3D | Marketing may be dark cinematic; **emails stay light branded** |
| Legal | Must match landing `/legal` content |

When changing brand colors, update:

1. Backend `VYBE_THEME`  
2. Android `colors.xml` brand cores  
3. Landing `globals.css` brand vars  
4. This `design.md` + Android/Landing design docs  

---

## 8. Auth-adjacent copy (API messages)

- OTP / validation error messages should be clear English (Android parsers display them).  
- Do not return HTML error bodies for JSON APIs.  
- Phone expectations: E.164 `+91…` for India.

---

## 9. Files to edit

| Change | Files |
|--------|--------|
| Legal entity | `src/company/company-info.ts` (+ env) |
| Email chrome | `mail/templates/vybekart-email-layout.ts` |
| Welcome/order bodies | respective `*.template.ts` / services |
| Theme documentation | **this file** |
