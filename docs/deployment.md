# Deployment & Operations Guide

This guide covers building, running, containerizing, and monitoring `redis-mcp-server` across local and production environments.

---

## 1. Running as a Node.js Process

### Prerequisites
- Node.js `>=20.0.0`
- npm `>=10.0.0`

### Build & Run
```bash
# Install dependencies
npm ci

# Compile TypeScript
npm run build

# Start HTTP server on port 3000 (default)
npm start

# Or start in STDIO mode
node dist/index.js --stdio
```

---

## 2. Running with Docker or Podman

The repository includes a multi-stage `Dockerfile` creating a lightweight, non-root runtime container based on `node:22-alpine`.

### Build Container Image
```bash
# With Podman
podman build -t redis-mcp-server:latest .

# With Docker
docker build -t redis-mcp-server:latest .
```

### Run Container
```bash
podman run -d \
  --name redis-mcp-server \
  -p 127.0.0.1:3000:3000 \
  -e REDIS_URL=redis://<username>:<password>@<redis-host>:6379/0 \
  -e MCP_HOST=0.0.0.0 \
  redis-mcp-server:latest
```

*Note: Inside the container, `MCP_HOST=0.0.0.0` allows the container runtime to bind to port 3000, while host port mapping (`-p 127.0.0.1:3000:3000`) restricts external host accessibility.*

### Running with Compose
A sample `compose.yml` is provided for running alongside a disposable test Redis instance:
```bash
podman compose up -d
# or: docker compose up -d
```

---

## 3. Health Endpoint & Monitoring

The HTTP server exposes a `/health` endpoint for monitoring server status and target Redis connectivity:

```bash
curl -s http://127.0.0.1:3000/health | jq .
```

### Response Statuses

#### Healthy (HTTP 200)
Returned when the MCP process is running and the target Redis instance responds to `PING`:
```json
{
  "status": "healthy",
  "service": "redis-mcp-server",
  "version": "1.0.0",
  "timestamp": "2026-10-21T20:00:00.000Z",
  "redis": {
    "healthy": true,
    "status": "connected",
    "latencyMs": 2,
    "target": {
      "host": "127.0.0.1",
      "port": 6379,
      "db": 0,
      "isTls": false
    }
  }
}
```

#### Degraded (HTTP 503)
Returned when the MCP process is healthy but the target Redis instance is disconnected or unreachable:
```json
{
  "status": "degraded",
  "service": "redis-mcp-server",
  "version": "1.0.0",
  "timestamp": "2026-10-21T20:00:00.000Z",
  "redis": {
    "healthy": false,
    "status": "error",
    "target": {
      "host": "127.0.0.1",
      "port": 6379,
      "db": 0,
      "isTls": false
    },
    "error": "connect ECONNREFUSED 127.0.0.1:6379"
  }
}
```

---

## 4. Production Security Recommendations

1. **Always Use Encrypted Connections (`rediss://`)**: Protect cache data in transit across networks.
2. **Dedicated Redis ACL User**: Provision an unprivileged read-only ACL user following the [Security Guide](security.md).
3. **Secret Management**: Inject credentials via environment variables from a vault system (e.g., HashiCorp Vault, IBM Key Protect). Never hardcode credentials in configuration files.
4. **Network Isolation**: When running in HTTP mode across hosts, protect the `/mcp` and `/health` endpoints using firewall rules, mutual TLS (mTLS), or VPN boundaries.
5. **Non-Root Runtime**: The container runs under non-root UID `1001` (`node`) by default.
