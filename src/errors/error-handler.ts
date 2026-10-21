import { RedisMcpError } from './redis-mcp-error.js';

/**
 * Sanitizes sensitive substrings (like passwords or tokens) from arbitrary error messages.
 */
export function sanitizeErrorMessage(message: string): string {
  // Mask URLs with credentials: redis://user:password@host -> redis://user:***@host
  let sanitized = message.replace(/(rediss?:\/\/)([^:@\s]+):([^@\s]+)@/gi, '$1$2:***@');
  // Mask URLs with password only: redis://:password@host -> redis://:***@host
  sanitized = sanitized.replace(/(rediss?:\/\/):([^@\s]+)@/gi, '$1:***@');
  // Mask common Redis AUTH / password patterns
  sanitized = sanitized.replace(/(password|pass|pwd|secret|token|auth)\s*[:=]\s*['"]?[^\s,'"]+['"]?/gi, '$1=***');
  return sanitized;
}

/**
 * Maps any unknown error to a structured, sanitized MCP tool error result.
 */
export function formatToolError(error: unknown): { error: string; code: string; details?: Record<string, unknown> } {
  if (error instanceof RedisMcpError) {
    return {
      error: sanitizeErrorMessage(error.message),
      code: error.code,
      details: error.details
    };
  }

  const rawMessage = error instanceof Error ? error.message : String(error);
  const sanitized = sanitizeErrorMessage(rawMessage);

  if (/NOPERM|NOAUTH|WRONGPASS|permission/i.test(rawMessage)) {
    return {
      error: `Redis permission or authentication error: ${sanitized}`,
      code: 'PERMISSION_DENIED'
    };
  }

  if (/ECONNREFUSED|EHOSTUNREACH|ENOTFOUND|closed|connection/i.test(rawMessage)) {
    return {
      error: `Redis connection error: ${sanitized}`,
      code: 'CONNECTION_ERROR'
    };
  }

  if (/timeout|ETIMEDOUT/i.test(rawMessage)) {
    return {
      error: `Redis command timed out: ${sanitized}`,
      code: 'TIMEOUT_ERROR'
    };
  }

  if (/WRONGTYPE/i.test(rawMessage)) {
    return {
      error: `Redis operation type mismatch: ${sanitized}`,
      code: 'TYPE_MISMATCH'
    };
  }

  return {
    error: `Redis operation failed: ${sanitized}`,
    code: 'INTERNAL_ERROR'
  };
}
