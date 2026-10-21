import { describe, it, expect, vi } from 'vitest';
import { createHttpApp } from '../src/server.js';
import { SafeRedisClient } from '../src/redis/redis-client.js';
import { loadConfig } from '../src/config/redis-config.js';
import type { Request, Response } from 'express';

describe('HTTP & Health Endpoints', () => {
  const config = loadConfig({ REDIS_URL: 'redis://127.0.0.1:6379/0' });
  const redisClient = new SafeRedisClient(config);
  const app = createHttpApp(redisClient, config);

  it('returns healthy status when Redis check succeeds', async () => {
    vi.spyOn(redisClient, 'checkHealth').mockResolvedValue({
      healthy: true,
      status: 'connected',
      latencyMs: 2,
      target: { host: '127.0.0.1', port: 6379, db: 0, isTls: false }
    });

    const mockReq = {} as Request;
    let statusCode = 0;
    let jsonBody: Record<string, unknown> = {};

    const mockRes = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(data: Record<string, unknown>) {
        jsonBody = data;
        return this;
      }
    } as unknown as Response;

    // Trigger the /health route directly through the route stack or handler
    const healthLayer = app._router.stack.find(
      (layer: { route?: { path?: string } }) => layer.route?.path === '/health'
    );
    expect(healthLayer).toBeDefined();

    await healthLayer.route.stack[0].handle(mockReq, mockRes);

    expect(statusCode).toBe(200);
    expect(jsonBody['status']).toBe('healthy');
    expect(jsonBody['service']).toBe('redis-mcp-server');
    expect(jsonBody['redis']).toBeDefined();
  });

  it('returns degraded status (503) when Redis is disconnected', async () => {
    vi.spyOn(redisClient, 'checkHealth').mockResolvedValue({
      healthy: false,
      status: 'disconnected',
      target: { host: '127.0.0.1', port: 6379, db: 0, isTls: false },
      error: 'Connection refused'
    });

    const mockReq = {} as Request;
    let statusCode = 0;
    let jsonBody: Record<string, unknown> = {};

    const mockRes = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(data: Record<string, unknown>) {
        jsonBody = data;
        return this;
      }
    } as unknown as Response;

    const healthLayer = app._router.stack.find(
      (layer: { route?: { path?: string } }) => layer.route?.path === '/health'
    );
    await healthLayer.route.stack[0].handle(mockReq, mockRes);

    expect(statusCode).toBe(503);
    expect(jsonBody['status']).toBe('degraded');
  });
});
