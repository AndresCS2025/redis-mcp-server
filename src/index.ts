#!/usr/bin/env node
import 'dotenv/config';
import { loadConfig, sanitizeRedisUrl } from './config/redis-config.js';
import { SafeRedisClient } from './redis/redis-client.js';
import { createHttpApp, runStdioServer } from './server.js';

async function main(): Promise<void> {
  const isStdio = process.argv.includes('--stdio') || process.env['MCP_TRANSPORT'] === 'stdio';

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error('[redis-mcp-server] Startup configuration error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const redisClient = new SafeRedisClient(config);

  // Attempt initial connection to Redis
  try {
    await redisClient.connect();
    console.error(`[redis-mcp-server] Connected to Redis target: ${sanitizeRedisUrl(config.redisUrl)}`);
  } catch (err) {
    console.error(
      `[redis-mcp-server] Warning: Initial Redis connection failed: ${err instanceof Error ? err.message : String(err)}. Server will continue and attempt reconnection on requests.`
    );
  }

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    console.error(`[redis-mcp-server] Received ${signal}. Shutting down gracefully...`);
    try {
      await redisClient.disconnect();
      console.error('[redis-mcp-server] Redis disconnected.');
    } catch (e) {
      console.error('[redis-mcp-server] Error disconnecting Redis:', e);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  if (isStdio) {
    await runStdioServer(redisClient, config);
  } else {
    const app = createHttpApp(redisClient, config);

    const server = app.listen(config.mcpPort, config.mcpHost, () => {
      console.error(
        `[redis-mcp-server] Server listening on http://${config.mcpHost}:${config.mcpPort} (MCP endpoint: /mcp, Health: /health)`
      );
    });

    server.on('error', (err) => {
      console.error('[redis-mcp-server] HTTP server error:', err.message);
      process.exit(1);
    });
  }
}

main().catch((err) => {
  console.error('[redis-mcp-server] Fatal startup failure:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
