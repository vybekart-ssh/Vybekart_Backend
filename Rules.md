# Vybekart Backend — Rules (Engineering & AI)

> Binding constraints for NestJS work. Product: `PRD.md`. Structure: `Architecture.md`. Email/brand: `design.md`. Roadmap: `phases.md`.

---

## 1. Source of truth

1. Root docs (`PRD.md`, `Architecture.md`, `Rules.md`, `phases.md`, `design.md`) override older narrative docs (`FLOW.md` IVS/Stripe, stale sections of `API.md`).  
2. Update root docs when changing behavior, providers, or phases.  
3. Prisma schema is the data contract — migrate deliberately; never “edit prod DB by hand” as a feature path.

---

## 2. What to use

| Area | Use |
|------|-----|
| HTTP modules | Existing Nest module layout under `src/` |
| DB | Prisma client via `PrismaModule` |
| Auth | Existing JWT/OTP/guards |
| Live | LiveKit modules + `streams` gateway |
| Pay | Razorpay module |
| Ship | Delhivery module |
| Email | `MailService` / Resend helper / shared layout templates |
| SMS | Notifications/Fast2SMS path |
| Push | Firebase Admin wrappers already in notifications |
| Validation | DTO + class-validator; env via Joi |
| Background | `@nestjs/schedule` cron or fire-and-forget async |
| Files | Storage module + media controllers |

---

## 3. What to avoid

| Do not | Why |
|--------|-----|
| Reintroduce Stripe checkout | Unused; Razorpay is production |
| Make IVS primary | LiveKit is production |
| Revive Borzo carrier integration | Legacy field names only |
| Add Bull/BullMQ without phase decision | Ops model is cron/async |
| OAuth/social login drive-by | Not in PRD |
| Bypass guards on admin/seller routes | Security |
| Commit secrets in `README`, `render.yaml`, `.env` | Rotate + secret store |
| Skip `ValidationPipe` DTOs for new endpoints | Consistency |
| Duplicate company legal in random strings | Use `company-info.ts` |
| Invent a second email layout | Use `vybekart-email-layout.ts` |
| Change public URL schemes casually | Breaks Android `MediaUrlResolver` / deep links |
| Put business-critical logic only in scripts | Scripts are ops aids, not source of truth |

---

## 4. API design rules

1. REST under clear module prefixes (`/auth`, `/orders`, `/streams`, …).  
2. Role-protect with existing decorators/guards.  
3. Return Nest-standard errors; messages should be Android-parseable (string or string array).  
4. Prefer idempotent verify/payment callbacks where money moves.  
5. Document new routes in `API.md` + Postman when shipping.  
6. Public routes (`/public/*`, health, webhooks) must stay narrowly scoped and verified (signatures/secrets for webhooks/outreach).

---

## 5. Data & migration rules

1. Add Prisma migrations for schema changes — no “sync” in production.  
2. Preserve backward compatibility for Android versions still in field until force-update.  
3. Enums: extend carefully; never reuse enum values for different meanings.  
4. Soft-legacy columns (e.g. Borzo-named): document mapping; don’t rename without migration plan + app update.

---

## 6. Email / SMS / push rules

1. Production email → Resend when on Render.  
2. OTP production → DLT templates; respect `OTP_ENV`.  
3. Do not log OTP codes in production logs.  
4. Buyer-facing From/Reply patterns: contact vs support vs noreply as already established.  
5. HTML emails: light-safe layout; escape user content (`escapeHtml`).

---

## 7. Error handling rules

1. Use `BadRequest`, `Unauthorized`, `Forbidden`, `NotFound`, `Conflict`, `BadGateway` appropriately.  
2. Upstream failures (LiveKit, Delhivery, Razorpay, Resend) → log + map to safe client messages.  
3. Payment verify failures must not silently mark orders paid.  
4. Keep request IDs for support correlation.

---

## 8. AI agent boundaries

AI **must**:

- Read the five root docs before large backend changes.  
- Match module patterns (module/service/controller/dto).  
- Keep English product strings.  
- Align emails with `design.md` / `VYBE_THEME`.  
- Ask before Phase 3 settlement/refund scope or new vendors.

AI **must not**:

- Implement exploits, credential dumping, or bypass auth “for testing” in committed code.  
- Delete migrations.  
- “Clean up” by removing Razorpay/LiveKit/Delhivery.  
- Expand CORS to `*` with credentials.  
- Store PII in new redis keys without TTL.  
- Rewrite `FLOW.md` instead of updating these root docs.

---

## 9. Security checklist

- [ ] Secrets only via env / Render dashboard  
- [ ] JWT secrets strong and rotated if ever leaked  
- [ ] Webhook/outreach HMAC verified  
- [ ] Upload content-type/size constrained  
- [ ] Admin routes role-locked  
- [ ] Throttling retained on auth/OTP  

---

## 10. Cross-repo coordination

| Backend change | Clients |
|----------------|---------|
| New/changed endpoint | Android Retrofit API + models |
| Force-update min version | Android Play release + AppConfig |
| Brand/legal | Landing `companyInfo.ts` + Android strings if shown |
| Email palette | Keep parity with Android `colors.xml` brand cores |

---

## 11. PR checklist

- [ ] DTO validation + guards  
- [ ] Prisma migrate if schema changed  
- [ ] No secrets committed  
- [ ] Root docs updated if behavior/phase/provider changed  
- [ ] Postman/`API.md` touched for public contract changes  
