import { HttpException, HttpStatus } from '@nestjs/common';
import {
  OTP_SMS_COOLDOWN_SECONDS,
  OTP_SMS_MAX_PER_DAY,
  OTP_SMS_MAX_PER_HOUR,
  OtpSmsLimiterService,
} from './otp-sms-limiter.service';

/** In-memory stand-in for the few Redis calls the limiter uses (time is controlled by the test). */
function fakeRedis() {
  let now = 0;
  const store = new Map<string, { value: number; expiresAt: number }>();
  const alive = (k: string) => {
    const e = store.get(k);
    if (e && e.expiresAt <= now) store.delete(k);
    return store.get(k);
  };
  return {
    advance: (seconds: number) => {
      now += seconds;
    },
    setNx: async (k: string, _v: string, ttl: number) => {
      if (alive(k)) return false;
      store.set(k, { value: 1, expiresAt: now + ttl });
      return true;
    },
    ttl: async (k: string) => {
      const e = alive(k);
      return e ? e.expiresAt - now : -2;
    },
    incr: async (k: string) => {
      const e = alive(k);
      const value = (e?.value ?? 0) + 1;
      store.set(k, { value, expiresAt: e?.expiresAt ?? Number.MAX_SAFE_INTEGER });
      return value;
    },
    expire: async (k: string, ttl: number) => {
      const e = store.get(k);
      if (e) e.expiresAt = now + ttl;
    },
  };
}

async function status(p: Promise<unknown>) {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof HttpException ? `${e.getStatus()}: ${String(e.message)}` : String(e);
  }
}

describe('OtpSmsLimiterService', () => {
  const phone = '+919876543210';

  it('blocks a second SMS within the 30 s resend window, then allows it', async () => {
    const redis = fakeRedis();
    const limiter = new OtpSmsLimiterService(redis as never);
    expect(await status(limiter.assertAllowed(phone, 'xx'))).toBe('ok');
    redis.advance(10);
    expect(await status(limiter.assertAllowed(phone, 'xx'))).toBe(
      `${HttpStatus.TOO_MANY_REQUESTS}: Please wait 20 seconds before requesting another OTP.`,
    );
    redis.advance(OTP_SMS_COOLDOWN_SECONDS);
    expect(await status(limiter.assertAllowed(phone, 'xx'))).toBe('ok');
  });

  it(`caps a number at ${OTP_SMS_MAX_PER_HOUR} per hour and ${OTP_SMS_MAX_PER_DAY} per day`, async () => {
    const redis = fakeRedis();
    const limiter = new OtpSmsLimiterService(redis as never);
    for (let i = 0; i < OTP_SMS_MAX_PER_HOUR; i++) {
      expect(await status(limiter.assertAllowed(phone, 'xx'))).toBe('ok');
      redis.advance(OTP_SMS_COOLDOWN_SECONDS);
    }
    expect(await status(limiter.assertAllowed(phone, 'xx'))).toMatch(/^429: Too many OTP requests .* hour/);

    redis.advance(60 * 60);
    // A blocked attempt is refused before it is counted for the day, so 5 more fit (10 total).
    for (let i = 0; i < OTP_SMS_MAX_PER_DAY - OTP_SMS_MAX_PER_HOUR; i++) {
      expect(await status(limiter.assertAllowed(phone, 'xx'))).toBe('ok');
      redis.advance(OTP_SMS_COOLDOWN_SECONDS);
    }
    redis.advance(60 * 60);
    expect(await status(limiter.assertAllowed(phone, 'xx'))).toMatch(/^429: .* today/);
  });

  it('counts each number separately', async () => {
    const redis = fakeRedis();
    const limiter = new OtpSmsLimiterService(redis as never);
    expect(await status(limiter.assertAllowed(phone, 'a'))).toBe('ok');
    expect(await status(limiter.assertAllowed('+919999999999', 'b'))).toBe('ok');
  });
});
