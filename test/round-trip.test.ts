import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig } from '../src/config/redis-config.js';
import { SafeRedisClient } from '../src/redis/redis-client.js';
import { handleScanKeys } from '../src/tools/scan-keys.js';
import { handleGetKeyInfo } from '../src/tools/get-key-info.js';
import { handleGetKeyValue } from '../src/tools/get-key-value.js';
import { handleGetMemoryUsage } from '../src/tools/get-memory-usage.js';
import { handleGetCollectionEntries } from '../src/tools/get-collection-entries.js';

describe('Cross-Tool Binary Key Round Trip & Value Handling', () => {
  const config = loadConfig({
    REDIS_URL: 'redis://127.0.0.1:6379/0',
    REDIS_MAX_VALUE_BYTES: '1024'
  });

  let mockClient: SafeRedisClient;

  // Representative JDK-serialized key fixture for "sample:key:1001"
  // Stream magic: AC ED, Version: 00 05, TC_STRING: 74, Length: 00 0F, Data: "sample:key:1001"
  const jdkKeyBuffer = Buffer.from([
    0xac, 0xed, 0x00, 0x05, 0x74, 0x00, 0x0f, 0x73, 0x61, 0x6d, 0x70, 0x6c, 0x65, 0x3a, 0x6b, 0x65, 0x79, 0x3a, 0x31, 0x30, 0x30, 0x31
  ]);

  beforeEach(() => {
    mockClient = new SafeRedisClient(config);
  });

  it('preserves exact binary key bytes across scan_keys -> get_key_info / get_key_value / get_memory_usage', async () => {
    // 1. Mock scanBuffer to return the JDK binary key
    vi.spyOn(mockClient, 'scanBuffer').mockResolvedValue(['0', [jdkKeyBuffer]]);

    const scanResult = await handleScanKeys({ pattern: '*' }, mockClient, config);

    expect(scanResult.keys.length).toBe(1);
    const discoveredKey = scanResult.keys[0]!;
    expect(discoveredKey.encoding).toBe('base64');
    expect(discoveredKey.value).toBe(jdkKeyBuffer.toString('base64'));
    expect(discoveredKey.byteLength).toBe(jdkKeyBuffer.length);

    // 2. Feed discovered key directly into get_key_info
    const existsSpy = vi.spyOn(mockClient, 'exists').mockResolvedValue(true);
    vi.spyOn(mockClient, 'type').mockResolvedValue('string');
    vi.spyOn(mockClient, 'ttl').mockResolvedValue(1800);
    vi.spyOn(mockClient, 'pttl').mockResolvedValue(1800000);
    vi.spyOn(mockClient, 'memoryUsage').mockResolvedValue(256);
    vi.spyOn(mockClient, 'objectEncoding').mockResolvedValue('raw');

    const keyInfoResult = await handleGetKeyInfo({ key: discoveredKey }, mockClient, config);

    // Verify SafeRedisClient received the exact identical Buffer
    expect(existsSpy).toHaveBeenCalledWith(jdkKeyBuffer);
    expect(keyInfoResult.key.encoding).toBe('base64');
    expect(keyInfoResult.key.value).toBe(jdkKeyBuffer.toString('base64'));
    expect(keyInfoResult.exists).toBe(true);

    // 3. Feed discovered key directly into get_key_value
    // Binary value: JDK-serialized payload
    const jdkValueBuffer = Buffer.from([0xac, 0xed, 0x00, 0x05, 0x73, 0x72, 0x00, 0x13, 0x6a, 0x61, 0x76, 0x61, 0x2e, 0x75, 0x74, 0x69, 0x6c, 0x2e, 0x41, 0x72, 0x72, 0x61, 0x79, 0x4c, 0x69, 0x73, 0x74]);
    const getBufferSpy = vi.spyOn(mockClient, 'getBuffer').mockResolvedValue(jdkValueBuffer);

    const valResult = await handleGetKeyValue({ key: discoveredKey }, mockClient, config);

    expect(getBufferSpy).toHaveBeenCalledWith(jdkKeyBuffer);
    expect(valResult.encoding).toBe('base64');
    expect(valResult.value).toBe(jdkValueBuffer.toString('base64'));
    expect(valResult.detectedFormat).toBe('java-serialization');
    expect(valResult.originalByteLength).toBe(jdkValueBuffer.length);
    expect(valResult.returnedByteLength).toBe(jdkValueBuffer.length);
    expect(valResult.truncated).toBe(false);

    // 4. Feed discovered key into get_memory_usage
    const memSpy = vi.spyOn(mockClient, 'memoryUsage').mockResolvedValue(512);
    const memResult = await handleGetMemoryUsage({ key: discoveredKey }, mockClient, config);

    expect(memSpy).toHaveBeenCalledWith(jdkKeyBuffer, undefined);
    expect(memResult.memoryUsageBytes).toBe(512);
  });

  it('handles UTF-8 values and multibyte UTF-8 without corruption', async () => {
    const utf8Key = 'cache:company:profile';
    const utf8Payload = '{"company":"IBM 🚀","location":"Armonk, NY"}';
    const utf8Buffer = Buffer.from(utf8Payload, 'utf-8');

    vi.spyOn(mockClient, 'type').mockResolvedValue('string');
    vi.spyOn(mockClient, 'getBuffer').mockResolvedValue(utf8Buffer);

    const result = await handleGetKeyValue({ key: utf8Key }, mockClient, config);

    expect(result.encoding).toBe('utf8');
    expect(result.value).toBe(utf8Payload);
    expect(result.detectedFormat).toBe('utf8');
    expect(result.originalByteLength).toBe(utf8Buffer.length);
    expect(result.returnedByteLength).toBe(utf8Buffer.length);
    expect(result.truncated).toBe(false);
  });

  it('handles value truncation cleanly and falls back to Base64 when truncation splits a multibyte character', async () => {
    // 4-byte emoji 🚀 is [0xf0, 0x9f, 0x9a, 0x80]
    // "AB🚀" is 6 bytes. If maxBytes = 4, slicing cuts 🚀 in half -> invalid UTF-8
    const splitEmojiBuffer = Buffer.from('AB🚀', 'utf-8');
    expect(splitEmojiBuffer.length).toBe(6);

    vi.spyOn(mockClient, 'type').mockResolvedValue('string');
    vi.spyOn(mockClient, 'getBuffer').mockResolvedValue(splitEmojiBuffer);

    const result = await handleGetKeyValue({ key: 'test:split', maxBytes: 4 }, mockClient, config);

    expect(result.truncated).toBe(true);
    expect(result.originalByteLength).toBe(6);
    expect(result.returnedByteLength).toBe(4);
    // Sliced 4 bytes [0x41, 0x42, 0xf0, 0x9f] is not valid UTF-8, so it must fall back to base64
    expect(result.encoding).toBe('base64');
    expect(result.value).toBe(splitEmojiBuffer.subarray(0, 4).toString('base64'));
  });

  it('supports binary keys in get_collection_entries', async () => {
    vi.spyOn(mockClient, 'type').mockResolvedValue('hash');
    vi.spyOn(mockClient, 'hlen').mockResolvedValue(1);
    vi.spyOn(mockClient, 'hscan').mockResolvedValue(['0', ['field1', 'val1']]);

    const result = await handleGetCollectionEntries(
      { key: { encoding: 'base64', value: jdkKeyBuffer.toString('base64') } },
      mockClient,
      config
    );

    expect(result.key.encoding).toBe('base64');
    expect(result.key.value).toBe(jdkKeyBuffer.toString('base64'));
    expect(result.type).toBe('hash');
    expect(result.entries).toEqual([{ field: 'field1', value: 'val1' }]);
  });
});
