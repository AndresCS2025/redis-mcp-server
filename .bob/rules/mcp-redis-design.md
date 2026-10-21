# MCP and Redis Design Rules

## 1. Generic & Serializer-Agnostic Design
- **Application-Agnostic Core**: The MCP core understands Redis primitives and diagnostic investigation intent. It must never embed application-specific business logic, hardcoded cache namespaces, or framework-specific deserializers (Spring Cache, Java `ObjectInputStream`, Python `pickle`).
- **Binary Evidence Preservation**: Treat Redis keys and values as arbitrary byte sequences. Return lossless UTF-8 where valid, and canonical Base64 for arbitrary binary bytes.
- **Display Fields vs Canonical Keys**: Human-readable display previews (if added as metadata) must never replace canonical binary keys (`{ encoding: 'base64', value: ... }`) required for round-tripping across tools.

## 2. Public Tool Surface & Stability
- **Consolidated Primitive Tools**: Keep the tool surface minimal and cohesive:
  - `get_key_info` (Metadata, TTL/PTTL, memory, encoding)
  - `scan_keys` (Single-step cursor SCAN)
  - `get_key_value` (Bounded string read)
  - `get_collection_entries` (Consolidated collection inspector for hash, list, set, sorted set)
  - `get_memory_usage` (Key RAM usage via `MEMORY USAGE`)
  - `get_server_info` (Allowlisted, sanitized `INFO` sections)
- **No Proliferation**: Do not create fragmented single-purpose tools (e.g. `get_hash`, `get_list`, `get_set`, `get_zset`) when `get_collection_entries` handles collection types uniformly based on detected `TYPE`.
- **SemVer Stability**: Tool names, input schemas, and output envelopes are public contracts. Incompatible changes require SemVer Major version bumps.

## 3. Protocol & Transport Integrity
- **Streamable HTTP & STDIO**: Both Streamable HTTP (`/mcp`, `/health`) and STDIO (`--stdio`) transports must remain fully supported.
- **Explicit Stateless HTTP**: Streamable HTTP transport must be configured explicitly for stateless execution (`sessionIdGenerator: undefined`) to prevent session-id requirement mismatches.
- **No STDIO Protocol Corruption**: When running in STDIO mode, all diagnostic and lifecycle logs must write exclusively to `stderr` (`console.error`). Writing non-JSON data to `stdout` corrupts the MCP JSON-RPC protocol channel.
- **Protocol-Level Integration Verification**: Any changes to transport configuration or server lifecycle require automated integration tests verifying `initialize`, `tools/list`, and actual tool execution.
