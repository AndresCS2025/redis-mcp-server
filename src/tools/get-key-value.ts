import { z } from 'zod';
import type { SafeRedisClient } from '../redis/redis-client.js';
import type { ServerConfig } from '../config/redis-config.js';
import { MetadataCollector } from '../metadata/metadata-collector.js';
import { getKeyValueSchema } from '../schemas/tool-schemas.js';
import { TypeMismatchError } from '../errors/redis-mcp-error.js';
import { parseKeyInput, encodeKeyOutput, isLosslessUtf8, type EncodedKeyOutput } from '../utils/key-codec.js';

export interface KeyValueResult {
  key: EncodedKeyOutput;
  exists: boolean;
  type: string;
  encoding: 'utf8' | 'base64';
  value: string | null;
  originalByteLength: number;
  returnedByteLength: number;
  truncated: boolean;
  detectedFormat?: 'utf8' | 'java-serialization' | 'binary';
  metadata?: ReturnType<MetadataCollector['complete']>;
}

export async function handleGetKeyValue(
  params: z.infer<typeof getKeyValueSchema>,
  redisClient: SafeRedisClient,
  config: ServerConfig
): Promise<KeyValueResult> {
  const meta = new MetadataCollector('get_key_value', config.metadataEnabled, config.metadataLevel);
  const keyBuffer = parseKeyInput(params.key);
  const encodedKey = encodeKeyOutput(keyBuffer);

  const keyType = await redisClient.type(keyBuffer);

  if (keyType === 'none') {
    return {
      key: encodedKey,
      exists: false,
      type: 'none',
      encoding: 'utf8',
      value: null,
      originalByteLength: 0,
      returnedByteLength: 0,
      truncated: false,
      metadata: meta.complete({ resultCount: 0 })
    };
  }

  if (keyType !== 'string') {
    throw new TypeMismatchError(keyBuffer, 'string', keyType);
  }

  const maxAllowedBytes = Math.min(params.maxBytes ?? config.maxValueBytes, config.maxValueBytes);
  const rawBuffer = await redisClient.getBuffer(keyBuffer);

  if (!rawBuffer) {
    return {
      key: encodedKey,
      exists: false,
      type: 'string',
      encoding: 'utf8',
      value: null,
      originalByteLength: 0,
      returnedByteLength: 0,
      truncated: false,
      metadata: meta.complete({ resultCount: 0 })
    };
  }

  const originalByteLength = rawBuffer.length;
  const isTruncated = originalByteLength > maxAllowedBytes;
  const sliceBuffer = isTruncated ? rawBuffer.subarray(0, maxAllowedBytes) : rawBuffer;
  const returnedByteLength = sliceBuffer.length;

  const isUtf8 = isLosslessUtf8(sliceBuffer);
  const isJavaSerialization =
    rawBuffer.length >= 2 && rawBuffer[0] === 0xac && rawBuffer[1] === 0xed;

  const detectedFormat: 'utf8' | 'java-serialization' | 'binary' = isJavaSerialization
    ? 'java-serialization'
    : isUtf8
      ? 'utf8'
      : 'binary';

  const encoding: 'utf8' | 'base64' = isUtf8 ? 'utf8' : 'base64';
  const value = isUtf8 ? sliceBuffer.toString('utf-8') : sliceBuffer.toString('base64');

  return {
    key: encodedKey,
    exists: true,
    type: 'string',
    encoding,
    value,
    originalByteLength,
    returnedByteLength,
    truncated: isTruncated,
    detectedFormat,
    metadata: meta.complete({
      resultCount: 1,
      truncated: isTruncated,
      notes: [
        isTruncated
          ? `Value truncated to ${returnedByteLength} raw bytes out of ${originalByteLength} total bytes`
          : `Full value retrieved (${originalByteLength} bytes)`,
        `Detected format: ${detectedFormat}, output encoding: ${encoding}`
      ]
    })
  };
}
