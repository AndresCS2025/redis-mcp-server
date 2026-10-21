# Configuration Reference

The `redis-mcp-server` is configured primarily through environment variables. This document defines all available configuration options, connection URL schemes, and MCP client connection templates.

---

## Environment Variables

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `REDIS_URL` | string | `redis://127.0.0.1:6379/0` | Target Redis connection URL (`redis://` or `rediss://`). |
| `MCP_PORT` | number | `3000` | HTTP port for `/mcp` and `/health` endpoints (1–65535). |
| `MCP_HOST` | string | `127.0.0.1` | Network interface binding address (`0.0.0.0` in container). |
| `MCP_TRANSPORT` | string | `http` | Default transport mode: `http` or `stdio`. |
| `REDIS_CONNECTION_TIMEOUT_MS` | number | `5000` | Timeout in milliseconds for establishing Redis connections (100–60000). |
| `REDIS_COMMAND_TIMEOUT_MS` | number | `3000` | Timeout in milliseconds for individual Redis commands (100–60000). |
| `REDIS_MAX_SCAN_COUNT` | number | `100` | Maximum work hint passed to Redis `SCAN` operations (1–10000). |
| `REDIS_MAX_RESULTS` | number | `100` | Maximum collection entries returned by `get_collection_entries` (1–10000). |
| `REDIS_MAX_VALUE_BYTES` | number | `65536` | Maximum raw bytes (64 KB default, up to 10 MB) returned by `get_key_value`. |
| `REDIS_METADATA_ENABLED` | boolean | `true` | Include operation timing, execution metadata, and latency disclaimers. |
| `REDIS_METADATA_LEVEL` | enum | `standard` | Metadata verbosity: `minimal`, `standard`, or `detailed`. |
| `REDIS_TLS_CA_PATH` | string | *(none)* | Absolute filesystem path to a custom Certificate Authority (CA) bundle. |
| `REDIS_TLS_CERT_PATH` | string | *(none)* | Absolute filesystem path to a client TLS certificate. |
| `REDIS_TLS_KEY_PATH` | string | *(none)* | Absolute filesystem path to a client TLS private key. |
| `REDIS_TLS_REJECT_UNAUTHORIZED`| boolean | `true` | Enforce strict TLS certificate verification. **Do not disable in production.** |

---

## Connection URL Formats

### Standard TCP (`redis://`)
```text
redis://127.0.0.1:6379/0
redis://<username>:<password>@<host>:<port>/<db>
```

### Encrypted TLS (`rediss://`)
```text
rediss://<host>:6380/0
rediss://<username>:<password>@<host>:<port>/<db>
```

When using `rediss://`, the server automatically enables TLS certificate validation using Node.js's default trusted root certificate store unless custom CA paths are configured via `REDIS_TLS_CA_PATH`.

---

## MCP Client Configuration

> **Security Warning**: Never commit an MCP client configuration containing real Redis credentials, production endpoints, or private certificate paths into version control.

### 1. Local Process (STDIO Transport - Local Redis)

Recommended for local developer workstations using a standalone Redis instance:

```json
{
  "mcpServers": {
    "redis-local": {
      "command": "node",
      "args": [
        "<absolute-path-to-redis-mcp-server>/dist/index.js",
        "--stdio"
      ],
      "env": {
        "REDIS_URL": "redis://127.0.0.1:6379/0"
      }
    }
  }
}
```

### 2. Local Process (STDIO Transport - Managed Redis TLS)

For connecting to managed cloud Redis instances requiring authentication and custom TLS certificates:

```json
{
  "mcpServers": {
    "redis-tls": {
      "command": "node",
      "args": [
        "<absolute-path-to-redis-mcp-server>/dist/index.js",
        "--stdio"
      ],
      "env": {
        "REDIS_URL": "rediss://<username>:<password>@<redis-host>:<port>/<db>",
        "REDIS_TLS_CA_PATH": "<absolute-path-to-ca-cert>/ca.pem",
        "REDIS_TLS_REJECT_UNAUTHORIZED": "true",
        "REDIS_COMMAND_TIMEOUT_MS": "3000"
      }
    }
  }
}
```

### 3. Remote / Container HTTP Streamable Transport

When running `redis-mcp-server` as a containerized service or shared diagnostic endpoint:

```json
{
  "mcpServers": {
    "redis-http": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

---

## Next Steps

- For details on the available diagnostic tools, see [Tools Reference](tools.md).
- For Redis ACL setup and permission templates, see [Security & ACLs](security.md).
