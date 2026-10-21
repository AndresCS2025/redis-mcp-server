import { z } from 'zod';
import type { SafeRedisClient } from '../redis/redis-client.js';
import type { ServerConfig } from '../config/redis-config.js';
import { MetadataCollector } from '../metadata/metadata-collector.js';
import { getMemoryUsageSchema } from '../schemas/tool-schemas.js';
import { parseKeyInput, encodeKeyOutput, type EncodedKeyOutput } from '../utils/key-codec.js';

export interface MemoryUsageResult {
  key: EncodedKeyOutput;
  exists: boolean;
  memoryUsageBytes: number | null;
  supported: boolean;
  notes?: string;
  metadata?: ReturnType<MetadataCollector['complete']>;
}

export async function handleGetMemoryUsage(
  params: z.infer<typeof getMemoryUsageSchema>,
  redisClient: SafeRedisClient,
  config: ServerConfig
): Promise<MemoryUsageResult> {
  const meta = new MetadataCollector('get_memory_usage', config.metadataEnabled, config.metadataLevel);
  const keyBuffer = parseKeyInput(params.key);
  const encodedKey = encodeKeyOutput(keyBuffer);

  const exists = await redisClient.exists(keyBuffer);

  if (!exists) {
    return {
      key: encodedKey,
      exists: false,
      memoryUsageBytes: null,
      supported: true,
      notes: 'Key does not exist in Redis',
      metadata: meta.complete({ resultCount: 0 })
    };
  }

  const memoryBytes = await redisClient.memoryUsage(keyBuffer, params.samples);

  if (memoryBytes === null) {
    return {
      key: encodedKey,
      exists: true,
      memoryUsageBytes: null,
      supported: false,
      notes: 'MEMORY USAGE command is disabled or restricted by Redis server ACL / configuration',
      metadata: meta.complete({
        resultCount: 0,
        notes: ['MEMORY USAGE command returned null or is not permitted']
      })
    };
  }

  return {
    key: encodedKey,
    exists: true,
    memoryUsageBytes: memoryBytes,
    supported: true,
    notes: `Approximate memory consumed: ${memoryBytes} bytes`,
    metadata: meta.complete({
      resultCount: 1,
      notes: [`Memory: ${memoryBytes} bytes (samples: ${params.samples ?? 'default'})`]
    })
  };
}
