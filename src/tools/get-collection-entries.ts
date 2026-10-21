import { z } from 'zod';
import type { SafeRedisClient } from '../redis/redis-client.js';
import type { ServerConfig } from '../config/redis-config.js';
import { MetadataCollector } from '../metadata/metadata-collector.js';
import { getCollectionEntriesSchema } from '../schemas/tool-schemas.js';
import { UnsupportedTypeError } from '../errors/redis-mcp-error.js';
import { parseKeyInput, encodeKeyOutput, type EncodedKeyOutput } from '../utils/key-codec.js';

export type CollectionEntry =
  | string
  | { field: string; value: string }
  | { member: string; score: number };

export interface CollectionEntriesResult {
  key: EncodedKeyOutput;
  exists: boolean;
  type: string;
  cardinality: number;
  entries: CollectionEntry[];
  nextCursor?: string | null;
  offset?: number;
  hasMore: boolean;
  truncated: boolean;
  metadata?: ReturnType<MetadataCollector['complete']>;
}

export async function handleGetCollectionEntries(
  params: z.infer<typeof getCollectionEntriesSchema>,
  redisClient: SafeRedisClient,
  config: ServerConfig
): Promise<CollectionEntriesResult> {
  const meta = new MetadataCollector('get_collection_entries', config.metadataEnabled, config.metadataLevel);
  const keyBuffer = parseKeyInput(params.key);
  const encodedKey = encodeKeyOutput(keyBuffer);

  const keyType = await redisClient.type(keyBuffer);

  if (keyType === 'none') {
    return {
      key: encodedKey,
      exists: false,
      type: 'none',
      cardinality: 0,
      entries: [],
      hasMore: false,
      truncated: false,
      metadata: meta.complete({ resultCount: 0 })
    };
  }

  const limit = Math.min(params.limit ?? config.maxResults, config.maxResults);
  const cursor = params.cursor || '0';
  const offset = params.offset ?? 0;

  switch (keyType) {
    case 'hash': {
      const [cardinality, [nextCursor, rawEntries]] = await Promise.all([
        redisClient.hlen(keyBuffer),
        redisClient.hscan(keyBuffer, cursor, limit)
      ]);

      const entries: Array<{ field: string; value: string }> = [];
      for (let i = 0; i < rawEntries.length; i += 2) {
        const field = rawEntries[i];
        const value = rawEntries[i + 1];
        if (field !== undefined && value !== undefined) {
          entries.push({ field, value });
        }
      }

      const hasMore = nextCursor !== '0';

      return {
        key: encodedKey,
        exists: true,
        type: 'hash',
        cardinality,
        entries,
        nextCursor,
        hasMore,
        truncated: false,
        metadata: meta.complete({
          resultCount: entries.length,
          notes: [`Hash cardinality: ${cardinality}`, `HSCAN cursor: ${cursor} -> ${nextCursor}`]
        })
      };
    }

    case 'list': {
      const cardinality = await redisClient.llen(keyBuffer);
      const stopIndex = offset + limit - 1;
      const entries = await redisClient.lrange(keyBuffer, offset, stopIndex);
      const hasMore = offset + entries.length < cardinality;

      return {
        key: encodedKey,
        exists: true,
        type: 'list',
        cardinality,
        entries,
        offset,
        hasMore,
        truncated: false,
        metadata: meta.complete({
          resultCount: entries.length,
          notes: [`List length: ${cardinality}`, `LRANGE range: ${offset}..${stopIndex}`]
        })
      };
    }

    case 'set': {
      const [cardinality, [nextCursor, rawMembers]] = await Promise.all([
        redisClient.scard(keyBuffer),
        redisClient.sscan(keyBuffer, cursor, limit)
      ]);

      const hasMore = nextCursor !== '0';

      return {
        key: encodedKey,
        exists: true,
        type: 'set',
        cardinality,
        entries: rawMembers,
        nextCursor,
        hasMore,
        truncated: false,
        metadata: meta.complete({
          resultCount: rawMembers.length,
          notes: [`Set cardinality: ${cardinality}`, `SSCAN cursor: ${cursor} -> ${nextCursor}`]
        })
      };
    }

    case 'zset': {
      const cardinality = await redisClient.zcard(keyBuffer);
      const stopIndex = offset + limit - 1;
      const entries = await redisClient.zrangeWithScores(keyBuffer, offset, stopIndex);
      const hasMore = offset + entries.length < cardinality;

      return {
        key: encodedKey,
        exists: true,
        type: 'zset',
        cardinality,
        entries,
        offset,
        hasMore,
        truncated: false,
        metadata: meta.complete({
          resultCount: entries.length,
          notes: [`Sorted set cardinality: ${cardinality}`, `ZRANGE range: ${offset}..${stopIndex}`]
        })
      };
    }

    default: {
      throw new UnsupportedTypeError(keyBuffer, keyType);
    }
  }
}
