# Architecture & Design

This document details the internal architecture, component structure, transport protocols, connection management, and core design principles of `redis-mcp-server`.

---

## System Architecture

```
┌─────────────────────────────────┐
│           MCP Client            │
│   (e.g., IBM Bob, Claude)       │
└────────────────┬────────────────┘
                 │ JSON-RPC (HTTP or STDIO)
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                      redis-mcp-server                       │
│                                                             │
│  ┌────────────────────────┐     ┌────────────────────────┐  │
│  │  Streamable HTTP       │     │  STDIO Transport       │  │
│  │  (/mcp, /health)       │     │  (stdout / stderr)     │  │
│  └───────────┬────────────┘     └───────────┬────────────┘  │
│              └───────────────┬──────────────┘               │
│                              ▼                              │
│                 ┌─────────────────────────┐                 │
│                 │      McpServer SDK      │                 │
│                 │   (Tool Registration)   │                 │
│                 └────────────┬────────────┘                 │
│                              ▼                              │
│                 ┌─────────────────────────┐                 │
│                 │    Zod Schema Layer     │                 │
│                 │  (Fail-Closed Parsing)  │                 │
│                 └────────────┬────────────┘                 │
│                              ▼                              │
│                 ┌─────────────────────────┐                 │
│                 │   Read-Only Handlers    │                 │
│                 │  (6 Consolidated Tools) │                 │
│                 └────────────┬────────────┘                 │
│                              ▼                              │
│                 ┌─────────────────────────┐                 │
│                 │     SafeRedisClient     │                 │
│                 │ (Lazy Connect, Timeouts)│                 │
│                 └────────────┬────────────┘                 │
└──────────────────────────────┼──────────────────────────────┘
                               │ ioredis (Buffer APIs, TLS)
                               ▼
                ┌─────────────────────────────┐
                │        Target Redis         │
                │  (Standalone / Cloud / TLS) │
                └─────────────────────────────┘
```

---

## Component Breakdown

1. **`src/index.ts`**: Main process entrypoint. Loads configuration, starts the selected transport (HTTP or STDIO), registers signal handlers (`SIGTERM`, `SIGINT`), and triggers graceful disconnection.
2. **`src/server.ts`**: MCP server definition. Registers the 6 read-only tools and configures Express routing for `/mcp` and `/health`.
3. **`src/config/redis-config.ts`**: Zod-validated configuration schema with sanitization and masking helpers.
4. **`src/schemas/tool-schemas.ts`**: Strict input schemas for tool arguments, supporting `KeyInput` and allowlisted sections.
5. **`src/utils/key-codec.ts`**: Central codec for lossless UTF-8 validation, canonical Base64 encoding/decoding, and safe key labeling.
6. **`src/redis/redis-client.ts`**: Encapsulated read-only Redis client (`SafeRedisClient`) providing connection pooling, timeouts, and buffer-oriented commands.
7. **`src/tools/*.ts`**: Isolated tool handlers implementing single-step SCAN, string reads, collection reads, memory checks, and server metrics.
8. **`src/errors/*.ts`**: Typed error taxonomy (`RedisMcpError`) and credential-stripping error formatter.
9. **`src/metadata/metadata-collector.ts`**: Operation timing and execution disclaimer collector.

---

## Transport Models

### 1. Streamable HTTP Transport (`/mcp`)
- Configured explicitly for **stateless operation** (`sessionIdGenerator: undefined`).
- Creates request-scoped MCP server and transport instances per HTTP request to ensure clean concurrency and prevent session ID collisions.
- Exposes a dedicated `/health` endpoint for readiness and connectivity checks.

### 2. Standard Input/Output Transport (`--stdio`)
- Communicates directly via standard I/O streams for local client integrations.
- **Protocol Purity**: `stdout` is reserved exclusively for valid MCP JSON-RPC messages.
- **Logging Discipline**: All operational, lifecycle, and diagnostic messages write exclusively to `stderr` (`console.error`).

---

## Connection Lifecycle & Resilience

```
                      ┌───────────────┐
                      │ Server Starts │
                      └───────┬───────┘
                              │
                    ┌─────────▼─────────┐
                    │ Attempt Connect   │
                    └─────────┬─────────┘
                              │
               ┌──────────────┴──────────────┐
               │ Success?                    │
               ▼                             ▼
        [ Yes: Connected ]            [ No: Degraded ]
               │                             │
               │                      Incoming Request
               │                             │
               │                   ┌─────────▼─────────┐
               │                   │ Single-Flight     │
               │                   │ Lazy Reconnect    │
               │                   └─────────┬─────────┘
               │                             │
               │                      Reconnection OK?
               │                             │
               │                      ┌──────┴──────┐
               │                      ▼             ▼
               │                   [ Yes ]        [ No ]
               │                      │             │
               ▼                      ▼             ▼
        ┌────────────────────────────────┐   ┌──────────────┐
        │     Execute Read-Only Query    │   │ Return Error │
        └────────────────────────────────┘   └──────────────┘
```

- **Lazy Reconnection**: If Redis is unreachable at startup, the MCP server boots in a degraded state and attempts lazy reconnection when subsequent requests arrive.
- **Single-Flight Deduplication**: Concurrent requests share a single in-flight connection promise (`connectionPromise`) to avoid reconnect storms.
- **Shutdown Guard**: Disconnection marks `isShuttingDown = true`, immediately rejecting new operations and preventing orphaned connection creation.

---

## Core Design Principles

1. **Evidence Over Assumptions**: Return exact stored bytes without speculative transformation.
2. **Read-Only by Construction**: Expose no mutating commands, administrative switches, or raw command dispatchers.
3. **Bounded Operations**: Enforce strict upper limits on SCAN iterations, collection ranges, and value byte lengths.
4. **Serializer Agnostic**: Preserve raw data faithfully without application-specific deserializers.
5. **Defense in Depth**: Pair code-level restrictions with dedicated Redis ACL user policies.
6. **Data Minimization**: Encourage metadata inspection (`get_key_info`, `get_memory_usage`) before full payload retrieval.
