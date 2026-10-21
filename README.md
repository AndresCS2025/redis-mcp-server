# Redis MCP Server (`redis-mcp-server`)

A secure, evidence-oriented, strictly **READ-ONLY** Model Context Protocol (MCP) server for inspecting Redis instances during caching investigations and diagnostics.

---

## Why This MCP?

This project was created for a deliberately narrower use case than general-purpose Redis MCP servers: safe, evidence-driven Redis cache investigation.

Existing Redis MCP implementations were evaluated before this project was built. General-purpose Redis MCP tools often include data mutation capabilities, administrative commands, or raw command escape hatches. In contrast, this server intentionally exposes only bounded, read-only inspection operations.

The design prioritizes:
- **Read-only by construction**: No mutating or administrative Redis commands exist in the codebase.
- **Cursor SCAN instead of KEYS**: Prohibits blocking full-keyspace enumerations (`KEYS *`).
- **Targeted cache diagnostics**: Inspects TTL, data type, approximate memory usage, collection cardinality, and allowlisted server statistics.
- **Binary-safe key and string-value transport**: Preserves exact byte sequences losslessly using canonical Base64 or UTF-8.
- **Bounded operations**: Enforces hard limits on scan hints, collection sizes, and value byte payloads.
- **No raw Redis command execution**: Eliminates dynamic command dispatch and raw command injection risks.
- **Redis ACL defense in depth**: Complements application-level guards with recommended minimal Redis ACL configurations.

The goal is not to replace every general-purpose Redis MCP implementation, but to provide a smaller, intentionally restrictive, and secure surface for investigation-oriented MCP workflows.

---

## 1. Purpose and Strict Read-Only Scope

The `redis-mcp-server` provides AI coding assistants (such as IBM Bob) with safe visibility into Redis state to compare application cache expectations against actual Redis contents:

- **Application Expectations**: Cache key format, expected Redis data type, expected payload structure, configured TTL/PTTL, cache population, and invalidation logic.
- **Actual Redis State**: Key existence, actual Redis data type, active TTL/PTTL, stored payload, collection cardinality, approximate memory usage, and bounded server diagnostics.

### Strict Scope
- **Inspection Only**: Reads key metadata, keyspace slices, string values, collection entries, memory statistics, and allowlisted server info.
- **No Mutations**: Does not write, modify, flush, evict, rename, or configure Redis in any way.
- **No Optimization**: Does not attempt automatic cache optimization or remediation.
- **Binary-Safe Transport (v1.0.0 Baseline)**: Binary-safe Redis keys and string values. Collection keys are binary-safe, while collection fields, values, and members currently use UTF-8-oriented Redis APIs.

---

## 2. Architecture Overview

```
┌──────────────┐         HTTP (/mcp) or STDIO          ┌───────────────────────────┐
│              │ ────────────────────────────────────► │     redis-mcp-server      │
│   MCP Client │                                       │ ───────────────────────── │
│  (e.g., Bob) │ ◄──────────────────────────────────── │ 1. Binary-Safe Key Codec  │
└──────────────┘           JSON-RPC Responses          │ 2. Zod Schema Validation  │
                                                       │ 3. Read-Only Boundaries   │
                                                       │ 4. Output Bounding & Mask │
                                                       │ 5. SafeRedisClient        │
                                                       └─────────────┬─────────────┘
                                                                     │ ioredis (Read-Only)
                                                                     ▼
                                                       ┌───────────────────────────┐
                                                       │       Target Redis        │
                                                       │ (Standalone / TLS / Cloud)│
                                                       └───────────────────────────┘
```

The server is built with:
- **TypeScript & Node.js 20+**: Strict type safety (`NodeNext`) and ES Modules (runtime container image uses Node.js 22-alpine).
- **Official Model Context Protocol SDK (`@modelcontextprotocol/sdk`)**: Standardized tool registration with streamable HTTP and STDIO transports.
- **`ioredis`**: Robust connection management, single-flight lazy reconnection, buffer-based commands (`scanBuffer`, `getBuffer`), and TLS support.
- **`zod`**: Strict input validation at tool boundaries.
- **Express**: Exposing `/mcp` (Streamable HTTP) and `/health` (Healthcheck) endpoints.

---

## 3. Serializer-Agnostic Design

Redis stores keys and values as arbitrary byte sequences. `redis-mcp-server` is completely **serializer-agnostic**:

