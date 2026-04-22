import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
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
  /** JSON string of Firebase service account (FCM server). Optional — push disabled if unset. */
  FIREBASE_SERVICE_ACCOUNT_JSON: Joi.string().optional(),

  // Scheduled reports
  DAILY_USERS_REPORT_ENABLED: Joi.string()
    .valid('true', 'false', '1', '0')
    .default('true'),
  DAILY_USERS_REPORT_TO: Joi.string().email().optional(),

  // Borzo Business API (India)
  BORZO_ENV: Joi.string().valid('test', 'prod').default('test'),
  BORZO_AUTH_TOKEN_TEST: Joi.string().optional(),
  BORZO_AUTH_TOKEN_PROD: Joi.string().optional(),
});
