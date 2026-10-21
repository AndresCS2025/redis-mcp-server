import { z } from 'zod';
import { ConfigurationError } from '../errors/redis-mcp-error.js';

const metadataLevelSchema = z.enum(['minimal', 'standard', 'detailed']).default('standard');

export const serverConfigSchema = z.object({
  redisUrl: z
    .string()
    .min(1, 'REDIS_URL must not be empty')
    .refine((url) => /^rediss?:\/\//i.test(url), {
      message: 'REDIS_URL must begin with redis:// or rediss://'
    }),
  mcpPort: z.coerce.number().int().min(1).max(65535).default(3000),
  mcpHost: z.string().default('127.0.0.1'),
  connectionTimeoutMs: z.coerce.number().int().min(100).max(60000).default(5000),
  commandTimeoutMs: z.coerce.number().int().min(100).max(60000).default(3000),
  maxScanCount: z.coerce.number().int().min(1).max(10000).default(100),
  maxResults: z.coerce.number().int().min(1).max(10000).default(100),
  maxValueBytes: z.coerce.number().int().min(1024).max(10485760).default(65536), // 64KB default, 10MB max
  metadataEnabled: z
    .string()
    .optional()
    .transform((val) => val === undefined || val.toLowerCase() !== 'false'),
  metadataLevel: metadataLevelSchema,
  tlsCaPath: z.string().optional(),
  tlsCertPath: z.string().optional(),
  tlsKeyPath: z.string().optional(),
  tlsRejectUnauthorized: z
    .string()
    .optional()
    .transform((val) => val === undefined || val.toLowerCase() !== 'false')
});

export type ServerConfig = z.infer<typeof serverConfigSchema>;

export interface SanitizedConfigInfo {
  mcpPort: number;
  mcpHost: string;
  redisHost: string;
  redisPort: number;
  redisDb: number;
  isTls: boolean;
  connectionTimeoutMs: number;
  commandTimeoutMs: number;
  maxScanCount: number;
  maxResults: number;
  maxValueBytes: number;
  metadataEnabled: boolean;
  metadataLevel: string;
}

/**
 * Parses and sanitizes a Redis URL to extract connection details without revealing credentials.
 */
export function sanitizeRedisUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return 'redis://[invalid-url]';
  }
}

/**
 * Extracts non-sensitive Redis target information.
 */
export function getSanitizedTarget(rawUrl: string): { host: string; port: number; db: number; isTls: boolean } {
  try {
    const parsed = new URL(rawUrl);
    const isTls = parsed.protocol === 'rediss:';
    const host = parsed.hostname || '127.0.0.1';
    const port = parsed.port ? parseInt(parsed.port, 10) : (isTls ? 6380 : 6379);
    let db = 0;
    if (parsed.pathname && parsed.pathname.length > 1) {
      const parsedDb = parseInt(parsed.pathname.slice(1), 10);
      if (!isNaN(parsedDb)) {
        db = parsedDb;
      }
    }
    return { host, port, db, isTls };
  } catch {
    return { host: 'unknown', port: 6379, db: 0, isTls: false };
  }
}

/**
 * Loads and validates configuration from environment variables.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const raw = {
    redisUrl: env['REDIS_URL'] || 'redis://127.0.0.1:6379/0',
    mcpPort: env['MCP_PORT'],
    mcpHost: env['MCP_HOST'],
    connectionTimeoutMs: env['REDIS_CONNECTION_TIMEOUT_MS'],
    commandTimeoutMs: env['REDIS_COMMAND_TIMEOUT_MS'],
    maxScanCount: env['REDIS_MAX_SCAN_COUNT'],
    maxResults: env['REDIS_MAX_RESULTS'],
    maxValueBytes: env['REDIS_MAX_VALUE_BYTES'],
    metadataEnabled: env['REDIS_METADATA_ENABLED'],
    metadataLevel: env['REDIS_METADATA_LEVEL'],
    tlsCaPath: env['REDIS_TLS_CA_PATH'],
    tlsCertPath: env['REDIS_TLS_CERT_PATH'],
    tlsKeyPath: env['REDIS_TLS_KEY_PATH'],
    tlsRejectUnauthorized: env['REDIS_TLS_REJECT_UNAUTHORIZED']
  };

  const parseResult = serverConfigSchema.safeParse(raw);

  if (!parseResult.success) {
    const formattedErrors = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new ConfigurationError(`Invalid server configuration: ${formattedErrors}`);
  }

  return parseResult.data;
}