- **No Application Assumptions**: The server makes no assumptions about specific serialization frameworks (such as Spring Cache `RedisTemplate`, Java `ObjectInputStream`, Python `pickle`, MessagePack, or Protocol Buffers).
- **Raw Byte Preservation**: When bytes can be losslessly represented as UTF-8, they are returned as UTF-8 strings. When bytes contain non-UTF-8 or arbitrary binary sequences, they are encoded as canonical Base64.
- **Evidence Transport Only**: Base64 transport means the MCP preserves and returns the exact stored bytes as diagnostic evidence; it does not perform semantic deserialization into application classes.

---

## 4. Binary Key Model & Cross-Tool Transport

All key-consuming tools (`get_key_info`, `get_key_value`, `get_collection_entries`, `get_memory_usage`) accept both legacy string keys and structured encoded keys:

### Key Input Formats

1. **Legacy String**:
   ```json
   "cache:session:1001"
   ```
2. **Structured UTF-8**:
   ```json
   {
     "encoding": "utf8",
     "value": "cache:session:1001"
   }
   ```
3. **Structured Base64 (for Binary / Serialized Keys)**:
   ```json
   {
     "encoding": "base64",
     "value": "rO0ABXQAEHNhbXBsZTprZXk6MTAwMQ=="
   }
   ```

### Key Output Format

Discovered keys from `scan_keys` and key references in tool responses are returned with exact byte lengths and encoding tags:

- **Lossless UTF-8**:
   ```json
   {
     "encoding": "utf8",
     "value": "cache:session:1001",
     "byteLength": 18
   }
   ```
- **Binary / Non-UTF-8**:
   ```json
   {
     "encoding": "base64",
     "value": "rO0ABXQAEHNhbXBsZTprZXk6MTAwMQ==",
     "byteLength": 24
   }
   ```

---

## 5. V1 Feature Summary

### Included Capabilities
- **`get_key_info`**: Metadata inspection (existence, data type, TTL/PTTL, approximate memory, object encoding).
- **`scan_keys`**: Safe, single-step cursor-based key discovery with required pattern matching.
- **`get_key_value`**: Bounded string value retrieval with lossless UTF-8 / Base64 fallback.
- **`get_collection_entries`**: Bounded reads for Hashes (`HSCAN`), Lists (`LRANGE`), Sets (`SSCAN`), and Sorted Sets (`ZRANGE` with scores).
- **`get_memory_usage`**: Key memory diagnostics via `MEMORY USAGE` with optional sampling.
- **`get_server_info`**: Allowlisted, sanitized Redis `INFO` section queries (`server`, `clients`, `memory`, `stats`, `keyspace`, `replication`).
- **Binary Safety**: Binary-safe Redis keys and string values. Collection keys are binary-safe.
- **Network & TLS**: Support for `redis://` and `rediss://` with custom CA certificate paths.
- **Resilience**: Single-flight lazy reconnection when Redis starts or recovers after MCP server boot.
- **Dual Transports**: Streamable HTTP (`/mcp`, `/health`) and STDIO (`--stdio`).

### Strictly Excluded
- Data modification commands (`SET`, `HSET`, `DEL`, `EXPIRE`, `FLUSHDB`, etc.).
- Prohibited key enumeration (`KEYS`, `KEYS *`).
- Dynamic command evaluation (`execute_redis_command`, `EVAL`, `call`).
- Application-specific semantic deserialization.

---

## 6. Exact Tools and Inputs/Outputs

### 1. `get_key_info`
Inspect key metadata without reading the full value.
- **Input**:
  - `key` (*string or structured key object, required*): The Redis key to inspect.
- **Output**:
  - `key`: Encoded key descriptor (`{ encoding, value, byteLength }`).
  - `exists`: `true` if key exists, `false` otherwise.
  - `type`: Redis data type (`string`, `hash`, `list`, `set`, `zset`, `stream`, or `none`).
  - `ttlSeconds`: TTL in seconds (`-2` = missing/expired, `-1` = persistent/no expiry, `>0` = seconds remaining).
  - `pttlMilliseconds`: TTL in milliseconds (`-2`, `-1`, or `>0`).
  - `hasExpiration`: `true` if TTL > 0.
  - `memoryUsageBytes`: Approximate memory in bytes (if available/permitted).
  - `objectEncoding`: Internal Redis object encoding.
  - `metadata`: Diagnostic metadata.

