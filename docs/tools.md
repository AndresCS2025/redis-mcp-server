# MCP Tools Reference

The `redis-mcp-server` exposes six focused, read-only tools designed specifically for cache diagnostics and evidence-driven investigations.

All key-consuming tools support `KeyInput`, which accepts both legacy strings and structured objects:
```typescript
type KeyInput = string | { encoding: 'utf8'; value: string } | { encoding: 'base64'; value: string };
```

---

## Tool Summary

| Tool Name | Primary Purpose | Underlying Redis Commands |
| :--- | :--- | :--- |
| [`get_key_info`](#1-get_key_info) | Inspect key metadata without retrieving full values. | `EXISTS`, `TYPE`, `TTL`, `PTTL`, `MEMORY USAGE`, `OBJECT ENCODING` |
| [`scan_keys`](#2-scan_keys) | Discover keys matching a pattern via single-step cursor SCAN. | `SCAN` (`scanBuffer`) |
| [`get_key_value`](#3-get_key_value) | Read a bounded Redis string value with binary-safe encoding. | `TYPE`, `GET` (`getBuffer`) |
| [`get_collection_entries`](#4-get_collection_entries) | Read bounded entries from Hashes, Lists, Sets, or Sorted Sets. | `TYPE`, `HLEN`, `HSCAN`, `LLEN`, `LRANGE`, `SCARD`, `SSCAN`, `ZCARD`, `ZRANGE` |
| [`get_memory_usage`](#5-get_memory_usage) | Inspect memory consumption for a specific key. | `EXISTS`, `MEMORY USAGE` |
| [`get_server_info`](#6-get_server_info) | Inspect structured, sanitized Redis server statistics. | `INFO` |

---

## 1. `get_key_info`

### Purpose
Inspect key metadata (existence, Redis data type, TTL/PTTL, memory usage, and internal encoding) in a single operation without retrieving the stored value payload.

### Inputs
- `key` (*string or structured key object, required*): The Redis key to inspect.

### Outputs
- `key`: Encoded key descriptor (`{ encoding: 'utf8' | 'base64', value: string, byteLength: number }`).
- `exists`: `true` if key exists in Redis; `false` otherwise.
- `type`: Redis data type (`string`, `hash`, `list`, `set`, `zset`, `stream`, or `none`).
- `ttlSeconds`: Time-To-Live in seconds (`-2` = missing/expired, `-1` = persistent/no expiry, `>0` = remaining seconds).
- `pttlMilliseconds`: TTL in milliseconds (`-2`, `-1`, or `>0`).
- `hasExpiration`: `true` if key has an active TTL (`ttlSeconds > 0`).
- `memoryUsageBytes`: Approximate RAM usage in bytes, or `null` if the command is disabled/unsupported.
- `objectEncoding`: Internal Redis encoding string (e.g., `embstr`, `raw`, `hashtable`, `ziplist`), or `null`.
- `metadata`: Diagnostic timing and latency disclaimers.

### Redis Commands Used
- `EXISTS` (checks initial existence).
- `TYPE`, `TTL`, `PTTL`, `MEMORY USAGE`, `OBJECT ENCODING` (executed concurrently if key exists).

### Bounds & Behavior
- If key does not exist, returns `exists: false`, `type: 'none'`, and `ttlSeconds: -2` immediately without executing diagnostic sub-queries.
- If `MEMORY USAGE` or `OBJECT ENCODING` are restricted by the server or provider ACLs, `null` is returned gracefully without throwing an error.

### Example
**Request:**
```json
{
  "key": "cache:session:1001"
}
```

**Response:**
```json
{
  "key": {
    "encoding": "utf8",
    "value": "cache:session:1001",
    "byteLength": 18
  },
  "exists": true,
  "type": "string",
  "ttlSeconds": 1800,
  "pttlMilliseconds": 1800000,
  "hasExpiration": true,
  "memoryUsageBytes": 256,
  "objectEncoding": "embstr"
}
```

---

## 2. `scan_keys`

### Purpose
Safely discover keys matching a pattern using single-step cursor-based `SCAN` without blocking Redis.

### Inputs
- `pattern` (*string, required*): Match pattern (e.g. `cache:*`, `session:*`, `*`).
- `cursor` (*string, optional, default: `"0"`*): Cursor position. Pass `"0"` to start a new scan sequence.
- `count` (*number, optional*): Work hint for Redis SCAN (clamped to `REDIS_MAX_SCAN_COUNT`).
- `limit` (*number, optional*): Backward-compatible alias for `count`.

### Outputs
- `pattern`: The requested search pattern.
- `keys`: Array of discovered encoded keys (`EncodedKeyOutput[]`).
- `returnedCount`: Number of keys returned for this step.
- `nextCursor`: Next cursor string to pass in subsequent calls (`"0"` indicates completion).
- `completed`: `true` if `nextCursor === "0"`.
- `truncated`: `false` (all keys returned by Redis for this cursor step are preserved).
- `metadata`: Diagnostic execution metadata.

### Redis Commands Used
- `SCAN <cursor> MATCH <pattern> COUNT <count>` (via `scanBuffer` for binary safety).

### Bounds & Semantics
- **Single-Step Only**: Executes exactly **one** Redis SCAN step per MCP call. Does not recursively exhaust cursors.
- **Work Hint Semantics**: In Redis, `COUNT` is a work hint (number of keyspace slots evaluated), not an exact return count limit.
- **Key Preservation**: All keys returned by Redis for that step are preserved and returned to prevent silent key loss from cursor sequences.
- **Prohibited Commands**: `KEYS` and `KEYS *` are strictly prohibited.

### Example
**Request:**
```json
{
  "pattern": "cache:session:*",
  "cursor": "0",
  "count": 50
}
```

**Response:**
```json
{
  "pattern": "cache:session:*",
  "keys": [
    { "encoding": "utf8", "value": "cache:session:1001", "byteLength": 18 },
    { "encoding": "utf8", "value": "cache:session:1002", "byteLength": 18 }
  ],
  "returnedCount": 2,
  "nextCursor": "42",
  "completed": false,
  "truncated": false
}
```

---

## 3. `get_key_value`

### Purpose
Safely read a Redis string value with payload size bounding and binary-safe encoding.

### Inputs
- `key` (*string or structured key object, required*): The key to read.
- `maxBytes` (*number, optional*): Maximum raw bytes to return (clamped to `REDIS_MAX_VALUE_BYTES`).

### Outputs
- `key`: Encoded key descriptor.
- `exists`: `true` if key exists; `false` otherwise.
- `type`: Redis data type (must be `"string"`).
- `encoding`: `"utf8"` if valid lossless UTF-8; `"base64"` otherwise.
- `value`: Payload string in UTF-8 or canonical Base64.
- `originalByteLength`: Total raw byte length of the value stored in Redis.
- `returnedByteLength`: Byte length of the returned payload slice.
- `truncated`: `true` if payload was sliced to respect byte limits; `false` otherwise.
- `detectedFormat`: `"utf8"`, `"java-serialization"` (magic header `0xACED`), or `"binary"`.
- `metadata`: Diagnostic metadata.

### Redis Commands Used
- `TYPE` (validates key type is `string`).
- `GET` (via `getBuffer` for raw byte retrieval).

### Bounds & Behavior
- If the key holds a non-string type (e.g. `hash`, `list`), throws `TypeMismatchError`.
- Slices raw bytes with `.subarray()` before encoding to prevent memory amplification.
- If byte truncation splits a multibyte UTF-8 character, automatically falls back to Base64 to prevent character corruption.
- *Note*: The underlying Redis `GET` loads the key value over the network into memory before MCP-level slicing is applied.

### Example
**Request:**
```json
{
  "key": "cache:session:1001",
  "maxBytes": 1024
}
```

**Response:**
```json
{
  "key": { "encoding": "utf8", "value": "cache:session:1001", "byteLength": 18 },
  "exists": true,
  "type": "string",
  "encoding": "utf8",
  "value": "{\"userId\":\"usr_42\",\"role\":\"admin\"}",
  "originalByteLength": 32,
  "returnedByteLength": 32,
  "truncated": false,
  "detectedFormat": "utf8"
}
```

---

## 4. `get_collection_entries`

### Purpose
Read a bounded subset of items from supported Redis collection data structures.

### Inputs
- `key` (*string or structured key object, required*): The collection key.
- `cursor` (*string, optional, default: `"0"`*): Cursor for `hash` and `set` scans.
- `offset` (*number, optional, default: `0`*): Starting index for `list` and `zset` ranges.
- `limit` (*number, optional*): Maximum items to return (clamped to `REDIS_MAX_RESULTS`).

### Outputs
- `key`: Encoded key descriptor.
- `exists`: Key existence.
- `type`: Collection type (`hash`, `list`, `set`, `zset`).
- `cardinality`: Total count of items in the collection.
- `entries`: Array of collection items:
  - **Hash**: `Array<{ field: string, value: string }>`
  - **List**: `string[]`
  - **Set**: `string[]`
  - **Sorted Set**: `Array<{ member: string, score: number }>`
- `nextCursor`: Next cursor string for hashes and sets (or `null`).
- `offset`: Offset index for lists and sorted sets.
- `hasMore`: `true` if additional entries remain in the collection.
- `metadata`: Diagnostic metadata.

### Supported Structures & Commands
- **Hash**: Uses `HLEN` and cursor-based `HSCAN`.
- **List**: Uses `LLEN` and bounded `LRANGE <offset> <offset + limit - 1>`.
- **Set**: Uses `SCARD` and cursor-based `SSCAN`.
- **Sorted Set**: Uses `ZCARD` and bounded `ZRANGE <offset> <offset + limit - 1> WITHSCORES`.

### Binary Safety Note
Collection **keys** are fully binary-safe (`KeyInput`). However, collection **fields, values, and members** currently use UTF-8-oriented Redis commands and are not guaranteed lossless for arbitrary non-UTF-8 binary member bytes.

---

## 5. `get_memory_usage`

### Purpose
Inspect approximate memory consumed by a specific Redis key using `MEMORY USAGE`.

### Inputs
- `key` (*string or structured key object, required*): The key to inspect.
- `samples` (*number, optional, 0–100*): Sample count for nested structures.

### Outputs
- `key`: Encoded key descriptor.
- `exists`: Key existence.
- `memoryUsageBytes`: Approximate RAM in bytes, or `null` if restricted.
- `supported`: `true` if command succeeded; `false` if restricted by server/provider ACLs.
- `notes`: Descriptive status note.
- `metadata`: Diagnostic metadata.

### Redis Commands Used
- `EXISTS` followed by `MEMORY USAGE <key> [SAMPLES <samples>]`.

---

## 6. `get_server_info`

### Purpose
Inspect safe, allowlisted Redis server diagnostics and operational metrics.

### Inputs
- `section` (*enum, optional, default: `"memory"`*): Allowlisted section name:
  - `server` (Redis version, uptime, architecture)
  - `clients` (Connected clients, blocked clients)
  - `memory` (Used memory, peak memory, fragmentation ratio)
  - `stats` (Total connections, total commands processed, ops/sec)
  - `keyspace` (Key counts and expires per database)
  - `replication` (Role, connected replicas)

### Outputs
- `section`: Requested section name.
- `fields`: Key-value map of parsed numeric, boolean, and text metrics.
- `metadata`: Diagnostic metadata.

### Security Sanitization
Denylisted fields (`requirepass`, `master_auth`, `config_file`, `executable`, `process_id`, `acl`, `user`) are automatically stripped before results are returned.
