import { describe, it, expect } from 'vitest';
import { loadConfig, sanitizeRedisUrl, getSanitizedTarget } from '../src/config/redis-config.js';
import { ConfigurationError } from '../src/errors/redis-mcp-error.js';

describe('Configuration & URL Sanitization', () => {
  it('loads valid default configuration', () => {
    const config = loadConfig({
      REDIS_URL: 'redis://127.0.0.1:6379/0'
    });

    expect(config.redisUrl).toBe('redis://127.0.0.1:6379/0');
    expect(config.mcpPort).toBe(3000);
    expect(config.mcpHost).toBe('127.0.0.1');
    expect(config.connectionTimeoutMs).toBe(5000);
    expect(config.commandTimeoutMs).toBe(3000);
    expect(config.maxScanCount).toBe(100);
    expect(config.maxResults).toBe(100);
    expect(config.maxValueBytes).toBe(65536);
    expect(config.metadataEnabled).toBe(true);
    expect(config.metadataLevel).toBe('standard');
  });

  it('rejects invalid Redis URL scheme', () => {
    expect(() => {
      loadConfig({
        REDIS_URL: 'http://localhost:6379'
      });
    }).toThrow(ConfigurationError);
  });

  it('rejects out-of-range numeric limits', () => {
    expect(() => {
      loadConfig({
        REDIS_URL: 'redis://localhost:6379',
        REDIS_MAX_RESULTS: '0'
      });
    }).toThrow(ConfigurationError);

    expect(() => {
      loadConfig({
        REDIS_URL: 'redis://localhost:6379',
        REDIS_COMMAND_TIMEOUT_MS: '50'
      });
    }).toThrow(ConfigurationError);
  });

  it('sanitizes Redis URLs containing passwords', () => {
    const syntheticSecret = ['synthetic', 'credential', 'fixture', '1'].join('-');
    const rawUrl = `redis://appuser:${syntheticSecret}@redis.example.test:6380/2`;
    const sanitized = sanitizeRedisUrl(rawUrl);

    expect(sanitized).not.toContain(syntheticSecret);
    expect(sanitized).toBe('redis://appuser:***@redis.example.test:6380/2');
  });

  it('sanitizes Redis URLs with password only', () => {
    const syntheticSecret = ['synthetic', 'credential', 'fixture', '2'].join('_');
    const rawUrl = `rediss://:${syntheticSecret}@redis.example.test:6380/0`;
    const sanitized = sanitizeRedisUrl(rawUrl);

    expect(sanitized).not.toContain(syntheticSecret);
    expect(sanitized).toBe('rediss://:***@redis.example.test:6380/0');
  });

  it('extracts non-sensitive target information correctly', () => {
    const syntheticSecret = ['synthetic', 'credential', 'fixture', '3'].join('.');
    const target = getSanitizedTarget(`rediss://user:${syntheticSecret}@node-1.example.test:6380/3`);

    expect(target).toEqual({
      host: 'node-1.example.test',
      port: 6380,
      db: 3,
      isTls: true
    });
  });
});