### 2. `scan_keys`
Safely discover keys matching a pattern using single-step cursor-based `scanBuffer`.
- **Input**:
  - `pattern` (*string, required*): Match pattern (e.g. `cache:*`, `session:*`, `*`). `*` is technically supported but remains single-step and cursor-based.
  - `cursor` (*string, optional, default: `"0"`*): Current cursor position. Pass `"0"` to start.
  - `count` (*number, optional*): Work hint for SCAN (clamped to `REDIS_MAX_SCAN_COUNT`).
  - `limit` (*number, optional*): Deprecated alias for `count`. `limit` is retained for backward compatibility and acts as an alias for the Redis SCAN COUNT work hint. It is not a guaranteed upper bound on the number of keys returned by a cursor step.
- **Single-Step Semantics & Key Preservation**:
  - Executes exactly **one** Redis SCAN step per MCP call.
  - In Redis, `COUNT` is a work hint (keyspace slots evaluated), not an exact limit. To prevent permanent key loss from the cursor stream, all keys returned by Redis for that step are preserved and returned.
  - Returns `nextCursor` exactly as returned by Redis. Pass `nextCursor` in subsequent calls to continue scanning.
- **Output**:
  - `pattern`: Requested pattern.
  - `keys`: Array of encoded keys (`EncodedKeyOutput[]`).
  - `returnedCount`: Number of returned keys for this step.
  - `nextCursor`: Next cursor to pass for pagination (`"0"` indicates scan complete).
  - `completed`: `true` if scan completed for this cursor sequence (`nextCursor === "0"`).
  - `truncated`: `false` (all keys returned by Redis for the cursor step are preserved).
  - `metadata`: Diagnostic metadata.

### 3. `get_key_value`
Safely read a Redis string key with bounded byte limits and binary-safe encoding.
- **Input**:
  - `key` (*string or structured key object, required*): Key to read.
  - `maxBytes` (*number, optional*): Maximum bytes to return (clamped to `REDIS_MAX_VALUE_BYTES`).
- **Output**:
  - `key`: Encoded key descriptor.
  - `exists`: Key existence.
  - `type`: Must be `"string"` (other types return structured `TYPE_MISMATCH` error).
  - `encoding`: `"utf8"` if payload is valid UTF-8, `"base64"` otherwise.
  - `value`: UTF-8 text or Base64 string payload.
  - `originalByteLength`: Total size of stored value in raw bytes.
  - `returnedByteLength`: Actual bytes returned (respecting `maxBytes`).
  - `truncated`: `true` if payload was sliced to respect `maxBytes`.
  - `detectedFormat`: `"utf8"`, `"java-serialization"`, or `"binary"`.
  - `metadata`: Diagnostic metadata.

### 4. `get_collection_entries`
Read a bounded subset of a Redis collection structure.
- **Input**:
  - `key` (*string or structured key object, required*): Collection key name (binary-safe `KeyInput`).
  - `cursor` (*string, optional, default: `"0"`*): Cursor for `HSCAN` / `SSCAN`.
  - `offset` (*number, optional, default: `0`*): Index offset for `LRANGE` / `ZRANGE`.
  - `limit` (*number, optional*): Maximum entries to return (clamped to `REDIS_MAX_RESULTS`).
- **Supported Types & Behavior**:
  - `hash`: Uses `HSCAN` and returns `[{ field: string, value: string }]`.
  - `list`: Uses bounded `LRANGE` and returns `string[]`.
  - `set`: Uses `SSCAN` and returns `string[]`.
  - `zset`: Uses bounded `ZRANGE ... WITHSCORES` and returns `[{ member: string, score: number }]`.
  - *Note*: While collection **keys** are binary-safe (`KeyInput`), collection **fields, values, and members** currently use UTF-8-oriented Redis commands.
- **Output**:
  - `key`: Encoded key descriptor.
  - `exists`: Key existence.
  - `type`: Collection type.
  - `cardinality`: Total item count in collection.
  - `entries`: Array of bounded collection items.
  - `nextCursor`: Next cursor for hashes/sets (or `null`).
  - `offset`: Offset for lists/sorted sets.
  - `hasMore`: `true` if more entries remain.
  - `metadata`: Diagnostic metadata.

### 5. `get_memory_usage`
Inspect the approximate memory consumed by a key using `MEMORY USAGE`.
- **Input**:
  - `key` (*string or structured key object, required*): Key to inspect.
  - `samples` (*number, optional, 0-100*): Sample count for nested structures.
- **Output**:
  - `key`: Encoded key descriptor.
  - `exists`: Key existence.
  - `memoryUsageBytes`: Approximate bytes (or `null` if disabled/unsupported).
  - `supported`: `true` if Redis command succeeded.
  - `metadata`: Diagnostic metadata.

