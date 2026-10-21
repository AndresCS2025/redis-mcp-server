import { z } from 'zod';
import type { SafeRedisClient } from '../redis/redis-client.js';
import type { ServerConfig } from '../config/redis-config.js';
import { MetadataCollector } from '../metadata/metadata-collector.js';
import { scanKeysSchema } from '../schemas/tool-schemas.js';
import { encodeKeyOutput, type EncodedKeyOutput } from '../utils/key-codec.js';

export interface ScanKeysResult {
  pattern: string;
  keys: EncodedKeyOutput[];
  returnedCount: number;
  nextCursor: string;
  completed: boolean;
  truncated: boolean;
  metadata?: ReturnType<MetadataCollector['complete']>;
}

export async function handleScanKeys(
  params: z.infer<typeof scanKeysSchema>,
  redisClient: SafeRedisClient,
  config: ServerConfig
): Promise<ScanKeysResult> {
  const meta = new MetadataCollector('scan_keys', config.metadataEnabled, config.metadataLevel);

  const cursor = params.cursor || '0';
  // Use count if provided, otherwise fallback to limit or default maxScanCount; clamp to maxScanCount
  const requestedHint = params.count ?? params.limit ?? config.maxScanCount;
  const countHint = Math.min(requestedHint, config.maxScanCount);

  // Single safe cursor-based SCAN step using binary-returning scanBuffer
  const [nextCursor, rawKeyBuffers] = await redisClient.scanBuffer(cursor, params.pattern, countHint);

  // To prevent silent key loss from the cursor stream, return all keys returned by Redis for this step
  const encodedKeys = rawKeyBuffers.map(encodeKeyOutput);
  const completed = nextCursor === '0';

  return {
    pattern: params.pattern,
    keys: encodedKeys,
    returnedCount: encodedKeys.length,
    nextCursor,
    completed,
    truncated: false,
    metadata: meta.complete({
      resultCount: encodedKeys.length,
      truncated: false,
      notes: [
        `SCAN count hint used: ${countLimitString(countHint)}`,
        `Cursor advanced from '${cursor}' to '${nextCursor}'`,
        completed ? 'Keyspace scan completed for this cursor sequence' : 'More keys may be available; pass nextCursor to continue scan'
      ]
    })
  };
}

function countLimitString(count: number): string {
  return `${count} (Redis SCAN count is a work hint, not an exact result size guarantee)`;
}
