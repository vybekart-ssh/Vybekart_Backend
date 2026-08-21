# Vybekart Backend — Phases

> Keep synchronized with `VybekartAndroid/phases.md`.  
> App is live; phases are capability waves.

---

## Phase 0 — Platform foundation (Done)

- NestJS + Prisma + Postgres + Redis  
- JWT auth, role guards  
- Render Docker deploy + health  
- Config validation (Joi)  

---

## Phase 1 — Live commerce core (Done)

| Capability | Status |
|------------|--------|
| Buyer/seller registration + OTP | Done |
| Products + categories + reference data | Done |
| LiveKit streams + Socket.IO gateway | Done |
| Cart + Razorpay + orders | Done |
| Delhivery fulfillment path | Done |
| Media uploads / Supabase storage | Done |
| FCM + transactional email/SMS wiring | Done |
| Admin seller KYC | Done |
| Public Android app config | Done |
| Invoices PDF (initial) | Done |

---

## Phase 2 — Trust & engagement (Done / monitor)

Per `Testing/Phase2.md` (historical target 14 May 2026):

| Module | Status |
|--------|--------|
| Live-stream reward qualification | Done |
| Replacements pipeline | Done |
| Seller & customer ratings + overrides | Done |
| Follow graph | Done |
| Post-live 24h cart | Done |
| Admin users APIs | Done |

**Monitor / harden:**

- `OTP_ENV` must be `production` with DLT when SMS is customer-facing live  
- Email deliverability (Resend domain/DNS)  
- Replacement edge cases + penalty crons/notifications  
- Doc drift: retire IVS/Stripe language from any remaining guides  

---

## Phase 3 — Settlement, refunds & financial depth (Next)

| Item | Notes |
|------|-------|
| Seller settlement / payout automation | Beyond payout **preview** calculator |
| Commission engine as ledger | Live reward currently waiver-oriented — expand carefully |
| Money-back returns / refunds | Explicit product decision; legacy `return` route not the design |
| Stronger invoicing (tax completeness) | Build on PDFKit invoices |
| Payment failure / refund ops tooling | Expand `PaymentCheckoutFailure` workflows |
| Durable job queue (optional) | Only if cron/async proves insufficient |

Android must ship matching UX — update both `phases.md` files together.

---

## Phase 4 — Scale & platform (Later)

- CI (lint/test/migrate check) on PRs  
- Staging environment + separate Render service  
- Remove unused Stripe dependency  
- Delete empty `borzo` module after column rename strategy  
- Rate-limit/abuse refinements  
- Optional web admin (beyond seller-emails HTML) — product decision  
- Observability (APM, better metrics)  

---

## Explicit non-goals until scheduled

- Social OAuth  
- Multi-country tax engines  
- Replacing LiveKit with IVS  
- Making Landing a checkout client  

---

## Exit criteria

| Phase | Exit |
|-------|------|
| 1 | Production live buy + ship path stable |
| 2 | Trust modules used in production without critical defects |
| 3 | Settlement/refund rules implemented end-to-end with audit trail |
| 4 | CI + staging + dependency cleanup complete |

---

## Working agreement

1. Do not implement Phase 3 money movement without `PRD.md` + both phases files updated.  
2. Prefer feature flags/env for risky rollouts (`OTP_ENV`, Delhivery mock).  
3. Mark Done only when production-ready, not when scaffolded.
