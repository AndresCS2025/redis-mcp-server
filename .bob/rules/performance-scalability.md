# Performance, Complexity, and Scalability Rules

## 1. Algorithmic Complexity & Workload Review
Reviewers and implementers must analyze algorithmic time and space complexity when cost scales with:
- Redis keyspace size ($N$)
- Collection cardinality ($M$)
- Payload byte length ($B$)
- Number of requested items ($K$)
- Concurrency ($C$)

Do not require ceremonial Big-O notation for trivial $O(1)$ operations, but state meaningful complexity (e.g., `Time: O(K)`, `Space: O(K)`) when inputs or outputs materially affect CPU, RAM, or network transfer.

## 2. Redis Workload Rules
- **No Unbounded Scans**: Never traverse the complete keyspace automatically in a single tool call. One tool call executes exactly one bounded cursor step.
- **SCAN COUNT Semantics**: Redis `COUNT` is a work hint, not a guaranteed return count. Document this clearly to callers.
- **Hard Result Clamping**: Clamp all user-requested limits against server-configured maximums (`REDIS_MAX_SCAN_COUNT`, `REDIS_MAX_RESULTS`, `REDIS_MAX_VALUE_BYTES`).
- **No $O(N)$ Database Operations**: Prohibit `KEYS` or commands that block the single-threaded Redis event loop.

## 3. Node.js Runtime & Memory Efficiency
- **Event Loop Protection**: Avoid synchronous, CPU-intensive parsing or deep recursive transformations on untrusted agent payloads.
- **Buffer Allocation & Slicing**: Avoid double allocations. Slice buffers using `.subarray()` rather than copying unless an independent buffer lifetime is strictly required.
- **Base64 Expansion**: Account for the ~33% size expansion of Base64 strings when enforcing memory limits. Truncation byte limits must apply to the raw Redis Buffer before encoding.
- **Memory Amplification Prevention**: Do not retain duplicate representations (e.g. keeping both raw buffer, decoded string, and Base64 string in memory simultaneously) across request lifecycles.
- **Digest Computation**: Bound input sizes before computing SHA-256 digests.

## 4. Concurrency, Connection & Resilience
- **Single Pooled Client**: Share a single managed `SafeRedisClient` connection across MCP requests rather than instantiating connections per request.
- **Strict Command Timeouts**: Every Redis interaction must enforce a timeout (`REDIS_COMMAND_TIMEOUT_MS`) using `Promise.race` with proper timer cleanup.
- **Bounded Exponential Backoff**: Reconnection attempts must back off up to a reasonable cap and terminate after bounded attempts to prevent retry storms.
- **Race Condition Handling**: Account for keys expiring or changing types between successive operations (e.g., `TYPE` then `GET`) without unhandled crashes.
