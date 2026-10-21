import { z } from 'zod';
import type { SafeRedisClient } from '../redis/redis-client.js';
import type { ServerConfig } from '../config/redis-config.js';
import { MetadataCollector } from '../metadata/metadata-collector.js';
import { getServerInfoSchema, type AllowedInfoSection } from '../schemas/tool-schemas.js';

export interface ServerInfoResult {
  section: AllowedInfoSection;
  fields: Record<string, string | number | boolean>;
  metadata?: ReturnType<MetadataCollector['complete']>;
}

// Sensitive or internal fields that must never be exposed
const DENYLISTED_FIELD_PREFIXES = [
  'config_file',
  'executable',
  'process_id',
  'server_time_usec',
  'master_auth',
  'master_password',
  'requirepass',
  'acl',
  'user'
];

export async function handleGetServerInfo(
  params: z.infer<typeof getServerInfoSchema>,
  redisClient: SafeRedisClient,
  config: ServerConfig
): Promise<ServerInfoResult> {
  const section = params.section;
  const meta = new MetadataCollector('get_server_info', config.metadataEnabled, config.metadataLevel);

  const rawInfo = await redisClient.info(section);
  const parsedFields = parseInfoSection(rawInfo);

  return {
    section,
    fields: parsedFields,
    metadata: meta.complete({
      resultCount: Object.keys(parsedFields).length,
      notes: [`INFO section '${section}' parsed safely into ${Object.keys(parsedFields).length} fields`]
    })
  };
}

function parseInfoSection(raw: string): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1).trim();

    // Check denylist
    const isDenylisted = DENYLISTED_FIELD_PREFIXES.some((denied) =>
      key.toLowerCase().startsWith(denied)
    );
    if (isDenylisted) {
      continue;
    }

    // Convert values
    if (value === 'yes' || value === 'true') {
      result[key] = true;
    } else if (value === 'no' || value === 'false') {
      result[key] = false;
    } else if (/^-?\d+$/.test(value)) {
      result[key] = parseInt(value, 10);
    } else if (/^-?\d+\.\d+$/.test(value)) {
      result[key] = parseFloat(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}
