import { formatSafeKeyLabel, type KeyInput } from '../utils/key-codec.js';

export type ErrorCode =
  | 'CONFIGURATION_ERROR'
  | 'CONNECTION_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'TLS_ERROR'
  | 'TIMEOUT_ERROR'
  | 'KEY_NOT_FOUND'
  | 'TYPE_MISMATCH'
  | 'UNSUPPORTED_TYPE'
  | 'PERMISSION_DENIED'
  | 'INVALID_PARAMETER'
  | 'RESULT_LIMIT_EXCEEDED'
  | 'COMMAND_NOT_ALLOWED'
  | 'INTERNAL_ERROR';

export class RedisMcpError extends Error {
  public readonly code: ErrorCode;
  public readonly isOperational: boolean;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { isOperational?: boolean; details?: Record<string, unknown>; cause?: unknown }
  ) {
    super(message);
    this.name = 'RedisMcpError';
    this.code = code;
    this.isOperational = options?.isOperational ?? true;
    this.details = options?.details;
    if (options?.cause) {
      this.cause = options.cause;
    }
  }

  public toSanitizedObject(): { error: string; code: ErrorCode; details?: Record<string, unknown> } {
    return {
      error: this.message,
      code: this.code,
      ...(this.details ? { details: this.details } : {})
    };
  }
}

export class ConfigurationError extends RedisMcpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CONFIGURATION_ERROR', message, { details });
    this.name = 'ConfigurationError';
  }
}

export class ConnectionError extends RedisMcpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CONNECTION_ERROR', message, { details });
    this.name = 'ConnectionError';
  }
}

export class AuthenticationError extends RedisMcpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('AUTHENTICATION_ERROR', message, { details });
    this.name = 'AuthenticationError';
  }
}

export class TlsError extends RedisMcpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('TLS_ERROR', message, { details });
    this.name = 'TlsError';
  }
}

export class TimeoutError extends RedisMcpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('TIMEOUT_ERROR', message, { details });
    this.name = 'TimeoutError';
  }
}

export class KeyNotFoundError extends RedisMcpError {
  constructor(key: string | Buffer | KeyInput) {
    const label = formatSafeKeyLabel(key);
    super('KEY_NOT_FOUND', `Key ${label} does not exist in Redis`, { details: { key: label } });
    this.name = 'KeyNotFoundError';
  }
}

export class TypeMismatchError extends RedisMcpError {
  constructor(key: string | Buffer | KeyInput, expectedType: string, actualType: string) {
    const label = formatSafeKeyLabel(key);
    super(
      'TYPE_MISMATCH',
      `Key ${label} has Redis type '${actualType}', but operation expected '${expectedType}'`,
      { details: { key: label, expectedType, actualType } }
    );
    this.name = 'TypeMismatchError';
  }
}

export class UnsupportedTypeError extends RedisMcpError {
  constructor(key: string | Buffer | KeyInput, actualType: string) {
    const label = formatSafeKeyLabel(key);
    super(
      'UNSUPPORTED_TYPE',
      `Type '${actualType}' on key ${label} is not supported for inspection by this tool`,
      { details: { key: label, actualType } }
    );
    this.name = 'UnsupportedTypeError';
  }
}

export class PermissionDeniedError extends RedisMcpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('PERMISSION_DENIED', message, { details });
    this.name = 'PermissionDeniedError';
  }
}

export class InvalidParameterError extends RedisMcpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('INVALID_PARAMETER', message, { details });
    this.name = 'InvalidParameterError';
  }
}

export class ResultLimitExceededError extends RedisMcpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('RESULT_LIMIT_EXCEEDED', message, { details });
    this.name = 'ResultLimitExceededError';
  }
}

export class CommandNotAllowedError extends RedisMcpError {
  constructor(command: string) {
    super(
      'COMMAND_NOT_ALLOWED',
      `Command '${command}' is prohibited. This MCP server is strictly read-only.`,
      { details: { command } }
    );
    this.name = 'CommandNotAllowedError';
  }
}
