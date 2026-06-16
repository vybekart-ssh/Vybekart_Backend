import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  /**
   * OTP behavior switch:
   * - testing: allow static bypass + log OTPs
   * - production: disallow bypass + send SMS + log OTPs (per requirement)
   */
  OTP_ENV: Joi.string()
    .valid('testing', 'production')
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().default('production'),
      otherwise: Joi.string().default('testing'),
    }),
  /** Android SMS Retriever app hash (11 chars) appended to OTP SMS when set. */
  ANDROID_SMS_APP_HASH: Joi.string().optional(),
  /** Fast2SMS API key (required when OTP_ENV=production and sending SMS). */
  FAST2SMS_API_KEY: Joi.string().optional(),
  /** Fast2SMS route (e.g. q, otp, dlt). */
  FAST2SMS_ROUTE: Joi.string().default('q'),
  /** DLT-approved 6-letter sender header (e.g. VYBEKT). Required when FAST2SMS_ROUTE=dlt. */
  FAST2SMS_SENDER_ID: Joi.string().optional(),
  /** Fast2SMS DLT Manager message_id per OTP purpose (not telecom template_id). */
  FAST2SMS_DLT_MSG_ID_LOGIN: Joi.string().optional(),
  FAST2SMS_DLT_MSG_ID_BUYER_SIGNUP: Joi.string().optional(),
  FAST2SMS_DLT_MSG_ID_SELLER_SIGNUP: Joi.string().optional(),
  FAST2SMS_DLT_MSG_ID_FORGOT_PASSWORD: Joi.string().optional(),
  /** Fast2SMS endpoint override (defaults to bulkV2). */
  FAST2SMS_ENDPOINT: Joi.string()
    .uri()
    .default('https://www.fast2sms.com/dev/bulkV2'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().required().messages({
    'string.empty': 'DATABASE_URL is required',
  }),
  /** Supabase session pooler / migrations URL (see prisma/schema.prisma directUrl) */
  DIRECT_URL: Joi.string().optional(),
  JWT_SECRET: Joi.string().required().min(16).messages({
    'string.empty': 'JWT_SECRET is required',
    'string.min': 'JWT_SECRET must be at least 16 characters',
  }),
  JWT_REFRESH_SECRET: Joi.string().optional().min(16),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),
  REDIS_URL: Joi.string().optional(),
  REDIS_HOST: Joi.string().optional(),
  REDIS_PORT: Joi.number().optional(),
  CORS_ORIGIN: Joi.string().optional(),
  USE_REAL_IVS: Joi.string().valid('true', 'false').default('false'),
  AWS_REGION: Joi.string().optional(),
  AWS_ACCESS_KEY_ID: Joi.string().optional(),
  AWS_SECRET_ACCESS_KEY: Joi.string().optional(),
  // LiveKit (primary streaming provider)
  LIVEKIT_URL: Joi.string().uri().optional(),
  LIVEKIT_API_KEY: Joi.string().optional(),
  LIVEKIT_API_SECRET: Joi.string().optional(),
  /** Same project URL as uploads (used to derive Storage S3 endpoint when recording to Supabase). */
  SUPABASE_URL: Joi.string().uri().optional(),
  /** Server-side key for Storage API (uploads + cleanup). Set in Render dashboard only. */
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().optional(),
  /** Public bucket name for images/uploads (defaults to SUPABASE_PUBLIC_BUCKET). */
  SUPABASE_PUBLIC_BUCKET: Joi.string().optional(),
  CLEANUP_REPLAYS_ENABLED: Joi.string().valid('true', 'false', '1', '0').optional(),
  /** When true, use Supabase Storage S3 API + public object URLs for replays. */
  LIVEKIT_RECORDING_USE_SUPABASE: Joi.string().valid('true', 'false', '1', '0').optional(),
  LIVEKIT_RECORDING_S3_BUCKET: Joi.string().optional(),
  LIVEKIT_RECORDING_S3_REGION: Joi.string().optional(),
  LIVEKIT_RECORDING_S3_ACCESS_KEY: Joi.string().optional(),
  LIVEKIT_RECORDING_S3_SECRET: Joi.string().optional(),
  LIVEKIT_RECORDING_S3_ENDPOINT: Joi.string().optional(),
  LIVEKIT_RECORDING_S3_FORCE_PATH_STYLE: Joi.string()
    .valid('true', 'false', '1', '0')
    .optional(),
  LIVEKIT_WEBHOOK_SKIP_VERIFY: Joi.string().valid('true', 'false', '1', '0').optional(),
  // Support: account manager & escalation (optional)
  SUPPORT_ACCOUNT_MANAGER_NAME: Joi.string().optional(),
  SUPPORT_ACCOUNT_MANAGER_PHONE: Joi.string().optional(),
  SUPPORT_ACCOUNT_MANAGER_EMAIL: Joi.string().optional(),
  SUPPORT_ESCALATION_LEVELS_JSON: Joi.string().optional(),
  // Mail (optional – for sending concern emails)
  // Prefer RESEND_API_KEY on Render (free tier blocks SMTP). Else use MAIL_* SMTP.
  RESEND_API_KEY: Joi.string().optional(),
  MAIL_HOST: Joi.string().optional(),
  MAIL_PORT: Joi.number().optional(),
  MAIL_SECURE: Joi.boolean().optional(),
  MAIL_USER: Joi.string().optional(),
  MAIL_PASS: Joi.string().optional(),
  MAIL_FROM: Joi.string().optional(),
  /** From address for order confirmations (buyer + seller). */
  NOREPLY_EMAIL: Joi.string().email().optional(),
  SUPPORT_EMAIL: Joi.string().email().optional(),
  CONTACT_EMAIL: Joi.string().email().optional(),
  /** Public logo URL for HTML emails (optional). */
  ALPHA_LOGO_URL: Joi.string().uri().optional(),
  ALPHA_WEBSITE_URL: Joi.string().uri().optional(),
  ALPHA_COMPANY_LEGAL_NAME: Joi.string().optional(),
  VYBEKART_TRADE_NAME: Joi.string().optional(),
  VYBEKART_LEGAL_NAME: Joi.string().optional(),
  VYBEKART_PLATFORM_BRAND: Joi.string().optional(),
  VYBEKART_PAN: Joi.string().optional(),
  VYBEKART_CONTACT_EMAIL: Joi.string().optional(),
  VYBEKART_REGISTERED_OFFICE: Joi.string().optional(),
  VYBEKART_PLATFORM_GSTIN: Joi.string().optional(),
  RESEND_INSECURE_TLS: Joi.string().valid('true', 'false', '1', '0').optional(),
  SELLER_OUTREACH_INTEREST_SECRET: Joi.string().optional(),
  CEO_NAME: Joi.string().optional(),
  CEO_EMAIL: Joi.string().email().optional(),
  CEO_PHONE: Joi.string().optional(),
  SELLER_OUTREACH_FROM: Joi.string().optional(),
  SELLER_OUTREACH_INTEREST_TO: Joi.string().email().optional(),
  APP_DOWNLOAD_URL: Joi.string().uri().optional(),
  SELLER_EMAIL_SEND_DELAY_MS: Joi.string().optional(),
  SELLER_INTRO_IMAGE_URL: Joi.string().uri().optional(),
  SELLER_STEPS_IMAGE_URL: Joi.string().uri().optional(),
  /** JSON string of Firebase service account (FCM server). Optional — push disabled if unset. */
  FIREBASE_SERVICE_ACCOUNT_JSON: Joi.string().optional(),

  // Scheduled reports
  DAILY_USERS_REPORT_ENABLED: Joi.string()
    .valid('true', 'false', '1', '0')
    .default('true'),
  DAILY_USERS_REPORT_TO: Joi.string().email().optional(),

  // Daily DB backup (email attachment)
  DAILY_DB_BACKUP_ENABLED: Joi.string()
    .valid('true', 'false', '1', '0')
    .default('true'),
  DAILY_DB_BACKUP_TO: Joi.string().email().optional(),

  // Delhivery express / same-day (India)
  DELHIVERY_ENV: Joi.string().valid('staging', 'prod').default('staging'),
  DELHIVERY_API_TOKEN_STAGING: Joi.string().optional(),
  DELHIVERY_API_TOKEN_PROD: Joi.string().optional(),
  DELHIVERY_CLIENT_NAME: Joi.string().optional(),
  /** Registered warehouse / pickup location name in Delhivery */
  DELHIVERY_PICKUP_LOCATION: Joi.string().optional(),

  // Razorpay (buyer checkout)
  RAZORPAY_KEY_ID: Joi.string().optional(),
  RAZORPAY_KEY_SECRET: Joi.string().optional(),
  /** When true, allow PATCH /orders/checkout without Razorpay (local/dev only). */
  PAYMENTS_ALLOW_DIRECT_CHECKOUT: Joi.string()
    .valid('true', 'false', '1', '0')
    .optional(),
});
