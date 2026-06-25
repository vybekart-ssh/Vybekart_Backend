# VybeKart DLT SMS Setup Guide

Complete step-by-step guide for DLT registration, content templates, Fast2SMS integration, and backend configuration.

---

## Overview

| Item | Value |
|------|-------|
| Sender ID (Header) | `VYBEKT` |
| Header Type | OTHER → Service Implicit (or Transactional for OTP) |
| Category | Communication / Broadcasting / Entertainment / IT |
| Brand Name | Vybekart |
| SMS Provider | Fast2SMS |
| App Package | `com.vybekart.app` |
| SMS Retriever Hash | `yXX2EIKmar0` |
| OTP Variable (TRAI) | `{#numeric#}` |
| Backend Route | `FAST2SMS_ROUTE=dlt` |
| **SMS Retriever max length** | **140 characters** (entire message incl. hash line) |
| **Single SMS billing max** | **160 characters** (carrier segment limit) |

---

## Phase 1 — Entity Registration (one-time)

1. Go to DLT portal (Jio / Airtel / Vi / BSNL)
2. Create **Enterprise / Principal Entity** account
3. Submit KYC documents (PAN, GST, incorporation cert, signatory ID)
4. Wait for approval (1–3 business days)
5. Save your **Entity ID / PE ID** (19-digit number)

---

## Phase 2 — Header Registration (`VYBEKT`)

Reference: `Entity-Header-registration-user-manual.pdf`

1. Login → Select **Enterprise** → Complete OTP verification
2. Dashboard → **SMS Header** → **Add Header**
3. Fill in:
   - **Header type:** OTHER (6-alpha, not Promotional)
   - **Message type:** Service Implicit (OTP for app login/signup)
   - **Category:** Communication / Broadcasting / Entertainment / IT
   - **Header name:** `VYBEKT`
   - **Attachment:** Website screenshot / trademark / app branding
   - **Explanation (1 line):**  
     `OTP SMS for VybeKart e-commerce app login, buyer/seller partner signup, and password reset.`
4. Submit → Status: **Pending**
5. Wait for approval → Status: **Approved**

**Note:** Promotional = 6 numeric headers. OTP uses 6-alpha headers under OTHER.

---

## Phase 3 — Get Play Store SMS Retriever Hash

**Hash obtained:** `yXX2EIKmar0`

### How it was obtained (for reference)

1. Install VybeKart **from Google Play Store** (not sideloaded APK)
2. Enable USB debugging on phone
3. Android Studio Logcat → filter `VybekartOtp`
4. Open OTP screen in app
5. Copy 11-char hash from log: `SMS Retriever hashes: [yXX2EIKmar0]`

**Important:** Upload keystore hash ≠ Play Store hash. Always use Play-installed app hash.

---

## Phase 4 — Content Template Registration (4 templates)

Reference: `Entity-Content-template-registration.pdf`

**Prerequisite:** Header `VYBEKT` must be **Approved**

### Portal steps (repeat for each template)

1. Login → Enterprise → OTP verification
2. Dashboard → **Content Template** → **+ Add**
3. Fill mandatory fields:

| Field | Value |
|-------|-------|
| Template Type | **Transactional** (OTP for e-commerce/app login) |
| Category | Communication / Broadcasting / Entertainment / IT |
| Header | `VYBEKT` |
| Message type | Text |
| Brand Name | Vybekart |
| LOB | Optional |
| Input method | **Single** |

4. Enter Template Name + Template Message (see below)
5. Click **Save**
6. Enter sample value for `{#numeric#}`: e.g. `482910`
7. **Preview** final message
8. **Submit**
9. Repeat for all 4 templates

### Template 1 — Login OTP

**Template Name:** `Vybekart Login OTP`

**Template Message:**

```
<#> Your Vybekart login OTP is {#numeric#}. Valid for 10 minutes. Do not share this code with anyone.
yXX2EIKmar0
```

### Template 2 — Buyer Signup OTP

**Template Name:** `Vybekart Buyer Signup OTP`

**Template Message:**

```
<#> Welcome to Vybekart. Your Buyer signup OTP is {#numeric#}. Valid for 10 minutes. Do not share.
yXX2EIKmar0
```

(~125 chars with 6-digit OTP — fits SMS Retriever 140-byte limit)

### Template 3 — Seller Partner Signup OTP

**Template Name:** `Vybekart Seller Partner Signup OTP`

**Template Message:**

```
<#> Welcome to Vybekart Seller Partner. Your OTP is {#numeric#}. Valid for 10 minutes. Do not share this code with anyone.
yXX2EIKmar0
```

(~129 chars with 6-digit OTP — fits SMS Retriever; avoids 2-SMS billing)

**Previous longer Seller text** (`Your OTP to register as a Seller Partner…`) was 161 chars → split into **2 SMS** (double cost) and **broke Android auto-fill**. Re-submit this shorter version if you registered the old one.

### Template 4 — Forgot Password OTP

**Template Name:** `Vybekart Forgot Password OTP`

**Template Message:**

```
<#> Your Vybekart password reset OTP is {#numeric#}. Valid for 10 minutes. Do not share this code with anyone.
yXX2EIKmar0
```

### Template rules

- Use `{#numeric#}` for OTP (TRAI typed variable — not `{#var#}`)
- Hash `yXX2EIKmar0` on its own line at the end (static, not a variable) — **nothing after the hash**
- `<#>` prefix required for Android SMS auto-read
- Text must match **exactly** at send time
- "10 minutes" is fixed (matches backend `OTP_TTL_SECONDS = 600`)
- **Keep entire message ≤ 140 characters** (Google SMS Retriever limit for auto-fill)
- **Keep entire message ≤ 160 characters** (single SMS segment — avoids double billing)
- DLT portal may show a higher character count (uses 30-char variable estimate); verify with a real 6-digit OTP sample