### 6. `get_server_info`
Inspect structured, sanitized Redis server statistics.
- **Input**:
  - `section` (*enum, optional, default: `"memory"`*): One of `server`, `clients`, `memory`, `stats`, `keyspace`, `replication`.
- **Output**:
  - `section`: Requested section.
  - `fields`: Structured key-value statistics.
  - `metadata`: Diagnostic metadata.

---

## 7. Unsupported Operations

The following commands and patterns are strictly prohibited and **not implemented**:
- **Mutations**: `SET`, `MSET`, `HSET`, `DEL`, `UNLINK`, `EXPIRE`, `PEXPIRE`, `PERSIST`, `RENAME`, `FLUSHDB`, `FLUSHALL`.
- **Configuration & Scripting**: `CONFIG SET`, `EVAL`, `EVALSHA`, `SCRIPT LOAD`, `FUNCTION LOAD`, `SHUTDOWN`.
- **Unbounded Key Enumeration**: `KEYS`, `KEYS *`.
- **Arbitrary Command Execution**: There is **no** `execute_redis_command`, raw command passthrough, or dynamic command invocation tool.

---

## 8. Security Model

1. **Read-Only by Construction**: The Redis client wrapper defines explicit read-only methods and does not expose dynamic command dispatch.
2. **Credential Sanitization**: Passwords, tokens, and connection strings are masked across logs, errors, health responses, and tool outputs (`redis://user:***@host:port/db`).
3. **Binary Key Safety**: Non-printable and binary keys are summarized in error messages and logs using a safe digest label (`binary-key:<hash> (N bytes)`), avoiding terminal escape sequence injection or log corruption.
4. **Bounded Operations**: Hard clamps on scan count hints (`REDIS_MAX_SCAN_COUNT`), list/collection result limits (`REDIS_MAX_RESULTS`), string payload byte limits (`REDIS_MAX_VALUE_BYTES`), and command execution timeouts (`REDIS_COMMAND_TIMEOUT_MS`) protect Redis and Node.js resources.
5. **Non-Root Execution**: Container images run as standard non-root user `node` (`1001`), with no elevated privileges.
6. **No Stack Trace Leaks**: Internal stack traces and raw system errors are translated into sanitized, structured error codes.

---

## 9. Data Privacy

When investigating caching environments with an AI coding assistant, observe the following privacy considerations:
- **Identifier Keys**: Redis keys may contain identifiers (e.g. usernames, session tokens, IDs).
- **Sensitive Payloads**: Cached values may contain sensitive application state, internal schemas, or customer data.
- **Transcript Retention**: MCP request parameters and client transcripts may record exact keys or returned payload bytes. Sanitized server logs do not make client-side transcripts non-sensitive.
- **Prefer Metadata Operations**: Use `get_key_info` and `get_memory_usage` when TTL, key existence, type, or memory answers the investigative question without inspecting full value payloads.
- **Data Governance**: Apply your organization's data-handling and retention policies to AI client transcripts. Do not include cached payloads in bug reports unless properly sanitized.

---

## 10. Redis ACL Configuration & Command Mapping

While `redis-mcp-server` is strictly read-only in application code, application-level restrictions **do not replace Redis server-side ACLs**. Adopting teams should provision a dedicated, read-only Redis ACL user.

### Tool-to-Command Mapping Matrix

| MCP Tool | Underlying Redis Commands Invoked | Minimum Required Redis ACL Command Permissions |
|---|---|---|
| `get_key_info` | `EXISTS`, `TYPE`, `TTL`, `PTTL`, `MEMORY USAGE`, `OBJECT ENCODING` | `+exists +type +ttl +pttl '+memory|usage' '+object|encoding'` |
| `scan_keys` | `SCAN` (`scanBuffer`) | `+scan` |
| `get_key_value` | `TYPE`, `GET` (`getBuffer`) | `+type +get` |
| `get_collection_entries` | `TYPE`, `HLEN`, `HSCAN`, `LLEN`, `LRANGE`, `SCARD`, `SSCAN`, `ZCARD`, `ZRANGE` | `+type +hlen +hscan +llen +lrange +scard +sscan +zcard +zrange` |
| `get_memory_usage` | `EXISTS`, `MEMORY USAGE` | `+exists '+memory|usage'` |
| `get_server_info` | `INFO` | `+info` |
| Health / Readiness | `PING` | `+ping` |

### Important ACL Construction Rules

