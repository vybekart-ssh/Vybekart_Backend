import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

/** Matches the app's "Resend OTP" countdown, so a normal resend is never blocked. */
export const OTP_SMS_COOLDOWN_SECONDS = 30;
export const OTP_SMS_MAX_PER_HOUR = 5;
export const OTP_SMS_MAX_PER_DAY = 10;

/**
 * Per-number limits on OTP SMS (signup / login / forgot password share them), so nobody can use
 * our endpoints to flood someone's phone. Counts live in Redis with their own expiry.
 */
@Injectable()
export class OtpSmsLimiterService {
  private readonly logger = new Logger(OtpSmsLimiterService.name);

  constructor(private readonly redis: RedisService) {}

  /** Throws 429 when this number may not get another OTP SMS right now. */
  async assertAllowed(phone: string, maskedForLog: string): Promise<void> {
    const number = phone.trim();
    const cooldownKey = `otp:sms:cooldown:${number}`;
    if (!(await this.redis.setNx(cooldownKey, '1', OTP_SMS_COOLDOWN_SECONDS))) {
      const left = await this.redis.ttl(cooldownKey).catch(() => -1);
      const wait = left > 0 ? left : OTP_SMS_COOLDOWN_SECONDS;
      this.logger.warn(`OTP SMS cooldown hit for=${maskedForLog} wait=${wait}s`);
      throw new HttpException(
        `Please wait ${wait} seconds before requesting another OTP.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const windows = [
      { key: `otp:sms:hour:${number}`, ttl: 60 * 60, max: OTP_SMS_MAX_PER_HOUR, label: 'hour' },
      { key: `otp:sms:day:${number}`, ttl: 24 * 60 * 60, max: OTP_SMS_MAX_PER_DAY, label: 'day' },
    ];
    for (const w of windows) {
      const count = await this.redis.incr(w.key);
      if (count === 1) await this.redis.expire(w.key, w.ttl);
      if (count > w.max) {
        this.logger.warn(`OTP SMS ${w.label} limit hit for=${maskedForLog} count=${count}`);
        throw new HttpException(
          w.label === 'hour'
            ? 'Too many OTP requests for this number. Please try again in an hour.'
            : 'Too many OTP requests for this number today. Please try again tomorrow.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }
}
