import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig } from '../src/config/redis-config.js';
import { SafeRedisClient } from '../src/redis/redis-client.js';
import { handleGetKeyInfo } from '../src/tools/get-key-info.js';
import { handleScanKeys } from '../src/tools/scan-keys.js';
import { handleGetKeyValue } from '../src/tools/get-key-value.js';
import { handleGetCollectionEntries } from '../src/tools/get-collection-entries.js';
import { handleGetMemoryUsage } from '../src/tools/get-memory-usage.js';
import { handleGetServerInfo } from '../src/tools/get-server-info.js';
import { TypeMismatchError, UnsupportedTypeError } from '../src/errors/redis-mcp-error.js';

describe('MCP Tool Handlers', () => {
  const config = loadConfig({
    REDIS_URL: 'redis://127.0.0.1:6379/0',
    REDIS_MAX_SCAN_COUNT: '50',
    REDIS_MAX_RESULTS: '50',
    REDIS_MAX_VALUE_BYTES: '1024'
  });

  let mockClient: SafeRedisClient;

  beforeEach(() => {
    mockClient = new SafeRedisClient(config);
  });

  describe('get_key_info', () => {
    it('returns exists=false and ttl=-2 for missing key', async () => {
      vi.spyOn(mockClient, 'exists').mockResolvedValue(false);

      const result = await handleGetKeyInfo({ key: 'missing:key' }, mockClient, config);

      expect(result.exists).toBe(false);
      expect(result.type).toBe('none');
      expect(result.ttlSeconds).toBe(-2);
      expect(result.pttlMilliseconds).toBe(-2);
      expect(result.hasExpiration).toBe(false);
      expect(result.key).toEqual({
        encoding: 'utf8',
        value: 'missing:key',
        byteLength: 11
      });
    });

    it('returns full key info for existing key with positive TTL', async () => {
      vi.spyOn(mockClient, 'exists').mockResolvedValue(true);
      vi.spyOn(mockClient, 'type').mockResolvedValue('string');
      vi.spyOn(mockClient, 'ttl').mockResolvedValue(300);
      vi.spyOn(mockClient, 'pttl').mockResolvedValue(300000);
      vi.spyOn(mockClient, 'memoryUsage').mockResolvedValue(1024);
      vi.spyOn(mockClient, 'objectEncoding').mockResolvedValue('embstr');

      const result = await handleGetKeyInfo({ key: 'user:session:123' }, mockClient, config);

      expect(result.exists).toBe(true);
      expect(result.type).toBe('string');
      expect(result.ttlSeconds).toBe(300);
      expect(result.pttlMilliseconds).toBe(300000);
      expect(result.hasExpiration).toBe(true);
      expect(result.memoryUsageBytes).toBe(1024);
      expect(result.objectEncoding).toBe('embstr');
      expect(result.metadata).toBeDefined();
    });

    it('preserves TTL=-1 for key without expiration', async () => {
      vi.spyOn(mockClient, 'exists').mockResolvedValue(true);
      vi.spyOn(mockClient, 'type').mockResolvedValue('hash');
      vi.spyOn(mockClient, 'ttl').mockResolvedValue(-1);
      vi.spyOn(mockClient, 'pttl').mockResolvedValue(-1);
      vi.spyOn(mockClient, 'memoryUsage').mockResolvedValue(2048);
      vi.spyOn(mockClient, 'objectEncoding').mockResolvedValue('hashtable');

      const result = await handleGetKeyInfo({ key: 'config:global' }, mockClient, config);

      expect(result.exists).toBe(true);
      expect(result.ttlSeconds).toBe(-1);
      expect(result.hasExpiration).toBe(false);
    });
  });

  describe('scan_keys', () => {
    it('executes bounded SCAN step with cursor progression using scanBuffer', async () => {
      vi.spyOn(mockClient, 'scanBuffer').mockResolvedValue([
        '42',
        [Buffer.from('user:1'), Buffer.from('user:2'), Buffer.from('user:3')]
      ]);

      const result = await handleScanKeys(
        { pattern: 'user:*', cursor: '0', count: 10, limit: 10 },
        mockClient,
        config
      );

      expect(result.pattern).toBe('user:*');
      expect(result.keys).toEqual([
        { encoding: 'utf8', value: 'user:1', byteLength: 6 },
        { encoding: 'utf8', value: 'user:2', byteLength: 6 },
        { encoding: 'utf8', value: 'user:3', byteLength: 6 }
      ]);
      expect(result.returnedCount).toBe(3);
      expect(result.nextCursor).toBe('42');
      expect(result.completed).toBe(false);
      expect(result.truncated).toBe(false);
    });

    it('preserves all keys returned by Redis in a single step without destructive slicing (Fix 1)', async () => {
      // 15 keys returned by Redis when requested count is 10
      const fifteenBuffers = Array.from({ length: 15 }, (_, i) => Buffer.from(`key:${i + 1}`));
      const scanSpy = vi.spyOn(mockClient, 'scanBuffer').mockResolvedValue(['17', fifteenBuffers]);

      const result = await handleScanKeys(
        { pattern: 'key:*', cursor: '0', count: 10 },
        mockClient,
        config
      );

      // Invariants:
      // 1. Exactly one SCAN command issued with clamped count hint
      expect(scanSpy).toHaveBeenCalledTimes(1);
      expect(scanSpy).toHaveBeenCalledWith('0', 'key:*', 10);
      // 2. All 15 keys are returned, none silently dropped
      expect(result.returnedCount).toBe(15);
      expect(result.keys.length).toBe(15);
      expect(result.keys[0]?.value).toBe('key:1');
      expect(result.keys[14]?.value).toBe('key:15');
      // 3. nextCursor is preserved exactly
      expect(result.nextCursor).toBe('17');
      expect(result.completed).toBe(false);
      expect(result.truncated).toBe(false);
      expect(result.metadata).toBeDefined();
    });

    it('clamps excessive count hints to REDIS_MAX_SCAN_COUNT without discarding returned keys', async () => {
      const keys = [Buffer.from('k1'), Buffer.from('k2'), Buffer.from('k3')];
      const scanSpy = vi.spyOn(mockClient, 'scanBuffer').mockResolvedValue(['0', keys]);

      const result = await handleScanKeys(
        { pattern: 'k*', cursor: '0', count: 9999 },
        mockClient,
        config
      );

      // Clamped to config.maxScanCount (50)
      expect(scanSpy).toHaveBeenCalledWith('0', 'k*', 50);
      expect(result.returnedCount).toBe(3);
      expect(result.completed).toBe(true);
    });
  });

  describe('get_key_value', () => {
    it('reads string value safely', async () => {
      vi.spyOn(mockClient, 'type').mockResolvedValue('string');
      vi.spyOn(mockClient, 'getBuffer').mockResolvedValue(Buffer.from('{"status":"active"}'));

      const result = await handleGetKeyValue({ key: 'cache:status' }, mockClient, config);

      expect(result.exists).toBe(true);
      expect(result.type).toBe('string');
      expect(result.encoding).toBe('utf8');
      expect(result.value).toBe('{"status":"active"}');
      expect(result.originalByteLength).toBe(19);
      expect(result.returnedByteLength).toBe(19);
      expect(result.truncated).toBe(false);
    });

    it('rejects non-string types with TypeMismatchError', async () => {
      vi.spyOn(mockClient, 'type').mockResolvedValue('hash');

      await expect(handleGetKeyValue({ key: 'cache:hashmap' }, mockClient, config)).rejects.toThrow(
        TypeMismatchError
      );
    });

    it('truncates value when exceeding maxBytes limit', async () => {
      vi.spyOn(mockClient, 'type').mockResolvedValue('string');
      const largeValue = 'x'.repeat(2000);
      vi.spyOn(mockClient, 'getBuffer').mockResolvedValue(Buffer.from(largeValue));

      const result = await handleGetKeyValue({ key: 'cache:large', maxBytes: 500 }, mockClient, config);

      expect(result.exists).toBe(true);
      expect(result.truncated).toBe(true);
      expect(result.value?.length).toBe(500);
      expect(result.returnedByteLength).toBe(500);
      expect(result.originalByteLength).toBe(2000);
    });
  });

  describe('get_collection_entries', () => {
    it('reads hash collection via HSCAN', async () => {
      vi.spyOn(mockClient, 'type').mockResolvedValue('hash');
      vi.spyOn(mockClient, 'hlen').mockResolvedValue(2);
      vi.spyOn(mockClient, 'hscan').mockResolvedValue(['0', ['field1', 'val1', 'field2', 'val2']]);

      const result = await handleGetCollectionEntries({ key: 'user:profile:1' }, mockClient, config);

      expect(result.type).toBe('hash');
      expect(result.cardinality).toBe(2);
      expect(result.entries).toEqual([
        { field: 'field1', value: 'val1' },
        { field: 'field2', value: 'val2' }
      ]);
      expect(result.hasMore).toBe(false);
    });

    it('reads list collection via bounded LRANGE', async () => {
      vi.spyOn(mockClient, 'type').mockResolvedValue('list');
      vi.spyOn(mockClient, 'llen').mockResolvedValue(10);
      vi.spyOn(mockClient, 'lrange').mockResolvedValue(['item0', 'item1', 'item2']);

      const result = await handleGetCollectionEntries(
        { key: 'queue:events', offset: 0, limit: 3 },
        mockClient,
        config
      );

      expect(result.type).toBe('list');
      expect(result.cardinality).toBe(10);
      expect(result.entries).toEqual(['item0', 'item1', 'item2']);
      expect(result.hasMore).toBe(true);
    });

    it('reads set collection via SSCAN', async () => {
      vi.spyOn(mockClient, 'type').mockResolvedValue('set');
      vi.spyOn(mockClient, 'scard').mockResolvedValue(3);
      vi.spyOn(mockClient, 'sscan').mockResolvedValue(['0', ['memberA', 'memberB']]);

      const result = await handleGetCollectionEntries({ key: 'tags:post:1' }, mockClient, config);

      expect(result.type).toBe('set');
      expect(result.cardinality).toBe(3);
      expect(result.entries).toEqual(['memberA', 'memberB']);
    });

    it('reads sorted set with scores via ZRANGE', async () => {
      vi.spyOn(mockClient, 'type').mockResolvedValue('zset');
      vi.spyOn(mockClient, 'zcard').mockResolvedValue(2);
      vi.spyOn(mockClient, 'zrangeWithScores').mockResolvedValue([
        { member: 'player1', score: 100 },
        { member: 'player2', score: 200 }
      ]);

      const result = await handleGetCollectionEntries({ key: 'leaderboard' }, mockClient, config);

      expect(result.type).toBe('zset');
      expect(result.cardinality).toBe(2);
      expect(result.entries).toEqual([
        { member: 'player1', score: 100 },
        { member: 'player2', score: 200 }
      ]);
    });

    it('rejects streams with UnsupportedTypeError', async () => {
      vi.spyOn(mockClient, 'type').mockResolvedValue('stream');

      await expect(
        handleGetCollectionEntries({ key: 'events:stream' }, mockClient, config)
      ).rejects.toThrow(UnsupportedTypeError);
    });
  });

  describe('get_memory_usage', () => {
    it('returns memory usage for existing key', async () => {
      vi.spyOn(mockClient, 'exists').mockResolvedValue(true);
      vi.spyOn(mockClient, 'memoryUsage').mockResolvedValue(4096);

      const result = await handleGetMemoryUsage({ key: 'cache:key' }, mockClient, config);

      expect(result.exists).toBe(true);
      expect(result.memoryUsageBytes).toBe(4096);
      expect(result.supported).toBe(true);
    });

    it('handles restricted/disabled MEMORY USAGE command gracefully', async () => {
      vi.spyOn(mockClient, 'exists').mockResolvedValue(true);
      vi.spyOn(mockClient, 'memoryUsage').mockResolvedValue(null);

      const result = await handleGetMemoryUsage({ key: 'cache:key' }, mockClient, config);

      expect(result.exists).toBe(true);
      expect(result.memoryUsageBytes).toBe(null);
      expect(result.supported).toBe(false);
      expect(result.notes).toContain('restricted');
    });
  });

  describe('get_server_info', () => {
    it('parses allowlisted memory section safely without exposing denylisted fields', async () => {
      const syntheticRequirepass = ['synthetic', 'requirepass', 'fixture', 'value'].join('-');
      const mockRawInfo = [
        '# Memory',
        'used_memory:1048576',
        'used_memory_human:1M',
        'used_memory_rss:2097152',
        'mem_fragmentation_ratio:1.50',
        `requirepass:${syntheticRequirepass}`,
        'config_file:/etc/redis/redis.conf'
      ].join('\n');

      vi.spyOn(mockClient, 'info').mockResolvedValue(mockRawInfo);

      const result = await handleGetServerInfo({ section: 'memory' }, mockClient, config);

      expect(result.section).toBe('memory');
      expect(result.fields['used_memory']).toBe(1048576);
      expect(result.fields['used_memory_human']).toBe('1M');
      expect(result.fields['mem_fragmentation_ratio']).toBe(1.5);

      // Verify sensitive fields are stripped and synthetic value is nowhere in output
      expect(result.fields['requirepass']).toBeUndefined();
      expect(result.fields['config_file']).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain(syntheticRequirepass);
    });
  });
});
