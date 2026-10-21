import { z } from 'zod';
import type { SafeRedisClient } from '../redis/redis-client.js';
import type { ServerConfig } from '../config/redis-config.js';
import { MetadataCollector } from '../metadata/metadata-collector.js';
import { getKeyInfoSchema } from '../schemas/tool-schemas.js';
import { parseKeyInput, encodeKeyOutput, type EncodedKeyOutput } from '../utils/key-codec.js';

export interface KeyInfoResult {
  key: EncodedKeyOutput;
  exists: boolean;
  type: string;
  ttlSeconds: number;
  pttlMilliseconds: number;
  hasExpiration: boolean;
  memoryUsageBytes: number | null;
  objectEncoding: string | null;
  metadata?: ReturnType<MetadataCollector['complete']>;
}

export async function handleGetKeyInfo(
  params: z.infer<typeof getKeyInfoSchema>,
  redisClient: SafeRedisClient,
  config: ServerConfig
): Promise<KeyInfoResult> {
  const meta = new MetadataCollector('get_key_info', config.metadataEnabled, config.metadataLevel);
  const keyBuffer = parseKeyInput(params.key);
  const encodedKey = encodeKeyOutput(keyBuffer);

  const exists = await redisClient.exists(keyBuffer);

  if (!exists) {
    return {
      key: encodedKey,
      exists: false,
      type: 'none',
      ttlSeconds: -2,
      pttlMilliseconds: -2,
      hasExpiration: false,
      memoryUsageBytes: null,
      objectEncoding: null,
      metadata: meta.complete({ resultCount: 0 })
    };
  }

  const [type, ttl, pttl, memoryUsage, encoding] = await Promise.all([
    redisClient.type(keyBuffer),
    redisClient.ttl(keyBuffer),
    redisClient.pttl(keyBuffer),
    redisClient.memoryUsage(keyBuffer),
    redisClient.objectEncoding(keyBuffer)
  ]);

  const hasExpiration = ttl > 0;

  return {
    key: encodedKey,
    exists: true,
    type,
    ttlSeconds: ttl,
    pttlMilliseconds: pttl,
    hasExpiration,
    memoryUsageBytes: memoryUsage,
    objectEncoding: encoding,
    metadata: meta.complete({
      resultCount: 1,
      notes: [
        `TTL status: ${ttl === -1 ? 'Persistent (no TTL)' : ttl === -2 ? 'Key does not exist' : `Expires in ${ttl}s`}`
      ]
    })
  };
}