1. **`reset` Must Be the First Rule**: Redis ACL rules are evaluated strictly from **left to right**. The `reset` rule resets the user to an initial disabled state (clearing passwords, keys, and commands). If `reset` is placed after `on` or password definitions, it will wipe them out.
2. **Quote Special Rule Tokens**: When creating users via `redis-cli`, quote rule tokens like `'>PASSWORD'`, `'+memory|usage'`, and `'+object|encoding'` to prevent shell redirection (`>`) or pipeline (`|`) interpretation.
3. **Credential Management**: Do not commit real passwords. Generate credentials via your team's approved secret-management process (e.g., HashiCorp Vault, IBM Key Protect).
4. **Verify Provider Compatibility**: Subcommands like `memory|usage` and `object|encoding` may vary depending on Redis version and managed Redis provider restrictions.

### Option A: Explicit Least-Privilege Allowlist (Recommended)

```bash
# Template: Replace REPLACE_WITH_GENERATED_SECRET with your generated password
redis-cli ACL SETUSER mcp_reader reset on '>REPLACE_WITH_GENERATED_SECRET' ~* \
  +ping +info +exists +type +ttl +pttl +scan +get \
  +hlen +hscan +llen +lrange +scard +sscan +zcard +zrange \
  '+memory|usage' '+object|encoding'
```

### Option B: Category-Based Allowlist

Command categories provide a broader approach, though command categories can vary across Redis versions and should be verified on your target cluster:

```bash
# Template: Category-based read-only user
redis-cli ACL SETUSER mcp_reader reset on '>REPLACE_WITH_GENERATED_SECRET' ~* \
  +@read +info +ping '+memory|usage' '+object|encoding' \
  -keys -@write -@admin -@dangerous
```

---

## 11. Configuration Reference

Configure using environment variables:

| Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | `redis://127.0.0.1:6379/0` | Target Redis URL (`redis://` or `rediss://`). |
| `MCP_PORT` | `3000` | HTTP port for `/mcp` and `/health`. |
| `MCP_HOST` | `127.0.0.1` | Network interface binding (`0.0.0.0` in container). |
| `MCP_TRANSPORT` | `http` | Transport mode: `http` or `stdio`. |
| `REDIS_CONNECTION_TIMEOUT_MS` | `5000` | Connection timeout in milliseconds. |
| `REDIS_COMMAND_TIMEOUT_MS` | `3000` | Individual command execution timeout in milliseconds. |
| `REDIS_MAX_SCAN_COUNT` | `100` | Upper limit hint for `scan_keys` iterations. |
| `REDIS_MAX_RESULTS` | `100` | Upper limit on collection items returned per request. |
| `REDIS_MAX_VALUE_BYTES` | `65536` | Maximum payload bytes (64 KB) returned by `get_key_value`. |
| `REDIS_METADATA_ENABLED` | `true` | Include execution timing and diagnostic notes. |
| `REDIS_METADATA_LEVEL` | `standard` | Metadata verbosity: `minimal`, `standard`, `detailed`. |
| `REDIS_TLS_CA_PATH` | *(none)* | Path to custom CA certificate file. |
| `REDIS_TLS_CERT_PATH` | *(none)* | Path to client TLS certificate file. |
| `REDIS_TLS_KEY_PATH` | *(none)* | Path to client TLS private key file. |
| `REDIS_TLS_REJECT_UNAUTHORIZED` | `true` | Require valid TLS certificates (never disable in production). |

---

## 12. TLS Configuration

To connect via TLS, use the `rediss://` scheme:

```bash
REDIS_URL=rediss://mcp_reader:REPLACE_WITH_GENERATED_SECRET@redis.example.com:6380/0
```

For private CA certificates:
```bash
REDIS_TLS_CA_PATH=/etc/ssl/certs/redis-ca.pem
REDIS_TLS_REJECT_UNAUTHORIZED=true
```

---

## 13. Docker and Podman Startup Commands

### Build Image
```bash
podman build -t redis-mcp-server:latest .
# or with Docker:
docker build -t redis-mcp-server:latest .
```

### Run Container
```bash
podman run -d \
  --name redis-mcp-server \
  -p 127.0.0.1:3000:3000 \
  -e REDIS_URL=redis://mcp_reader:REPLACE_WITH_GENERATED_SECRET@redis-host:6379/0 \
  -e MCP_HOST=0.0.0.0 \
  redis-mcp-server:latest
```

---

## 14. Health Endpoint Validation

Query the `/health` endpoint to verify process and Redis status without leaking credentials:

