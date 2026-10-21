import fs from 'node:fs';
import { Redis, type RedisOptions } from 'ioredis';
import type { ServerConfig } from '../config/redis-config.js';
import { getSanitizedTarget } from '../config/redis-config.js';
import {
  ConnectionError,
  TimeoutError,
  PermissionDeniedError,
  TlsError
} from '../errors/redis-mcp-error.js';
import { formatSafeKeyLabel } from '../utils/key-codec.js';

export interface RedisHealthStatus {
  healthy: boolean;
  status: 'connected' | 'connecting' | 'reconnecting' | 'disconnected' | 'error';
  latencyMs?: number;
  target: {
    host: string;
    port: number;
    db: number;
    isTls: boolean;
  };
  error?: string;
}

export class SafeRedisClient {
  private client: Redis | null = null;
  private readonly config: ServerConfig;
  private connectionPromise: Promise<void> | null = null;
  private isShuttingDown = false;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  /**
   * Initializes or reconnects to Redis and validates connectivity with PING using single-flight deduplication.
   */
  public async connect(): Promise<void> {
    if (this.isShuttingDown) {
      throw new ConnectionError('Redis client is shutting down');
    }

    if (this.client && (this.client.status === 'ready' || this.client.status === 'connect')) {
      return;
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this.doConnect();
    try {
      await this.connectionPromise;
    } finally {
      this.connectionPromise = null;
    }
  }

  private async doConnect(): Promise<void> {
    if (this.isShuttingDown) {
      throw new ConnectionError('Redis client is shutting down');
    }

    try {
      if (!this.client || this.client.status === 'end' || this.client.status === 'close') {
        if (this.client) {
          try {
            this.client.disconnect();
          } catch {
            // ignore cleanup errors
          }
          this.client = null;
        }

        const options = this.buildRedisOptions();
        this.client = new Redis(this.config.redisUrl, options);

        // Setup event handlers for connection lifecycle diagnostics (to stderr)
        this.client.on('error', (err: Error) => {
          console.error('[RedisClient] Connection error:', err.message);
        });

        this.client.on('reconnecting', (time?: number) => {
          console.error(`[RedisClient] Reconnecting in ${time ?? 0}ms...`);
        });
      }

      // Validate connection with initial ping
      await this.withTimeout(this.client.ping(), this.config.connectionTimeoutMs);
    } catch (error) {
      if (this.client) {
        try {
          this.client.disconnect();
        } catch {
          // ignore
        }
        this.client = null;
      }
      throw this.wrapError(error, 'Failed to connect to Redis');
    }
  }

  /**
   * Disconnects the Redis client gracefully.
   */
  public async disconnect(): Promise<void> {
    this.isShuttingDown = true;

    if (this.connectionPromise) {
      try {
        await this.connectionPromise;
      } catch {
        // ignore in shutdown
      }
    }

    if (!this.client) {
      return;
    }

    try {
      this.client.disconnect();
    } catch (err) {
      console.error('[RedisClient] Error during disconnect:', err);
    } finally {
      this.client = null;
    }
  }

  /**
   * Checks the health of the Redis connection, lazily reconnecting if needed.
   */
  public async checkHealth(): Promise<RedisHealthStatus> {
    const target = getSanitizedTarget(this.config.redisUrl);

    if (this.isShuttingDown) {
      return {
        healthy: false,
        status: 'disconnected',
        target,
        error: 'Redis client is shutting down'
      };
    }

    const start = Date.now();
    try {
      const redis = await this.ensureConnected();
      await this.withTimeout(redis.ping(), Math.min(this.config.commandTimeoutMs, 2000));
      const latencyMs = Date.now() - start;
      return {
        healthy: true,
        status: 'connected',
        latencyMs,
        target
      };
    } catch (error) {
      return {
        healthy: false,
        status: 'error',
        target,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  // --- Strict Read-Only Redis Operations ---

  public async ping(): Promise<string> {
    const redis = await this.ensureConnected();
    return this.withTimeout(redis.ping(), this.config.commandTimeoutMs);
  }

  public async exists(key: string | Buffer): Promise<boolean> {
    const redis = await this.ensureConnected();
    const count = await this.withTimeout(redis.exists(key), this.config.commandTimeoutMs);
    return count > 0;
  }

  public async type(key: string | Buffer): Promise<string> {
    const redis = await this.ensureConnected();
    return this.withTimeout(redis.type(key), this.config.commandTimeoutMs);
  }

  public async ttl(key: string | Buffer): Promise<number> {
    const redis = await this.ensureConnected();
    return this.withTimeout(redis.ttl(key), this.config.commandTimeoutMs);
  }

  public async pttl(key: string | Buffer): Promise<number> {
    const redis = await this.ensureConnected();
    return this.withTimeout(redis.pttl(key), this.config.commandTimeoutMs);
  }

  public async memoryUsage(key: string | Buffer, samples?: number): Promise<number | null> {
    const redis = await this.ensureConnected();
    try {
      if (samples !== undefined && samples > 0) {
        // MEMORY USAGE key SAMPLES count
        return await this.withTimeout(
          redis.memory('USAGE', key as unknown as string, 'SAMPLES', samples) as Promise<number | null>,
          this.config.commandTimeoutMs
        );
      }
      return await this.withTimeout(
        redis.memory('USAGE', key as unknown as string) as Promise<number | null>,
        this.config.commandTimeoutMs
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/unknown command|disabled|NOPERM/i.test(msg)) {
        return null; // Gracefully handle memory usage command restriction
      }
      throw this.wrapError(error, `Failed to get memory usage for key ${formatSafeKeyLabel(key)}`);
    }
  }

  public async objectEncoding(key: string | Buffer): Promise<string | null> {
    const redis = await this.ensureConnected();
    try {
      const res = await this.withTimeout(
        redis.object('ENCODING', key as unknown as string) as Promise<string | null>,
        this.config.commandTimeoutMs
      );
      return res;
    } catch {
      return null;
    }
  }

  public async scan(cursor: string, pattern: string, count: number): Promise<[string, string[]]> {
    const redis = await this.ensureConnected();
    return this.withTimeout(redis.scan(cursor, 'MATCH', pattern, 'COUNT', count), this.config.commandTimeoutMs);
  }

  public async scanBuffer(cursor: string, pattern: string, count: number): Promise<[string, Buffer[]]> {
    const redis = await this.ensureConnected();
    const [nextCursorBuf, keys] = await this.withTimeout(
      redis.scanBuffer(cursor, 'MATCH', pattern, 'COUNT', count),
      this.config.commandTimeoutMs
    );
    return [nextCursorBuf.toString('utf-8'), keys];
  }

  public async get(key: string | Buffer): Promise<string | null> {
    const redis = await this.ensureConnected();
    return this.withTimeout(redis.get(key), this.config.commandTimeoutMs);
  }

  public async getBuffer(key: string | Buffer): Promise<Buffer | null> {
    const redis = await this.ensureConnected();
    return this.withTimeout(redis.getBuffer(key), this.config.commandTimeoutMs);
  }

  public async strlen(key: string | Buffer): Promise<number> {
    const redis = await this.ensureConnected();
    return this.withTimeout(redis.strlen(key), this.config.commandTimeoutMs);
  }

  public async hlen(key: string | Buffer): Promise<number> {
    const redis = await this.ensureConnected();
    return this.withTimeout(redis.hlen(key), this.config.commandTimeoutMs);
  }

  public async hscan(key: string | Buffer, cursor: string, count: number): Promise<[string, string[]]> {
    const redis = await this.ensureConnected();
    return this.withTimeout(redis.hscan(key, cursor, 'COUNT', count), this.config.commandTimeoutMs);
  }

  public async llen(key: string | Buffer): Promise<number> {
    const redis = await this.ensureConnected();
    return this.withTimeout(redis.llen(key), this.config.commandTimeoutMs);
  }

  public async lrange(key: string | Buffer, start: number, stop: number): Promise<string[]> {
    const redis = await this.ensureConnected();
    return this.withTimeout(redis.lrange(key, start, stop), this.config.commandTimeoutMs);
  }

  public async scard(key: string | Buffer): Promise<number> {
    const redis = await this.ensureConnected();
    return this.withTimeout(redis.scard(key), this.config.commandTimeoutMs);
  }

  public async sscan(key: string | Buffer, cursor: string, count: number): Promise<[string, string[]]> {
    const redis = await this.ensureConnected();
    return this.withTimeout(redis.sscan(key, cursor, 'COUNT', count), this.config.commandTimeoutMs);
  }

  public async zcard(key: string | Buffer): Promise<number> {
    const redis = await this.ensureConnected();
    return this.withTimeout(redis.zcard(key), this.config.commandTimeoutMs);
  }

  public async zscan(key: string | Buffer, cursor: string, count: number): Promise<[string, string[]]> {
    const redis = await this.ensureConnected();
    return this.withTimeout(redis.zscan(key, cursor, 'COUNT', count), this.config.commandTimeoutMs);
  }

  public async zrangeWithScores(
    key: string | Buffer,
    start: number,
    stop: number
  ): Promise<Array<{ member: string; score: number }>> {
    const redis = await this.ensureConnected();
    const raw = await this.withTimeout(
      redis.zrange(key, start, stop, 'WITHSCORES'),
      this.config.commandTimeoutMs
    );

    const result: Array<{ member: string; score: number }> = [];
    for (let i = 0; i < raw.length; i += 2) {
      const member = raw[i];
      const scoreStr = raw[i + 1];
      if (member !== undefined && scoreStr !== undefined) {
        result.push({
          member,
          score: parseFloat(scoreStr)
        });
      }
    }
    return result;
  }

  public async info(section: string): Promise<string> {
    const redis = await this.ensureConnected();
    return this.withTimeout(redis.info(section), this.config.commandTimeoutMs);
  }

  // --- Helpers ---

  private async ensureConnected(): Promise<Redis> {
    if (this.isShuttingDown) {
      throw new ConnectionError('Redis client is shutting down');
    }

    if (!this.client || this.client.status === 'end' || this.client.status === 'close') {
      await this.connect();
    }

    if (!this.client) {
      throw new ConnectionError('Redis client is not connected.');
    }

    return this.client;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new TimeoutError(`Redis command timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private buildRedisOptions(): RedisOptions {
    const options: RedisOptions = {
      connectTimeout: this.config.connectionTimeoutMs,
      commandTimeout: this.config.commandTimeoutMs,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        if (times > 5) {
          return null; // Stop retrying after 5 attempts
        }
        return Math.min(times * 200, 2000); // Backoff up to 2 seconds
      }
    };

    if (this.config.redisUrl.startsWith('rediss://')) {
      const tlsOptions: Record<string, unknown> = {
        rejectUnauthorized: this.config.tlsRejectUnauthorized
      };

      if (this.config.tlsCaPath) {
        try {
          tlsOptions['ca'] = fs.readFileSync(this.config.tlsCaPath);
        } catch (err) {
          throw new TlsError(`Failed to read TLS CA certificate: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (this.config.tlsCertPath) {
        try {
          tlsOptions['cert'] = fs.readFileSync(this.config.tlsCertPath);
        } catch (err) {
          throw new TlsError(`Failed to read TLS client certificate: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (this.config.tlsKeyPath) {
        try {
          tlsOptions['key'] = fs.readFileSync(this.config.tlsKeyPath);
        } catch (err) {
          throw new TlsError(`Failed to read TLS client key: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      options.tls = tlsOptions;
    }

    return options;
  }

  private wrapError(error: unknown, fallbackMessage: string): Error {
    if (error instanceof Error) {
      const msg = error.message;
      if (/NOPERM|NOAUTH|WRONGPASS/i.test(msg)) {
        return new PermissionDeniedError(msg);
      }
      if (/timeout/i.test(msg)) {
        return new TimeoutError(msg);
      }
      if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(msg)) {
        return new ConnectionError(msg);
      }
      if (/CERT_|DEPTH_ZERO_SELF_SIGNED|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(msg)) {
        return new TlsError(msg);
      }
      return error;
    }
    return new ConnectionError(`${fallbackMessage}: ${String(error)}`);
  }
}
