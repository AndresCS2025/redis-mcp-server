# Testing & Verification Guide

This document describes the automated test architecture, test categories, validation scripts, and local testing procedures for `redis-mcp-server`.

---

## 1. Automated Validation Workflow

To execute the standard verification workflow:

```bash
# Clean install exact dependencies
npm ci

# Strict TypeScript type check
npm run typecheck

# Run automated test suite
npm test

# Production build
npm run build

# Vulnerability scan
npm audit
```

---

## 2. Test Suite Breakdown

The repository includes **9 automated test suites** covering **58 unit and integration tests**:

| Test File | Focus Area | Key Invariants Verified |
| :--- | :--- | :--- |
| `test/config.test.ts` | Configuration & Sanitization | Validates URL parsing, numeric boundaries, default fallbacks, and credential masking in URLs. |
| `test/key-codec.test.ts` | Binary Codec & Labels | Validates canonical Base64 checking, lossless UTF-8 round-trip safety, and SHA-256 binary key label generation. |
| `test/security.test.ts` | Error & Log Sanitization | Asserts that raw errors containing credentials, AUTH passwords, or `NOPERM` tokens are masked before exposure. |
| `test/round-trip.test.ts` | Cross-Tool Binary Round Trip | Proves that raw binary keys (e.g. Java serialization headers) round-trip losslessly across SCAN and all reading tools. |
| `test/tools.test.ts` | Tool Handlers & Redis Logic | Covers missing keys, positive/negative TTLs, string reads, collection pagination, and allowlisted server info parsing. |
| `test/reconnect.test.ts` | Lazy Reconnect & Concurrency | Proves single-flight connection deduplication, automatic recovery when Redis becomes reachable, and shutdown safety. |
| `test/http-app.test.ts` | HTTP & Health Routing | Verifies `/health` response formatting and status codes (`200` healthy vs `503` degraded). |
| `test/safety.test.ts` | Read-Only Hard Boundary | Inspects the `SafeRedisClient` prototype to assert that no mutating or administrative commands exist in the client. |
| `test/mcp-protocol.test.ts` | MCP Protocol Integration | Verifies protocol handshake (`initialize`), tool discovery (`tools/list`), and execution over stateless Streamable HTTP. |

---

## 3. Protocol-Level Integration Testing

The `test/mcp-protocol.test.ts` suite spins up a real ephemeral HTTP server using `@modelcontextprotocol/sdk` to test MCP client-server communication:
- **Handshake Verification**: Client initializes connection without requiring session IDs.
- **Tool Listing**: Asserts that exactly the 6 approved read-only tools are registered and discovered.
- **Stateless HTTP Invocation**: Verifies that tool requests succeed over stateless Streamable HTTP transport without session collisions.
- **Fail-Closed Validation**: Asserts that malformed tool arguments return structured JSON-RPC error envelopes.

---

## 4. Local Disposable Redis Testing

For manual end-to-end testing against a live Redis instance without affecting production caches:

```bash
# 1. Start a disposable Redis container
podman run -d --rm -p 127.0.0.1:6399:6379 --name redis-temp redis:7-alpine

# 2. Seed test keys
podman exec -i redis-temp redis-cli SET "cache:session:1001" '{"userId":"test"}' EX 1800
podman exec -i redis-temp redis-cli HSET "cache:hash:1001" "field1" "value1"

# 3. Start MCP server pointing to the test Redis
REDIS_URL="redis://127.0.0.1:6399/0" npm start

# 4. Clean up disposable container when finished
podman stop redis-temp
```
