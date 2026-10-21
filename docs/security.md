# Security & Access Control

Security is a primary design constraint of `redis-mcp-server`. This document details the server's read-only enforcement, credential sanitization, Redis ACL recommendations, data privacy considerations, and TLS configuration.

---

## 1. Read-Only Enforcement by Construction

The `redis-mcp-server` is architected to be **read-only by construction**:
- The internal Redis client wrapper (`SafeRedisClient`) defines explicit methods only for non-mutating inspection commands.
- The server exposes **no generic command dispatcher** (`call()`, `sendCommand()`, or `execute_redis_command`).
- Dynamic evaluation and escape hatches (`EVAL`, `EVALSHA`, `SCRIPT LOAD`) are completely prohibited.

### Strictly Excluded Operations
- **Data Mutations**: `SET`, `MSET`, `HSET`, `DEL`, `UNLINK`, `RENAME`, `COPY`, `MOVE`
- **Expiry Mutations**: `EXPIRE`, `PEXPIRE`, `PERSIST`, `EXPIREAT`
- **Keyspace Mutations**: `FLUSHDB`, `FLUSHALL`
- **Server Control**: `CONFIG SET`, `SHUTDOWN`, `MIGRATE`, `RESTORE`
- **Prohibited Enumerations**: `KEYS`, `KEYS *`

---

## 2. Defense-in-Depth Security Model

Application-level read-only checks provide the first line of defense. However, application-level enforcement **does not replace Redis server-side Access Control Lists (ACLs)**. 

Organizations deploying `redis-mcp-server` should provision a dedicated, read-only Redis ACL user.

```
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│     redis-mcp-server Guards     │       │     Redis Server-Side ACLs      │
│  - No mutating methods exposed  │  ──►  │  - ACL user with read-only perm │
│  - Zod fail-closed validation   │       │  - Write commands rejected      │
│  - Hard operation & byte bounds │       │  - Dangerous commands blocked   │
└─────────────────────────────────┘       └─────────────────────────────────┘
```

---

## 3. Redis ACL Configuration

### Tool-to-Command Permission Matrix

| MCP Tool | Underlying Redis Commands Invoked | Minimum Required Redis ACL Command Permissions |
| :--- | :--- | :--- |
| `get_key_info` | `EXISTS`, `TYPE`, `TTL`, `PTTL`, `MEMORY USAGE`, `OBJECT ENCODING` | `+exists +type +ttl +pttl '+memory|usage' '+object|encoding'` |
| `scan_keys` | `SCAN` (`scanBuffer`) | `+scan` |
| `get_key_value` | `TYPE`, `GET` (`getBuffer`) | `+type +get` |
| `get_collection_entries` | `TYPE`, `HLEN`, `HSCAN`, `LLEN`, `LRANGE`, `SCARD`, `SSCAN`, `ZCARD`, `ZRANGE` | `+type +hlen +hscan +llen +lrange +scard +sscan +zcard +zrange` |
| `get_memory_usage` | `EXISTS`, `MEMORY USAGE` | `+exists '+memory|usage'` |
| `get_server_info` | `INFO` | `+info` |
| Health / Ping | `PING` | `+ping` |

### Critical ACL Construction Rules

1. **`reset` Must Be the First Token**: Redis evaluates ACL rules strictly from **left to right**. The `reset` rule resets the user to an unprivileged disabled state. If `reset` appears after `on` or password definitions, it will erase them.
2. **Quote Special Rule Tokens**: When creating users via `redis-cli`, quote tokens like `'>PASSWORD'`, `'+memory|usage'`, and `'+object|encoding'` to prevent shell redirection (`>`) or pipeline (`|`) interpretation.
3. **Use Approved Secrets**: Generate passwords through your team's approved secret-management solution (e.g., HashiCorp Vault, IBM Key Protect).

### Option A: Explicit Least-Privilege Allowlist (Recommended)

```bash
redis-cli ACL SETUSER mcp_reader reset on '>REPLACE_WITH_GENERATED_SECRET' ~* \
  +ping +info +exists +type +ttl +pttl +scan +get \
  +hlen +hscan +llen +lrange +scard +sscan +zcard +zrange \
  '+memory|usage' '+object|encoding'
```

### Option B: Category-Based Allowlist

```bash
redis-cli ACL SETUSER mcp_reader reset on '>REPLACE_WITH_GENERATED_SECRET' ~* \
  +@read +info +ping '+memory|usage' '+object|encoding' \
  -keys -@write -@admin -@dangerous
```

---

## 4. Credential & Data Sanitization

- **URL Masking**: Passwords in connection URLs are masked across logs, errors, and health endpoints (`redis://user:***@host:port/db`).
- **Error Sanitization**: Error messages strip embedded authentication strings (`password=***`, `auth=***`).
- **Binary Key Safe Labels**: Non-printable and binary keys are summarized in error messages and logs using SHA-256 digest labels (`binary-key:<hash> (N bytes)`), preventing control character injection or terminal escape sequence abuse.
- **Health Endpoint Isolation**: The `/health` endpoint exposes only connection state and ping latency—never connection credentials or cached keys.

---

## 5. Data Privacy

When conducting cache investigations with AI assistants, consider:
- **Identifier Keys**: Redis keys may contain user identifiers or session tokens.
- **Sensitive Payloads**: Stored values may contain business-sensitive data.
- **Client Transcripts**: AI coding assistants may record MCP tool inputs and outputs in chat transcripts.
- **Prefer Metadata Operations**: Use `get_key_info` or `get_memory_usage` when key existence, data type, TTL, or memory consumption is sufficient to answer the investigation without fetching value payloads.
- **Data Governance**: Apply organizational data retention and handling policies to client transcripts.

---

## 6. TLS Configuration

To connect over an encrypted channel:
1. Use the `rediss://` scheme in `REDIS_URL`.
2. For private or enterprise Certificate Authorities, specify the CA path using `REDIS_TLS_CA_PATH`.
3. Strict certificate verification (`REDIS_TLS_REJECT_UNAUTHORIZED=true`) is enabled by default. Never disable certificate validation in production.