### Track approval

1. Content Template list → filter by **Pending / Approved / Disapproved**
2. Click **Template ID** on each approved template
3. Save all 4 **Content Template IDs** (long numeric strings)

---

## Phase 5 — Link Fast2SMS on DLT Portal

1. DLT portal → **Telemarketer / Aggregator linking**
2. Search and link **Fast2SMS**
3. Confirm chain status: **Your Entity → Fast2SMS → Active**

Without active chain, SMS will not deliver even with approved templates.

---

## Phase 6 — Fast2SMS DLT Manager

1. Login: https://www.fast2sms.com
2. Go to **DLT Manager**
3. Add:
   - **Entity ID** (your PE ID from Phase 1)
   - **Sender ID:** `VYBEKT`
   - All **4 approved template texts** (exact copy including `<#>` and hash line)
4. Note each Fast2SMS **message_id** (short ID like `111111`)
   - This is NOT the telecom Content Template ID
5. Ensure wallet has balance for transactional SMS

| OTP Flow | Env var | Fast2SMS message_id |
|----------|---------|---------------------|
| Login | `FAST2SMS_DLT_MSG_ID_LOGIN` | |
| Buyer signup | `FAST2SMS_DLT_MSG_ID_BUYER_SIGNUP` | |
| Seller Partner signup | `FAST2SMS_DLT_MSG_ID_SELLER_SIGNUP` | |
| Forgot password | `FAST2SMS_DLT_MSG_ID_FORGOT_PASSWORD` | |

---

## Phase 7 — Backend Configuration (Render)

Set in Render dashboard:

```env
OTP_ENV=production
FAST2SMS_API_KEY=<your-fast2sms-api-key>
FAST2SMS_ROUTE=dlt
FAST2SMS_SENDER_ID=VYBEKT
ANDROID_SMS_APP_HASH=yXX2EIKmar0

FAST2SMS_DLT_MSG_ID_LOGIN=<message_id>
FAST2SMS_DLT_MSG_ID_BUYER_SIGNUP=<message_id>
FAST2SMS_DLT_MSG_ID_SELLER_SIGNUP=<message_id>
FAST2SMS_DLT_MSG_ID_FORGOT_PASSWORD=<message_id>
```

Deploy backend after setting env vars.

**Note:** DLT route sends only the OTP code as `{#numeric#}`. Hash and `<#>` are static in approved templates.

---

## Phase 8 — Testing

1. Install VybeKart **from Play Store**
2. Test all 4 flows on a real Indian mobile number:
   - Login OTP
   - Buyer signup OTP
   - Seller Partner signup OTP
   - Forgot password OTP
3. Expected SMS format:

   ```
   <#> Your Vybekart login OTP is 482910. Valid for 10 minutes. Do not share this code with anyone.
   yXX2EIKmar0
   ```

4. OTP should **auto-fill** in app (SMS Retriever)
5. If SMS arrives but no auto-fill → verify template ≤ 140 chars, hash line exact, Play Store install
6. Filter logcat `VybekartOtp` — expect `SMS Retriever listener active` then `Auto-sending OTP` before SMS arrives

---

## Master Checklist

- [ ] Entity approved + Entity ID saved
- [ ] Header `VYBEKT` approved
- [ ] App hash obtained: `yXX2EIKmar0`
- [ ] Template 1 — Login OTP approved
- [ ] Template 2 — Buyer Signup OTP approved
- [ ] Template 3 — Seller Partner Signup OTP approved
- [ ] Template 4 — Forgot Password OTP approved
- [ ] All 4 Content Template IDs saved
- [ ] Fast2SMS linked on DLT portal (chain Active)
- [ ] All 4 templates added in Fast2SMS DLT Manager
- [ ] All 4 Fast2SMS message_ids saved
- [ ] Render env vars set + backend deployed
- [ ] OTP tested on Play Store install — auto-fill works

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Header still Pending | Wait before submitting templates |
| Cannot select VYBEKT in template | Header must be Approved first |
| Template rejected | Use `{#numeric#}`, not `{#var#}` |
| SMS not delivered | Check Fast2SMS chain + wallet balance |
| Fast2SMS shows 2 SMS per recipient | Template > 160 chars — shorten (see Template 3) |
| SMS delivered, no auto-fill | Template > 140 chars, hash mismatch, or debug APK (not Play Store) |
| Wrong hash | Re-get from Play Store install + logcat |
| Auto-fill worked on Resend only | Fixed in app: OTP now sent after SMS listener starts |

---

## Reference PDFs

- `Testing/Entity-Header-registration-user-manual.pdf`
- `Testing/Entity-Content-template-registration.pdf`

## Backend files (already implemented)

- `src/notifications/fast2sms.service.ts` — `sendDltSms()`
- `src/auth/auth.service.ts` — DLT routing by OTP purpose
- `src/env.validation.ts` — DLT env vars
- `render.yaml` — `FAST2SMS_ROUTE=dlt`, `FAST2SMS_SENDER_ID=VYBEKT`

## Android files (SMS auto-fill)

- `VybekartAndroid/.../OtpFragment.kt` — starts SMS listener, then auto-sends OTP
- `VybekartAndroid/.../OtpSmsReceiver.kt` — SMS Retriever + User Consent broadcast
- `VybekartAndroid/.../AppSignatureHelper.kt` — logs Play Store hash to logcat (`VybekartOtp`)
