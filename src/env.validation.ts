import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().required().messages({
    'string.empty': 'DATABASE_URL is required',
  }),
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
  // Support: account manager & escalation (optional)
  SUPPORT_ACCOUNT_MANAGER_NAME: Joi.string().optional(),
  SUPPORT_ACCOUNT_MANAGER_PHONE: Joi.string().optional(),
  SUPPORT_ACCOUNT_MANAGER_EMAIL: Joi.string().optional(),
  SUPPORT_ESCALATION_LEVELS_JSON: Joi.string().optional(),
  // Mail (optional – for sending concern emails)
  MAIL_HOST: Joi.string().optional(),
  MAIL_PORT: Joi.number().optional(),
  MAIL_SECURE: Joi.boolean().optional(),
  MAIL_USER: Joi.string().optional(),
  MAIL_PASS: Joi.string().optional(),
  MAIL_FROM: Joi.string().optional(),
});
