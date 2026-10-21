import { describe, it, expect } from 'vitest';
import {
  parseKeyInput,
  encodeKeyOutput,
  isValidCanonicalBase64,
  isLosslessUtf8,
  formatSafeKeyLabel,
  DEFAULT_MAX_KEY_BYTES
} from '../src/utils/key-codec.js';
import { InvalidParameterError } from '../src/errors/redis-mcp-error.js';

describe('Key Codec Utility (V1.1 Binary Safety)', () => {
  it('parses legacy UTF-8 string key', () => {
    const buf = parseKeyInput('users:session:123');
    expect(buf).toEqual(Buffer.from('users:session:123', 'utf-8'));
  });

  it('parses structured UTF-8 key', () => {
    const buf = parseKeyInput({ encoding: 'utf8', value: 'users:session:456' });
    expect(buf).toEqual(Buffer.from('users:session:456', 'utf-8'));
  });

  it('parses valid Base64 binary key', () => {
    // Representative binary JDK string key: AC ED 00 05 74 00 04 74 65 73 74
    const rawBytes = Buffer.from([0xac, 0xed, 0x00, 0x05, 0x74, 0x00, 0x04, 0x74, 0x65, 0x73, 0x74]);
    const base64Str = rawBytes.toString('base64');

    const decoded = parseKeyInput({ encoding: 'base64', value: base64Str });
    expect(decoded).toEqual(rawBytes);
  });

  it('rejects malformed Base64 key', () => {
    expect(() => {
      parseKeyInput({ encoding: 'base64', value: 'not-valid-base64!@#$' });
    }).toThrow(InvalidParameterError);
  });

  it('rejects non-canonical Base64 with corrupted padding bits', () => {
    // "ZE==" has non-zero bits in the unused padding positions
    expect(isValidCanonicalBase64('ZE==')).toBe(false);
    expect(() => {
      parseKeyInput({ encoding: 'base64', value: 'ZE==' });
    }).toThrow(InvalidParameterError);
  });

  it('rejects empty Base64 and empty string keys', () => {
    expect(() => parseKeyInput('')).toThrow(InvalidParameterError);
    expect(() => parseKeyInput({ encoding: 'utf8', value: '' })).toThrow(InvalidParameterError);
    expect(() => parseKeyInput({ encoding: 'base64', value: '' })).toThrow(InvalidParameterError);
  });

  it('accepts key exactly at maximum bytes and rejects key over maximum bytes', () => {
    const maxBuf = Buffer.alloc(DEFAULT_MAX_KEY_BYTES, 0x61);
    const parsedMax = parseKeyInput({ encoding: 'base64', value: maxBuf.toString('base64') });
    expect(parsedMax.length).toBe(DEFAULT_MAX_KEY_BYTES);

    const overBuf = Buffer.alloc(DEFAULT_MAX_KEY_BYTES + 1, 0x61);
    expect(() => {
      parseKeyInput({ encoding: 'base64', value: overBuf.toString('base64') });
    }).toThrow(/exceeds maximum limit/);
  });

  it('preserves embedded null bytes and binary characters without loss', () => {
    const binaryWithNull = Buffer.from([0x00, 0xff, 0x00, 0xfe, 0x12, 0x34]);
    const base64 = binaryWithNull.toString('base64');

    const decoded = parseKeyInput({ encoding: 'base64', value: base64 });
    expect(decoded).toEqual(binaryWithNull);
    expect(decoded.length).toBe(6);
    expect(decoded[0]).toBe(0x00);
    expect(decoded[1]).toBe(0xff);
  });

  it('identifies lossless UTF-8 vs non-UTF-8 binary buffers', () => {
    const validUtf8 = Buffer.from('cache:users:東京都', 'utf-8');
    expect(isLosslessUtf8(validUtf8)).toBe(true);

    const invalidUtf8 = Buffer.from([0xff, 0xfe, 0xac, 0xed]);
    expect(isLosslessUtf8(invalidUtf8)).toBe(false);
  });

  it('encodes output correctly as utf8 or base64', () => {
    const textBuf = Buffer.from('hello:world', 'utf-8');
    const textEncoded = encodeKeyOutput(textBuf);
    expect(textEncoded).toEqual({
      encoding: 'utf8',
      value: 'hello:world',
      byteLength: 11
    });

    const binaryBuf = Buffer.from([0xac, 0xed, 0x00, 0x05]);
    const binaryEncoded = encodeKeyOutput(binaryBuf);
    expect(binaryEncoded).toEqual({
      encoding: 'base64',
      value: binaryBuf.toString('base64'),
      byteLength: 4
    });
  });

  it('formats safe key labels without leaking raw binary or control characters', () => {
    expect(formatSafeKeyLabel('user:session:123')).toBe("'user:session:123'");

    const binaryBuf = Buffer.from([0xac, 0xed, 0x00, 0x05, 0x74, 0x00, 0x05]);
    const label = formatSafeKeyLabel(binaryBuf);

    expect(label).toMatch(/^binary-key:[a-f0-9]{12} \(7 bytes\)$/);
    expect(label).not.toContain('\x00');
    expect(label).not.toContain('\xac');
  });
});
