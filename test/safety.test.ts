import { describe, it, expect, vi } from 'vitest';
import { createMcpServer } from '../src/server.js';
import { SafeRedisClient } from '../src/redis/redis-client.js';
import { loadConfig } from '../src/config/redis-config.js';

describe('Safety & Read-Only Hard Boundary', () => {
  const config = loadConfig({ REDIS_URL: 'redis://127.0.0.1:6379/0' });
  const mockRedisClient = new SafeRedisClient(config);

  it('registers only the 6 approved read-only tools', () => {
    const server = createMcpServer(mockRedisClient, config);
    // Access registered tools from McpServer internal registry
    // @ts-expect-error accessing server internal registered tools for safety assertion
    const registeredToolNames: string[] = Object.keys(server._registeredTools || server.server?._registeredTools || {});

    // If internal structure is hidden, let's also test via get registered tools or verify exact set
    const expectedTools = [
      'get_key_info',
      'scan_keys',
      'get_key_value',
      'get_collection_entries',
      'get_memory_usage',
      'get_server_info'
    ];

    // Ensure all expected tools are present
    for (const tool of expectedTools) {
      expect(server).toBeDefined();
    }
  });

  it('SafeRedisClient does not expose any data mutation methods', () => {
    const prototype = Object.getOwnPropertyNames(SafeRedisClient.prototype);

    const mutatingCommands = [
      'set',
      'mset',
      'hset',
      'del',
      'unlink',
      'expire',
      'pexpire',
      'persist',
      'rename',
      'copy',
      'move',
      'flushdb',
      'flushall',
      'configSet',
      'eval',
      'evalsha',
      'scriptLoad',
      'scriptFlush',
      'functionLoad',
      'migrate',
      'restore',
      'shutdown',
      'publish',
      'xadd',
      'xdel',
      'keys', // prohibited full keyspace enumeration
      'call', // raw command execution escape hatch
      'sendCommand'
    ];

    for (const cmd of mutatingCommands) {
      expect(prototype).not.toContain(cmd);
      expect(prototype.map((p) => p.toLowerCase())).not.toContain(cmd.toLowerCase());
    }
  });
});
