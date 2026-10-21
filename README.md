# Redis MCP Server

A secure, strictly read-only Model Context Protocol (MCP) server that lets AI assistants and other MCP clients inspect Redis state for evidence-driven cache investigations.

---

## ✨ Features

- **Read-Only by Construction**: Exposes only non-mutating inspection commands with no generic command dispatchers.
- **Safe Key Discovery**: Cursor-based single-step `SCAN` prevents event-loop blocking; `KEYS` is completely prohibited.
- **Key & Expiration Diagnostics**: Inspects key existence, Redis data type, TTL/PTTL, memory usage, and internal encoding.
- **Binary-Safe Transport**: Preserves raw Redis keys and string values losslessly using canonical Base64 or UTF-8.
- **Bounded Collection Inspection**: Inspects Hashes (`HSCAN`), Lists (`LRANGE`), Sets (`SSCAN`), and Sorted Sets (`ZRANGE`).
- **Sanitized Server Metrics**: Structured, allowlisted `INFO` metrics with sensitive credentials and configurations automatically stripped.
- **Resilient Connection Lifecycle**: Single-flight lazy reconnection automatically recovers when Redis becomes available.
- **Dual Transports**: Supports both Streamable HTTP (`/mcp`, `/health`) and standard I/O (`--stdio`).
- **Security & ACL Defense in Depth**: Complemented with dedicated least-privilege Redis ACL user templates.

*Note: Redis keys and string values are binary-safe. Collection keys are binary-safe, while collection fields, values, and members currently use UTF-8-oriented Redis APIs.*

---

## 🔧 Available Tools

| Tool | Description |
| :--- | :--- |
| [`get_key_info`](docs/tools.md#1-get_key_info) | Inspect key existence, type, TTL/PTTL, memory usage, and encoding without reading values. |
| [`scan_keys`](docs/tools.md#2-scan_keys) | Discover keys safely using single-step cursor SCAN with a required match pattern. |
| [`get_key_value`](docs/tools.md#3-get_key_value) | Read a bounded Redis string value with automatic lossless UTF-8 or Base64 encoding. |
| [`get_collection_entries`](docs/tools.md#4-get_collection_entries) | Read bounded entries from Hashes, Lists, Sets, or Sorted Sets with pagination support. |
| [`get_memory_usage`](docs/tools.md#5-get_memory_usage) | Inspect approximate RAM consumed by a specific key via `MEMORY USAGE`. |
| [`get_server_info`](docs/tools.md#6-get_server_info) | Query allowlisted, sanitized Redis server statistics (`server`, `memory`, `clients`, etc.). |

*For detailed schemas, parameter definitions, and examples, see the [Tools Reference](docs/tools.md).*

---

## 🔒 Why This MCP?

This project was created for a deliberately narrower use case than general-purpose Redis MCP servers: safe, evidence-driven Redis cache investigation.

Existing general-purpose Redis MCP implementations may expose mutation capabilities or broader operational controls. This project intentionally takes a narrower approach, exposing only bounded, read-only inspection operations.

The design prioritizes:
- **Zero Write Risk**: Mutating commands (`SET`, `DEL`, `EXPIRE`, `FLUSHDB`) are not implemented.
- **Non-Blocking Operation**: `KEYS` is prohibited in favor of bounded `SCAN`.
- **Serializer-Agnostic Evidence**: Transports exact raw bytes as evidence without requiring application-specific class decoders.
- **Strict Bounding**: Limits scan hints, collection sizes, and value byte payloads to protect client and server memory.
- **Dual-Layer Defense**: Pairs application code boundaries with server-side Redis ACL recommendations.

---

## 🚀 Quick Start

### Prerequisites
- Node.js `>=20.0.0`
- npm `>=10.0.0`
- Access to a Redis instance (defaults to `redis://127.0.0.1:6379/0`)

### Installation & Local Run
```bash
# 1. Install dependencies
npm ci

# 2. Build TypeScript
npm run build

# 3. Start the server (HTTP mode on port 3000)
npm start
```

### Verify Health
```bash
curl -s http://127.0.0.1:3000/health | jq .
```

### Running with Containers
```bash
# Build with Podman or Docker
podman build -t redis-mcp-server:latest .

# Run container
podman run -d \
  --name redis-mcp-server \
  -p 127.0.0.1:3000:3000 \
  -e REDIS_URL=redis://<username>:<password>@<redis-host>:6379/0 \
  -e MCP_HOST=0.0.0.0 \
  redis-mcp-server:latest
```

---

## ⚙️ MCP Client Configuration

> **Warning**: Never commit an MCP client configuration containing real Redis credentials, internal endpoints, or certificate paths.

### Local Process (STDIO Transport)

Add to your MCP client configuration (such as IBM Bob or Claude Desktop):

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

*For authenticated instances, custom TLS certificates, and Streamable HTTP setup, see the [Configuration Guide](docs/configuration.md).*

---

## 🛠️ Development

```bash
# Install dependencies
npm ci

# Type check
npm run typecheck

# Run test suite
npm test

# Build production bundle
npm run build

# Vulnerability scan
npm audit
```

---

## 📖 Documentation

Detailed documentation is available in the [`docs/`](docs/) directory:

- [**Documentation Overview**](docs/README.md): Full documentation index.
- [**Tools Reference**](docs/tools.md): In-depth schemas, commands, bounds, and examples for all 6 tools.
- [**Configuration Guide**](docs/configuration.md): Environment variables, URL schemes, and client setup.
- [**Security & ACLs**](docs/security.md): Read-only guarantees, Redis ACL templates, credential masking, and privacy.
- [**Binary Data & Codec**](docs/binary-data.md): Binary key handling, lossless UTF-8 detection, and Base64 transport.
- [**Architecture & Design**](docs/architecture.md): System components, transport models, and lifecycle design.
- [**Deployment Guide**](docs/deployment.md): Process execution, container builds, and operational monitoring.
- [**Testing & Verification**](docs/testing.md): Test architecture, protocol testing, and local verification.
- [**Known Limitations**](docs/known-limitations.md): Technical constraints and intentional design non-goals.

---

## 🤝 Contributing

Contributions that improve read-only diagnostics, documentation, and test coverage are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for contribution rules and development guidelines.

---

## 🔒 Security

For security vulnerability reporting procedures and commitments, see [SECURITY.md](SECURITY.md) and the [Security Guide](docs/security.md).

---

## 📄 License

This project is licensed under the [Apache-2.0 License](package.json).
