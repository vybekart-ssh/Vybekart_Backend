import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/** Safety TTL for live viewer sets (matches max live duration + buffer). */
const STREAM_VIEWER_TTL_SECONDS = 8 * 60 * 60;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    const clientOptions = {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      connectTimeout: 10_000,
      commandTimeout: 5_000,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
    };
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (redisUrl) {
      // Upstash or any Redis URL (rediss:// for TLS)
      this.client = new Redis(redisUrl, clientOptions);
    } else {
      // Local Docker: REDIS_HOST + REDIS_PORT
      const host = this.config.get<string>('REDIS_HOST', 'localhost');
      const port = this.config.get<number>('REDIS_PORT', 6379);
      this.client = new Redis({ host, port, ...clientOptions });
    }
  }

  onModuleDestroy() {
    this.client?.disconnect();
  }

  getClient(): Redis {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  /** SET key NX with TTL. Returns true if the key was set (first time). */
  async setNx(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const r = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return r === 'OK';
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async decr(key: string): Promise<number> {
    return this.client.decr(key);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    return this.client.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    return this.client.srem(key, ...members);
  }

  async scard(key: string): Promise<number> {
    return this.client.scard(key);
  }

  async smembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  /** Key for stream viewer count: stream:viewers:{streamId} -> set of socket ids */
  streamViewersKey(streamId: string): string {
    return `stream:viewers:${streamId}`;
  }

  streamLikesKey(streamId: string): string {
    return `stream:${streamId}:likes`;
  }

  streamCommentsKey(streamId: string): string {
    return `stream:${streamId}:comments`;
  }

  streamBidsKey(streamId: string): string {
    return `stream:${streamId}:bids`;
  }

  /** Drop ephemeral per-stream cache after live ends (engagement + socket viewers). */
  async clearStreamEphemeralKeys(streamId: string): Promise<void> {
    await this.client.del(
      this.streamLikesKey(streamId),
      this.streamCommentsKey(streamId),
      this.streamBidsKey(streamId),
      this.streamViewersKey(streamId),
    );
  }

  /** Pipelined sadd + expire + scard for viewer join. */
  async trackViewerJoin(streamId: string, socketId: string): Promise<number> {
    const key = this.streamViewersKey(streamId);
    const results = await this.client
      .pipeline()
      .sadd(key, socketId)
      .expire(key, STREAM_VIEWER_TTL_SECONDS)
      .scard(key)
      .exec();
    return (results?.[2]?.[1] as number) ?? 0;
  }

  /** Pipelined srem + scard for viewer leave. */
  async trackViewerLeave(streamId: string, socketId: string): Promise<number> {
    const key = this.streamViewersKey(streamId);
    const results = await this.client
      .pipeline()
      .srem(key, socketId)
      .scard(key)
      .exec();
    return (results?.[1]?.[1] as number) ?? 0;
  }

  /** Buyers with a cart tied to a stream (for post-live TTL refresh). */
  streamCartHoldersKey(streamId: string): string {
    return `orders:stream-carts:${streamId}`;
  }

  /** Key for refresh token: refresh:{tokenId} -> userId, ttl */
  refreshTokenKey(tokenId: string): string {
    return `refresh:${tokenId}`;
  }

  /** Key for OTP: otp:{identifier} -> code, ttl (identifier = email or phone) */
  otpKey(identifier: string): string {
    return `otp:${identifier}`;
  }
}
