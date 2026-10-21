import { z } from 'zod';

export const structuredKeySchema = z.discriminatedUnion('encoding', [
  z.object({
    encoding: z.literal('utf8'),
    value: z.string().min(1, 'UTF-8 key value must not be empty')
  }),
  z.object({
    encoding: z.literal('base64'),
    value: z.string().min(1, 'Base64 key value must not be empty')
  })
]);

export const keyInputSchema = z.union([
  z.string().min(1, 'Key must be a non-empty string'),
  structuredKeySchema
]);

export const getKeyInfoSchema = z.object({
  key: keyInputSchema
});

export const scanKeysSchema = z.object({
  pattern: z.string().min(1, 'Pattern must be a non-empty string (e.g. "cache:*")'),
  cursor: z.string().optional().default('0').describe('Cursor position to start/continue SCAN. Pass "0" to begin.'),
  count: z.number().int().min(1).max(1000).optional().describe('Redis COUNT work hint for this single SCAN step (clamped to REDIS_MAX_SCAN_COUNT).'),
  limit: z.number().int().min(1).max(1000).optional().describe('Deprecated alias for count hint; Redis SCAN COUNT is a work hint and all keys returned for the step are preserved.')
});

export const getKeyValueSchema = z.object({
  key: keyInputSchema,
  maxBytes: z.number().int().min(128).max(10485760).optional()
});

export const getCollectionEntriesSchema = z.object({
  key: keyInputSchema,
  cursor: z.string().optional().default('0'),
  offset: z.number().int().min(0).optional().default(0),
  limit: z.number().int().min(1).max(1000).optional()
});

export const getMemoryUsageSchema = z.object({
  key: keyInputSchema,
  samples: z.number().int().min(0).max(100).optional()
});

export const ALLOWED_INFO_SECTIONS = [
  'server',
  'clients',
  'memory',
  'stats',
  'keyspace',
  'replication'
] as const;

export type AllowedInfoSection = (typeof ALLOWED_INFO_SECTIONS)[number];

export const getServerInfoSchema = z.object({
  section: z
    .enum(ALLOWED_INFO_SECTIONS)
    .optional()
    .default('memory')
    .describe('Allowlisted INFO section: server, clients, memory, stats, keyspace, or replication')
});
