---
name: add-redis-tool
description: Gate-based workflow for evaluating, designing, and safely implementing new read-only Redis inspection tools in redis-mcp-server.
---

# Add Redis Tool Workflow

Use this procedural guide when evaluating, designing, or implementing a new inspection tool for `redis-mcp-server`.

## 18-Point Decision & Implementation Gate

Before writing code for any proposed tool, evaluate and document the answers to each gate:

1. **Strictly Read-Only?**
   - Does the underlying Redis command mutate data, keyspace, TTL, or server config?
   - *Gate Rule:* If YES, immediately reject the tool. Only read/inspection operations are permitted.
2. **Application-Agnostic?**
   - Is the tool generic to Redis data structures, or does it assume application-specific business logic/models?
   - *Gate Rule:* If application-specific, keep it out of the core server.
3. **Existing Tool Overlap?**
   - Does an existing tool (`get_key_info`, `scan_keys`, `get_key_value`, `get_collection_entries`, `get_memory_usage`, `get_server_info`) already provide this capability or could it be extended backward-compatibly?
4. **Exact Redis Commands**:
   - What exact Redis commands will be invoked?
5. **Required Redis ACL Permissions**:
   - What exact ACL command rules (e.g., `+hscan`, `+type`) must be added to the documentation?
6. **Command Complexity**:
   - What is the time and space complexity of the Redis command (e.g., $O(1)$, $O(\log N)$, $O(K)$)?
7. **Request & Response Bounds**:
   - How are inputs bounded (`min`, `max` in Zod)?
   - What hard server limits clamp the maximum returned payload or items?
8. **Pagination & Cursors**:
   - Does the operation use cursor-based scanning (`HSCAN`, `SSCAN`), range offsets (`LRANGE`, `ZRANGE`), or single-step iteration?
   - *Gate Rule:* Never loop through cursors automatically in a single tool call.
9. **Binary Key Support**:
   - Does the tool accept `keyInputSchema` and parse it via `parseKeyInput()` from `key-codec.ts`?
10. **Binary Value Transport**:
    - Does the tool handle non-UTF-8 values safely via Base64 without corruption?
11. **Data Minimization & Privacy**:
    - Could metadata alone satisfy the investigation without returning raw payload bytes?
12. **Timeouts**:
    - Is the operation wrapped with `redisClient.withTimeout` using `REDIS_COMMAND_TIMEOUT_MS`?
13. **Managed Redis Restrictions**:
    - What happens if a managed cloud Redis provider disables the command? (Handle gracefully with structured notes).
14. **Key Race Conditions**:
    - What happens if the key expires or changes type between successive operations?
15. **Automated Test Coverage**:
    - Unit tests covering existing key, missing key, wrong type, binary round-trip, limit clamping, and restricted command handling.
16. **Documentation Updates**:
    - Update `README.md` (tool documentation and ACL matrix) and `CONTRIBUTING.md`.
17. **Backward Compatibility**:
    - Are existing inputs and output fields preserved?
18. **Semantic Versioning**:
    - Is this a Minor (1.x.0) feature addition, or does it introduce breaking changes requiring a Major (x.0.0) bump?

## Implementation Steps

Once all 18 gates pass:
1. **Define Schema**: Add Zod input schema in `src/schemas/tool-schemas.ts`.
2. **Implement Safe Client Method**: Add typed read-only method to `SafeRedisClient` in `src/redis/redis-client.ts`.
3. **Implement Tool Handler**: Create `src/tools/<tool-name>.ts` with metadata collection and error handling.
4. **Register in Server**: Register tool in `createMcpServer()` in `src/server.ts`.
5. **Write Unit Tests**: Add test cases in `test/tools.test.ts`.
6. **Update ACL Documentation**: Add command mapping to `README.md`.
7. **Run Validation**: Execute `npm run typecheck && npm test && npm run build && npm audit`.
