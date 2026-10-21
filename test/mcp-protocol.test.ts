import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadConfig } from '../src/config/redis-config.js';
import { SafeRedisClient } from '../src/redis/redis-client.js';
import { createMcpServer, createHttpApp } from '../src/server.js';

describe('MCP Protocol & Streamable HTTP Integration (Stateless Mode)', () => {
  let httpServer: Server;
  let serverUrl: string;
  let redisClient: SafeRedisClient;
  const config = loadConfig({ REDIS_URL: 'redis://127.0.0.1:6379/0' });

  beforeAll(async () => {
    redisClient = new SafeRedisClient(config);

    // Mock Redis read operations for safe protocol testing
    vi.spyOn(redisClient, 'checkHealth').mockResolvedValue({
      healthy: true,
      status: 'connected',
      latencyMs: 1,
      target: { host: '127.0.0.1', port: 6379, db: 0, isTls: false }
    });
    vi.spyOn(redisClient, 'exists').mockResolvedValue(true);
    vi.spyOn(redisClient, 'type').mockResolvedValue('string');
    vi.spyOn(redisClient, 'ttl').mockResolvedValue(600);
    vi.spyOn(redisClient, 'pttl').mockResolvedValue(600000);
    vi.spyOn(redisClient, 'memoryUsage').mockResolvedValue(128);
    vi.spyOn(redisClient, 'objectEncoding').mockResolvedValue('embstr');

    const app = createHttpApp(redisClient, config);

    // Bind to ephemeral port on localhost
    await new Promise<void>((resolve) => {
      httpServer = app.listen(0, '127.0.0.1', () => {
        const address = httpServer.address();
        if (address && typeof address === 'object') {
          serverUrl = `http://127.0.0.1:${address.port}/mcp`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (httpServer) {
        httpServer.close(() => resolve());
      } else {
        resolve();
      }
    });
  });

  it('successfully initializes client and completes protocol handshake over Streamable HTTP without session ID', async () => {
    const client = new Client({ name: 'test-mcp-client', version: '1.0.0' }, { capabilities: {} });
    const clientTransport = new StreamableHTTPClientTransport(new URL(serverUrl));

    await client.connect(clientTransport);
    expect(client.getServerVersion()).toEqual({ name: 'redis-mcp-server', version: '1.0.0' });

    await client.close();
  });

  it('lists exactly the expected 6 read-only MCP tools', async () => {
    const client = new Client({ name: 'test-mcp-client', version: '1.0.0' }, { capabilities: {} });
    const clientTransport = new StreamableHTTPClientTransport(new URL(serverUrl));

    await client.connect(clientTransport);

    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map((t) => t.name).sort();

    const expectedTools = [
      'get_collection_entries',
      'get_key_info',
      'get_key_value',
      'get_memory_usage',
      'get_server_info',
      'scan_keys'
    ].sort();

    expect(toolNames).toEqual(expectedTools);
    expect(toolsResult.tools.length).toBe(6);

    await client.close();
  });

  it('successfully executes a tool invocation over Streamable HTTP', async () => {
    const client = new Client({ name: 'test-mcp-client', version: '1.0.0' }, { capabilities: {} });
    const clientTransport = new StreamableHTTPClientTransport(new URL(serverUrl));

    await client.connect(clientTransport);

    const callResult = await client.callTool({
      name: 'get_key_info',
      arguments: { key: 'test:cache:session' }
    });

    expect(callResult.isError).toBeFalsy();
    expect(callResult.content).toBeDefined();
    expect(callResult.content.length).toBeGreaterThan(0);

    const textContent = callResult.content[0] as { type: string; text: string };
    const parsedData = JSON.parse(textContent.text);

    expect(parsedData.exists).toBe(true);
    expect(parsedData.type).toBe('string');
    expect(parsedData.ttlSeconds).toBe(600);
    expect(parsedData.key).toEqual({
      encoding: 'utf8',
      value: 'test:cache:session',
      byteLength: 18
    });

    await client.close();
  });

  it('rejects malformed tool arguments safely through Zod validation error envelope', async () => {
    const client = new Client({ name: 'test-mcp-client', version: '1.0.0' }, { capabilities: {} });
    const clientTransport = new StreamableHTTPClientTransport(new URL(serverUrl));

    await client.connect(clientTransport);

    // Call with empty key string (violates min(1) constraint)
    const callResult = await client.callTool({
      name: 'get_key_info',
      arguments: { key: '' }
    });

    expect(callResult.isError).toBe(true);
    const textContent = callResult.content[0] as { type: string; text: string };
    expect(textContent.text).toContain('validation');

    await client.close();
  });
});