```bash
curl -s http://127.0.0.1:3000/health | jq .
```

---

## 15. MCP Client Configuration Examples

> **Warning**: Never commit an MCP client configuration containing real Redis credentials, internal endpoints, or certificate paths.

### Option A: Local Process (STDIO Transport - Local Redis)

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

### Option B: Local Process (STDIO Transport - Managed Redis TLS)

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
        "REDIS_URL": "rediss://<username>:<password>@<host>:<port>/<db>",
        "REDIS_TLS_CA_PATH": "<path-to-ca-cert>/ca.pem",
        "REDIS_TLS_REJECT_UNAUTHORIZED": "true",
        "REDIS_COMMAND_TIMEOUT_MS": "3000"
      }
    }
  }
}
```

### Option C: Remote / Local HTTP Streamable Transport

When running `redis-mcp-server` as a container or standalone background service:

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

## 16. Validation

The current confirmed baseline has been validated with:
- **Strict TypeScript type checking**: `tsc --noEmit` passing with 0 errors.
- **Automated test suite**: 9 test suites and 58 automated tests passing (100%).
- **MCP protocol compliance**: Automated verification of `initialize`, `tools/list`, and tool execution over stateless Streamable HTTP.
- **Exact tool registration**: Asserts exactly the 6 approved read-only tools are registered.
- **Local functional testing**: Validated against a disposable local Redis instance.
- **Binary key/value round-trip**: Validated lossless preservation of raw binary keys and payload truncation with Base64 fallback.
- **Startup and lazy reconnect**: Validated automatic recovery when Redis becomes reachable after MCP server startup.
- **Managed Redis over TLS**: Validated read-only inspection against TLS-secured Redis instances.
- **Dependency audit**: `npm audit` reporting 0 vulnerabilities.

---

## 17. Known Limitations

1. **Redis SCAN COUNT is a work hint**: `scan_keys` executes a single cursor step and returns all keys Redis identified for that step. `count` is a work hint to Redis, not a hard upper bound.
2. **One scan_keys call performs one Redis cursor step**: The tool does not automatically exhaust cursors in a single invocation.
3. **All keys returned for that step are preserved**: To prevent permanent key loss from cursor sequences, keys returned by Redis in that step are not sliced client-side.
4. **Collection keys are binary-safe**: `KeyInput` supports string, UTF-8, and Base64 encoded keys.
5. **Collection fields, values, and members are UTF-8-oriented**: `get_collection_entries` currently uses UTF-8 Redis commands (`hscan`, `lrange`, `sscan`, `zrange`) and is not guaranteed lossless for arbitrary binary member bytes.
6. **get_key_value performs full GET before response truncation**: The underlying Redis `GET` loads the key value into memory before applying `REDIS_MAX_VALUE_BYTES` slicing.
7. **get_key_value returns payload bytes up to maxBytes**: Inspects and returns actual string contents.
8. **Redis Streams & RedisJSON**: Not parsed in V1; returns `UNSUPPORTED_TYPE`.
9. **Managed providers may restrict MEMORY USAGE or OBJECT ENCODING**: Returns `supported: false` and `null` gracefully when restricted.
10. **Java serialization may be tagged diagnostically**: Identifies `0xACED` headers for tagging, but does not perform semantic deserialization into application classes.
11. **String patterns do not match binary serialized keys**: A string pattern like `cache:*` matches only UTF-8 encoded keys and will not match binary keys unless scanning with `*` or a binary-compatible prefix.

---

## 18. Guidance for Interpreting Metadata

Each tool response includes an operation `metadata` block:
- `executionTimeMs`: Measures the execution time of the Redis command over this specific MCP connection only.
- **Important**: This duration **must not** be interpreted as application cache response time, Spring Cache latency, or end-to-end user API latency.

---

## 19. Troubleshooting

- **`CONNECTION_ERROR`**: Target Redis is unreachable. Verify host, port, firewall rules, and container network bindings.
- **`AUTHENTICATION_ERROR` / `PERMISSION_DENIED`**: Invalid username or password, or ACL user lacks permission for the requested command (`TYPE`, `SCAN`, `GET`, etc.).
- **`TIMEOUT_ERROR`**: Redis command did not complete within `REDIS_COMMAND_TIMEOUT_MS`. Check network latency or increase the timeout setting.
- **`TLS_ERROR`**: Certificate validation failed. Ensure `REDIS_TLS_CA_PATH` points to the correct certificate authority and that `rediss://` is used.
