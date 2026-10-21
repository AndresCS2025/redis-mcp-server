import express, { type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ServerConfig } from './config/redis-config.js';
import type { SafeRedisClient } from './redis/redis-client.js';
import { formatToolError } from './errors/error-handler.js';
import {
  getKeyInfoSchema,
  scanKeysSchema,
  getKeyValueSchema,
  getCollectionEntriesSchema,
  getMemoryUsageSchema,
  getServerInfoSchema
} from './schemas/tool-schemas.js';
import { handleGetKeyInfo } from './tools/get-key-info.js';
import { handleScanKeys } from './tools/scan-keys.js';
import { handleGetKeyValue } from './tools/get-key-value.js';
import { handleGetCollectionEntries } from './tools/get-collection-entries.js';
import { handleGetMemoryUsage } from './tools/get-memory-usage.js';
import { handleGetServerInfo } from './tools/get-server-info.js';

export function createMcpServer(redisClient: SafeRedisClient, config: ServerConfig): McpServer {
  const server = new McpServer({
    name: 'redis-mcp-server',
    version: '1.0.0'
  });

  // 1. get_key_info
  server.registerTool(
    'get_key_info',
    {
      description:
        'Inspect key metadata (existence, type, TTL/PTTL, memory usage, encoding) without reading the full value.',
      inputSchema: getKeyInfoSchema
    },
    async (params) => {
      try {
        const result = await handleGetKeyInfo(params, redisClient, config);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify(formatToolError(error), null, 2) }],
          isError: true
        };
      }
    }
  );

  // 2. scan_keys
  server.registerTool(
    'scan_keys',
    {
      description:
        'Find keys safely using single-step cursor-based SCAN with a required non-empty pattern and bounded limits. Never uses KEYS.',
      inputSchema: scanKeysSchema
    },
    async (params) => {
      try {
        const result = await handleScanKeys(params, redisClient, config);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify(formatToolError(error), null, 2) }],
          isError: true
        };
      }
    }
  );

  // 3. get_key_value
  server.registerTool(
    'get_key_value',
    {
      description:
        'Read a Redis string key safely with bounded byte limits. Rejects collection types with an actionable type mismatch.',
      inputSchema: getKeyValueSchema
    },
    async (params) => {
      try {
        const result = await handleGetKeyValue(params, redisClient, config);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify(formatToolError(error), null, 2) }],
          isError: true
        };
      }
    }
  );

  // 4. get_collection_entries
  server.registerTool(
    'get_collection_entries',
    {
      description:
        'Read a bounded subset of a Redis collection (hash via HSCAN, list via bounded LRANGE, set via SSCAN, sorted set via ZRANGE/ZSCAN with scores).',
      inputSchema: getCollectionEntriesSchema
    },
    async (params) => {
      try {
        const result = await handleGetCollectionEntries(params, redisClient, config);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify(formatToolError(error), null, 2) }],
          isError: true
        };
      }
    }
  );

  // 5. get_memory_usage
  server.registerTool(
    'get_memory_usage',
    {
      description:
        'Inspect the approximate memory consumed by a specific key using MEMORY USAGE with optional bounded sampling.',
      inputSchema: getMemoryUsageSchema
    },
    async (params) => {
      try {
        const result = await handleGetMemoryUsage(params, redisClient, config);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify(formatToolError(error), null, 2) }],
          isError: true
        };
      }
    }
  );

  // 6. get_server_info
  server.registerTool(
    'get_server_info',
    {
      description:
        'Return a safe, structured subset of Redis INFO data (allowlisted sections: server, clients, memory, stats, keyspace, replication). Never exposes credentials or configs.',
      inputSchema: getServerInfoSchema
    },
    async (params) => {
      try {
        const result = await handleGetServerInfo(params, redisClient, config);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify(formatToolError(error), null, 2) }],
          isError: true
        };
      }
    }
  );

  return server;
}

export function createHttpApp(
  redisClient: SafeRedisClient,
  config: ServerConfig
): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Health endpoint: does not leak credentials, returns fast health diagnostics
  app.get('/health', async (_req: Request, res: Response) => {
    try {
      const redisHealth = await redisClient.checkHealth();
      const status = redisHealth.healthy ? 'healthy' : 'degraded';
      const statusCode = redisHealth.healthy ? 200 : 503;

      res.status(statusCode).json({
        status,
        service: 'redis-mcp-server',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        redis: redisHealth
      });
    } catch (err) {
      res.status(503).json({
        status: 'unhealthy',
        service: 'redis-mcp-server',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err)
      });
    }
  });

  // MCP Streamable HTTP endpoint (stateless)
  app.post('/mcp', async (req: Request, res: Response) => {
    try {
      const server = createMcpServer(redisClient, config);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[MCP HTTP] Error handling request:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error'
          },
          id: null
        });
      }
    }
  });

  app.get('/mcp', async (req: Request, res: Response) => {
    try {
      const server = createMcpServer(redisClient, config);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error('[MCP HTTP] Error handling GET request:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to handle MCP stream' });
      }
    }
  });

  return app;
}

export async function runStdioServer(redisClient: SafeRedisClient, config: ServerConfig): Promise<void> {
  const mcpServer = createMcpServer(redisClient, config);
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error('[redis-mcp-server] Running in STDIO mode');
}
