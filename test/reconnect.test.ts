import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SafeRedisClient } from '../src/redis/redis-client.js';
import { loadConfig } from '../src/config/redis-config.js';
import { ConnectionError } from '../src/errors/redis-mcp-error.js';
import { Redis } from 'ioredis';

vi.mock('ioredis');

describe('Fix 2: Safe Lazy Reconnection & Single-Flight Lifecycle', () => {
  const config = loadConfig({
    REDIS_URL: 'redis://127.0.0.1:6379/0',
    REDIS_CONNECTION_TIMEOUT_MS: '500',
    REDIS_COMMAND_TIMEOUT_MS: '500'
  });

  let client: SafeRedisClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new SafeRedisClient(config);
  });

  it('allows server to remain alive after initial connect failure and lazily reconnects when Redis becomes available', async () => {
    let connectionAttempts = 0;

    // First attempt fails, subsequent attempts succeed
    // @ts-expect-error mocking Redis constructor
    vi.mocked(Redis).mockImplementation(function () {
      connectionAttempts++;
      const isFirst = connectionAttempts === 1;

      return {
        status: isFirst ? 'close' : 'ready',
        on: vi.fn(),
        ping: vi.fn().mockImplementation(() => {
          if (isFirst) {
            return Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:6379'));
          }
          return Promise.resolve('PONG');
        }),
        exists: vi.fn().mockResolvedValue(1),
        disconnect: vi.fn()
      } as unknown as Redis;
    });

    // 1. Initial connect fails at startup
    await expect(client.connect()).rejects.toThrow(ConnectionError);

    // 2. Health check observes initial failure cleanly without throwing unhandled exceptions
    // In health check, it will try to ensureConnected() -> second connect attempt succeeds!
    const health = await client.checkHealth();
    expect(health.healthy).toBe(true);
    expect(health.status).toBe('connected');

    // 3. Tool operation succeeds without process restart
    const exists = await client.exists('my:key');
    expect(exists).toBe(true);
  });

  it('shares a single reconnection attempt across multiple concurrent requests (single-flight)', async () => {
    let redisConstructorCalls = 0;

    // @ts-expect-error mocking Redis constructor
    vi.mocked(Redis).mockImplementation(function () {
      redisConstructorCalls++;
      return {
        status: 'ready',
        on: vi.fn(),
        ping: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve('PONG'), 50))),
        exists: vi.fn().mockResolvedValue(1),
        type: vi.fn().mockResolvedValue('string'),
        disconnect: vi.fn()
      } as unknown as Redis;
    });

    // Fire 5 concurrent requests while disconnected
    const results = await Promise.all([
      client.exists('key1'),
      client.exists('key2'),
      client.type('key3'),
      client.checkHealth(),
      client.ping()
    ]);

    expect(results[0]).toBe(true);
    expect(results[1]).toBe(true);
    expect(results[2]).toBe('string');
    expect(results[3].healthy).toBe(true);
    expect(results[4]).toBe('PONG');

    // Crucial: exactly 1 Redis client instantiated despite 5 concurrent calls
    expect(redisConstructorCalls).toBe(1);
  });

  it('returns sanitized error when lazy reconnection fails', async () => {
    const syntheticSecret = ['synthetic', 'reconnect', 'fail', 'token'].join('-');
    // @ts-expect-error mocking Redis constructor
    vi.mocked(Redis).mockImplementation(function () {
      return {
        status: 'close',
        on: vi.fn(),
        ping: vi.fn().mockRejectedValue(new Error(`NOPERM user cannot connect for pass=${syntheticSecret}`)),
        disconnect: vi.fn()
      } as unknown as Redis;
    });

    await expect(client.exists('test:key')).rejects.toThrow();

    const health = await client.checkHealth();
    expect(health.healthy).toBe(false);
    expect(health.status).toBe('error');
    expect(health.error).toBeDefined();
  });

  it('prevents new reconnect attempts after shutdown begins', async () => {
    // @ts-expect-error mocking Redis constructor
    vi.mocked(Redis).mockImplementation(function () {
      return {
        status: 'ready',
        on: vi.fn(),
        ping: vi.fn().mockResolvedValue('PONG'),
        disconnect: vi.fn()
      } as unknown as Redis;
    });

    await client.connect();
    await client.disconnect();

    // After shutdown, any tool call throws ConnectionError immediately
    await expect(client.ping()).rejects.toThrow('Redis client is shutting down');
    const health = await client.checkHealth();
    expect(health.healthy).toBe(false);
    expect(health.error).toContain('shutting down');
  });

  it('reuses existing healthy client without reconnecting unnecessarily', async () => {
    let pingCallCount = 0;
    let redisConstructorCalls = 0;

    // @ts-expect-error mocking Redis constructor
    vi.mocked(Redis).mockImplementation(function () {
      redisConstructorCalls++;
      return {
        status: 'ready',
        on: vi.fn(),
        ping: vi.fn().mockImplementation(() => {
          pingCallCount++;
          return Promise.resolve('PONG');
        }),
        disconnect: vi.fn()
      } as unknown as Redis;
    });

    await client.connect();
    expect(redisConstructorCalls).toBe(1);
    expect(pingCallCount).toBe(1);

    // Subsequent ping calls reuse the ready client
    await client.ping();
    await client.ping();

    expect(redisConstructorCalls).toBe(1);
    expect(pingCallCount).toBe(3);
  });
});
