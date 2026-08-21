# Vybekart Backend — Product Requirements Document (PRD)

> **Source of truth** for API product requirements.  
> Companions: `Architecture.md`, `Rules.md`, `phases.md`, `design.md`.  
> Clients: Android (`com.vybekart.app`), marketing site (`vybekart.co.in`).

| Field | Value |
|-------|--------|
| **Product** | Vybekart API / platform services |
| **Repo** | `Vybekart_Backend` |
| **Status** | Production (serves Play Store app) |
| **Language of product UX copy** | English |
| **Legal operator** | LIVORA RETAIL — `src/company/company-info.ts` |
| **Public API host** | `https://vybekart-backend.onrender.com` |

---

## 1. Vision

Provide a secure, India-ready **live-commerce backend**: identity, catalog, LiveKit streaming, cart/checkout (Razorpay), logistics (Delhivery), trust (ratings/replacements), notifications (FCM/SMS/email), admin ops, and public config for the Android app.

---

## 2. Targeted consumers of the API

| Consumer | Needs |
|----------|--------|
| **Android buyers** | Feed, live tokens, cart, orders, replacements, profile, follow |
| **Android sellers** | KYC profile, products, streams, fulfillment, dashboard metrics, payout preview |
| **Android admins** | Seller verification, users, packing videos, replacements, app config |
| **Ops / cron** | Daily reports, DB backup email, live reminders, cart expiry, storage cleanup |
| **Marketing / outreach** | Seller interest signed links, welcome/order emails, seller bulk email tools |
| **Public** | `/public/android-app`, seller-outreach interest page, health |

Landing Next.js apps generally **do not** call commerce APIs (except shared legal content conceptually); they use their own SMTP for legacy pre-reg.

---

## 3. Core capabilities (requirements)

### 3.1 Identity & access

- Register buyer / seller; login; refresh tokens (Redis-backed).  
- Phone/email OTP (`OTP_ENV=testing|production`); production SMS via Fast2SMS DLT.  
- JWT access + role guards (`BUYER`, `SELLER`, `ADMIN`); seller verified guard for sensitive seller routes.  
- FCM device token registration.  
- Forgot/reset password via OTP.

### 3.2 Catalog & reference

- Categories, material types, countries/states.  
- Seller product CRUD with variants JSON, GST/HSN, logistics fields, statuses.

### 3.3 Live streaming

- Create/schedule/start/stop streams; attach ≤ product set used by app.  
- LiveKit rooms + viewer tokens; optional egress → storage for replay.  
- Socket.IO gateway `/streams` (chat, likes, viewer count, events).  
- Post-live cart eligibility **24 hours** after stream end.  
- Live qualification days for commission reward (Phase 2 rules).

### 3.4 Commerce

- Cart CRUD; delivery quote; checkout.  
- Razorpay order create + verify; replacement balance payments.  
- Orders lifecycle: accept → packing video → request delivery → ship/deliver/cancel.  
- Invoices PDF (PDFKit).  
- Failed placement after capture → refund audit path (`PaymentCheckoutFailure`).

### 3.5 Logistics

- Delhivery Express integration (production path).  
- Mock delivery only for local/dev-style paths — not a second product.  
- Legacy Borzo-named DB columns may store tracking URLs/status — do not revive Borzo as a carrier without PRD change.

### 3.6 Trust (Phase 2)

- Replacements (not money-back returns): submit window, auto-approve vs admin, seller fulfillment, emails.  
- Buyer & seller ratings + admin overrides + penalty rules.  
- Follow graph (live-oriented product rules).  
- Admin users directory APIs.

### 3.7 Communications

| Channel | Provider | Use |
|---------|----------|-----|
| Email | **Resend** (preferred on Render) or SMTP Nodemailer | Welcome, orders, support, reports, seller outreach |
| SMS | Fast2SMS DLT | OTP |
| Push | Firebase Admin | Order/live/ops notifications |

From-address roles: noreply / contact / support / seller outreach (CEO) — see Architecture env map.

### 3.8 Admin & public

- Seller approve/reject/request-changes/reregister.  
- App config min Android version.  
- Packing video review.  
- Seller email campaign admin UI/API.  
- Health endpoints.  
- LiveKit webhooks.

### 3.9 Company / legal

- Single source `VYBEKART_COMPANY_INFO` with optional env overrides.  
- Must stay aligned with landing `/legal` and invoices/emails.

---

## 4. Out of scope (until phases/PRD update)

- Full automated settlement/payout engine (Phase 3).  
- Money-back returns / unrestricted refunds as buyer self-serve (Phase 3 decision).  
- Stripe (dependency may exist unused — do not implement Stripe flows).  
- AWS IVS as primary live stack (legacy docs only; LiveKit is production).  
- OAuth/social login.  
- Bull/BullMQ job platform (use cron + async unless phases change).  
- Making Landing a full commerce client.

---

## 5. Business rules (authoritative highlights)

| Topic | Rule |
|-------|------|
| Live reward | 10 qualified days / rolling 30 (IST); day = ≥30 min live |
| Replacement submit | Within 3 days of `deliveredAt` (buyer-facing policy copy may say 7 days — keep copy consistent with product) |
| Auto-approve replacement | Customer rating ≥ 3; else admin |
| Seller penalty | 5 replacements / 30 days → notify + rating −2 (min 0) |
| Buyer penalty | 3 replacements / 90 days → email + rating −2 (min 0) |
| New buyer rating | Starts at 5.0 until history |
| Currency / geo | India; +91 phones; GST on sellers |

Detail tables: historical `Testing/Phase2.md` — if conflict with this PRD, **update both**.

---

## 6. Non-functional requirements

| Area | Requirement |
|------|-------------|
| Validation | Global `ValidationPipe` (whitelist, forbid non-whitelisted) |
| Security | Helmet, throttling, JWT secrets, no plaintext secrets in git going forward |
| Config | Joi `env.validation.ts`; `.env.local` / `.env` |
| Observability | Request ID middleware; structured logs; health checks |
| Deploy | Docker on Render; Prisma migrate on start |
| DB | PostgreSQL (Supabase pooler in prod) + Redis |

---

## 7. Success metrics

- Auth success + OTP deliverability (prod DLT).  
- Checkout verify → order persistence rate.  
- LiveKit session success / egress replay rate.  
- Delhivery create/track success.  
- Email delivery via Resend.  
- Zero committed production secrets; rotated credentials.

---

## 8. Document ownership

API behavior changes → update this PRD + `Architecture.md` (+ Postman when endpoints change).  
Email visual → `design.md`.  
Roadmap → `phases.md`.  
AI/engineering limits → `Rules.md`.
