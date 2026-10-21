# Known Limitations & Design Non-Goals

This document outlines the current technical constraints and intentional design non-goals of `redis-mcp-server`.

---

## 1. Technical Limitations

### 1. Redis SCAN COUNT Work Hint
In Redis, `COUNT` is a work hint for the number of keyspace hash slots evaluated, not a guaranteed return count. A single cursor step may return more or fewer keys than the requested `count`. All keys returned for that step are preserved to prevent losing items from the cursor sequence.

### 2. Single-Step SCAN Traversal
Each `scan_keys` tool invocation executes exactly **one** Redis SCAN step. The server does not automatically traverse the entire keyspace in a single call. Callers must pass `nextCursor` to subsequent requests until `nextCursor === "0"`.

### 3. String Patterns on Binary Keys
Redis matches string patterns against raw key bytes. A text pattern like `cache:*` matches UTF-8 encoded keys, but will not match binary keys (such as Java serialization headers `0xACED`) unless scanned using `*` or a byte-compatible pattern.

### 4. Collection Elements are UTF-8 Oriented
While collection **keys** accept arbitrary binary representations (`KeyInput`), collection **fields, values, and members** in `get_collection_entries` currently use UTF-8 string commands (`hscan`, `lrange`, `sscan`, `zrange`). They are not guaranteed lossless for arbitrary binary member bytes.

### 5. Full Value Network Fetch Before Slicing
In `get_key_value`, the underlying Redis `GET` loads the full string payload over TCP before applying `REDIS_MAX_VALUE_BYTES` buffer slicing.

### 6. Payload Byte Inspection
`get_key_value` returns actual stored string contents up to the configured byte limit. For metadata-only checks, use `get_key_info` or `get_memory_usage`.

### 7. Redis Streams
Redis Streams (`xread`, `xrange`) are not parsed in V1. Querying a stream key with `get_collection_entries` returns `UNSUPPORTED_TYPE`.

### 8. RedisJSON
RedisJSON data structures are not parsed in V1.

### 9. Provider Command Restrictions
Certain managed cloud Redis providers restrict diagnostic commands such as `MEMORY USAGE` or `OBJECT ENCODING`. When restricted, the server returns `supported: false` and `null` gracefully rather than failing the entire inspection.

### 10. No Application-Specific Semantic Deserialization
The server transports raw bytes using canonical Base64. It does not instantiate application classes, execute Java `ObjectInputStream`, or decode domain-specific serializers.

---

## 2. Intentional Design Non-Goals (Safety Guarantees)

The following items are intentional safety guarantees rather than missing features:

### 1. No Data Mutation Commands
Commands like `SET`, `HSET`, `DEL`, `UNLINK`, `EXPIRE`, `FLUSHDB`, and `FLUSHALL` will never be implemented. The server is strictly read-only to ensure zero risk of accidental cache corruption or eviction during investigations.

### 2. No `KEYS` or `KEYS *`
The `KEYS` command blocks the single-threaded Redis event loop when scanning large keyspaces. The server exclusively uses non-blocking cursor-based `SCAN`.

### 3. No Raw Command Passthrough
The server intentionally omits generic command dispatchers (`execute_redis_command` or raw string execution) to eliminate arbitrary command execution and prompt-injection risks.
