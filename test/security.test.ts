import { describe, it, expect } from 'vitest';
import { sanitizeErrorMessage, formatToolError } from '../src/errors/error-handler.js';
import {
  KeyNotFoundError,
  TypeMismatchError,
  CommandNotAllowedError,
  PermissionDeniedError
} from '../src/errors/redis-mcp-error.js';

describe('Security & Sanitization', () => {
  it('masks credentials embedded inside raw error messages', () => {
    const syntheticSecret = ['synthetic', 'credential', 'auth', 'val'].join('-');
    const rawError = `Connection failed to redis://appuser:${syntheticSecret}@redis.example.test:6379/0: connection refused`;
    const sanitized = sanitizeErrorMessage(rawError);

    expect(sanitized).not.toContain(syntheticSecret);
    expect(sanitized).toContain('redis://appuser:***@redis.example.test:6379/0');
  });

  it('masks AUTH password strings in raw errors', () => {
    const syntheticSecret = ['synthetic', 'auth', 'secret', 'pass'].join('_');
    const rawError = `Error sending AUTH password: ${syntheticSecret}`;
    const sanitized = sanitizeErrorMessage(rawError);

    expect(sanitized).not.toContain(syntheticSecret);
    expect(sanitized).toContain('password=***');
  });

  it('formats custom RedisMcpError with structured code and sanitized message', () => {
    const error = new TypeMismatchError('cache:user:123', 'string', 'hash');
    const formatted = formatToolError(error);

    expect(formatted.code).toBe('TYPE_MISMATCH');
    expect(formatted.error).toContain("Key 'cache:user:123' has Redis type 'hash'");
    expect(formatted.details).toEqual({
      key: "'cache:user:123'",
      expectedType: 'string',
      actualType: 'hash'
    });
  });

  it('masks binary keys in error messages using safe digest labels', () => {
    const binaryKey = Buffer.from([0xac, 0xed, 0x00, 0x05, 0x74, 0x00, 0x04]);
    const error = new KeyNotFoundError(binaryKey);
    const formatted = formatToolError(error);

    expect(formatted.code).toBe('KEY_NOT_FOUND');
    expect(formatted.error).toMatch(/Key binary-key:[a-f0-9]{12} \(7 bytes\) does not exist/);
    expect(formatted.error).not.toContain('\xac');
    expect(formatted.error).not.toContain('\x00');
  });

  it('formats NOPERM / NOAUTH errors into PERMISSION_DENIED without leaking passwords', () => {
    const syntheticSecret = ['synthetic', 'noperm', 'token', 'sample'].join('.');
    const rawError = new Error(`NOPERM this user has no permissions to run command for pass=${syntheticSecret}`);
    const formatted = formatToolError(rawError);

    expect(formatted.code).toBe('PERMISSION_DENIED');
    expect(formatted.error).not.toContain(syntheticSecret);
  });

  it('formats prohibited command error safely', () => {
    const error = new CommandNotAllowedError('FLUSHALL');
    const formatted = formatToolError(error);

    expect(formatted.code).toBe('COMMAND_NOT_ALLOWED');
    expect(formatted.error).toContain("Command 'FLUSHALL' is prohibited");
  });

  it('formats key not found error safely', () => {
    const error = new KeyNotFoundError('missing:cache:key');
    const formatted = formatToolError(error);

    expect(formatted.code).toBe('KEY_NOT_FOUND');
    expect(formatted.error).toContain("Key 'missing:cache:key' does not exist");
  });
});
