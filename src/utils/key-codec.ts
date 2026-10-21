import { createHash } from 'node:crypto';
import { InvalidParameterError } from '../errors/redis-mcp-error.js';

export const DEFAULT_MAX_KEY_BYTES = 2048;

export type StructuredKeyInput =
  | { encoding: 'utf8'; value: string }
  | { encoding: 'base64'; value: string };

export type KeyInput = string | StructuredKeyInput;

export interface EncodedKeyOutput {
  encoding: 'utf8' | 'base64';
  value: string;
  byteLength: number;
}

/**
 * Validates whether a string is strictly canonical Base64.
 */
export function isValidCanonicalBase64(value: string): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }

  // Length must be a positive multiple of 4
  if (value.length === 0 || value.length % 4 !== 0) {
    return false;
  }

  // Must match standard Base64 character set with valid padding
  const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;
  if (!base64Regex.test(value)) {
    return false;
  }

  // Strict canonical validation: re-encoding decoded buffer must match exactly
  try {
    const buf = Buffer.from(value, 'base64');
    return buf.toString('base64') === value;
  } catch {
    return false;
  }
}

/**
 * Checks if a Buffer can be losslessly converted to a UTF-8 string and back.
 */
export function isLosslessUtf8(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return true;
  }
  const str = buffer.toString('utf-8');
  return Buffer.from(str, 'utf-8').equals(buffer);
}

/**
 * Parses and validates arbitrary key input into a Redis-ready Buffer.
 */
export function parseKeyInput(input: KeyInput, maxKeyBytes: number = DEFAULT_MAX_KEY_BYTES): Buffer {
  let keyBuffer: Buffer;

  if (typeof input === 'string') {
    if (input.length === 0) {
      throw new InvalidParameterError('Redis key must not be empty');
    }
    keyBuffer = Buffer.from(input, 'utf-8');
  } else if (typeof input === 'object' && input !== null) {
    if (input.encoding === 'utf8') {
      if (!input.value || input.value.length === 0) {
        throw new InvalidParameterError('UTF-8 key value must not be empty');
      }
      keyBuffer = Buffer.from(input.value, 'utf-8');
    } else if (input.encoding === 'base64') {
      if (!isValidCanonicalBase64(input.value)) {
        throw new InvalidParameterError('Malformed or non-canonical Base64 key payload');
      }
      keyBuffer = Buffer.from(input.value, 'base64');
    } else {
      throw new InvalidParameterError('Unsupported key encoding. Must be "utf8" or "base64"');
    }
  } else {
    throw new InvalidParameterError('Invalid key input type. Expected string or structured key object');
  }

  if (keyBuffer.length === 0) {
    throw new InvalidParameterError('Decoded Redis key must not be empty');
  }

  if (keyBuffer.length > maxKeyBytes) {
    throw new InvalidParameterError(
      `Redis key byte length (${keyBuffer.length}) exceeds maximum limit of ${maxKeyBytes} bytes`
    );
  }

  return keyBuffer;
}

/**
 * Encodes a Redis key Buffer into safe, lossless MCP output representation.
 */
export function encodeKeyOutput(buffer: Buffer): EncodedKeyOutput {
  if (isLosslessUtf8(buffer)) {
    return {
      encoding: 'utf8',
      value: buffer.toString('utf-8'),
      byteLength: buffer.length
    };
  }

  return {
    encoding: 'base64',
    value: buffer.toString('base64'),
    byteLength: buffer.length
  };
}

/**
 * Produces a safe label for a key suitable for logs and error messages without leaking binary data.
 */
export function formatSafeKeyLabel(key: Buffer | string | KeyInput): string {
  let buf: Buffer;

  if (Buffer.isBuffer(key)) {
    buf = key;
  } else {
    try {
      buf = parseKeyInput(key);
    } catch {
      return '[invalid-key]';
    }
  }

  if (isLosslessUtf8(buf)) {
    const text = buf.toString('utf-8');
    // Ensure no control characters (e.g. null bytes, unprintable ASCII)
    const isPrintable = /^[\x20-\x7E\u00A0-\uFFFF]*$/.test(text);
    if (isPrintable) {
      const preview = text.length > 50 ? `${text.slice(0, 50)}...` : text;
      return `'${preview}'`;
    }
  }

  // Non-printable or binary: return safe SHA256 digest label
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 12);
  return `binary-key:${hash} (${buf.length} bytes)`;
}
