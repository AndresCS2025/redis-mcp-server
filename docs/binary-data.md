# Binary Data & Key Codec

Redis treats keys and values as arbitrary byte sequences. Many production systems utilize binary serialization formats (such as Java `JdkSerializationRedisSerializer`, Protocol Buffers, MessagePack, or Python `pickle`) where keys and values contain non-UTF-8 bytes.

The `redis-mcp-server` implements a **serializer-agnostic, binary-safe transport model** that preserves raw bytes without corruption.

---

## Key Input Formats

All key-consuming tools (`get_key_info`, `get_key_value`, `get_collection_entries`, `get_memory_usage`) accept three input formats:

### 1. Legacy UTF-8 String
For standard text keys:
```json
"cache:session:1001"
```

### 2. Structured UTF-8
Explicit UTF-8 key representation:
```json
{
  "encoding": "utf8",
  "value": "cache:session:1001"
}
```

### 3. Structured Base64 (Binary Keys)
For binary or serialized keys containing non-printable bytes or null characters:
```json
{
  "encoding": "base64",
  "value": "rO0ABXQAEHNhbXBsZTprZXk6MTAwMQ=="
}
```

---

## Key Output Format

Discovered keys from `scan_keys` and key references in tool responses are returned with exact byte lengths and encoding tags:

### Lossless UTF-8 Output
```json
{
  "encoding": "utf8",
  "value": "cache:session:1001",
  "byteLength": 18
}
```

### Binary / Base64 Output
```json
{
  "encoding": "base64",
  "value": "rO0ABXQAEHNhbXBsZTprZXk6MTAwMQ==",
  "byteLength": 24
}
```

---

## Lossless UTF-8 Detection

To guarantee that text conversions never introduce Unicode replacement characters (`U+FFFD`), the server performs bi-directional round-trip validation:

$$\text{isLosslessUtf8}(B) \iff \text{Buffer.from}(B\text{.toString('utf-8')}, \text{'utf-8'}).\text{equals}(B)$$

- If the buffer converts to a UTF-8 string and back to the identical raw bytes, it is safely returned as `encoding: "utf8"`.
- If the bytes cannot be losslessly converted (e.g. arbitrary binary bytes, or a character split by byte truncation), the server automatically falls back to canonical Base64 (`encoding: "base64"`).

---

## Canonical Base64 Transport

Canonical Base64 encoding provides lossless byte transport across JSON-RPC channels:
- Base64 is used strictly for **safe transport**, not semantic decoding.
- The server validates that Base64 inputs are strictly canonical and conform to standard padding rules, failing closed on malformed inputs before touching Redis.

---

## Cross-Tool Round-Tripping

Binary keys can be discovered and passed across tools losslessly without manual byte reconstruction:

```
┌──────────────┐   scan_keys (scanBuffer)   ┌──────────────────────────────────────────────┐
│  Target      │ ─────────────────────────► │ Discovered Key:                              │
│  Redis       │                            │ { encoding: "base64", value: "rO0ABXQ..." }  │
└──────────────┘                            └──────────────────────┬───────────────────────┘
       ▲                                                           │
       │                                                           ▼
       │         get_key_info / get_key_value                      │
       └───────────────────────────────────────────────────────────┘
```

1. `scan_keys` discovers keys using `scanBuffer` and returns binary keys as `{ encoding: "base64", value: "..." }`.
2. The MCP client passes that structured object directly to `get_key_info`, `get_key_value`, or `get_collection_entries`.
3. The server decodes the Base64 string back into the exact original `Buffer` before querying Redis.

---

## Serializer-Agnostic Core

The core server makes no assumptions about specific application serialization libraries:
- It does not attempt to instantiate JVM classes or invoke Java `ObjectInputStream`.
- It does not execute dynamic language deserializers.
- It identifies common binary magic headers (such as `0xACED` for Java serialization) purely as diagnostic tagging in `detectedFormat`, preserving raw bytes as evidence.

---

## Collection Element Limitation

While collection **keys** are fully binary-safe (`KeyInput`), collection **fields, values, and members** in `get_collection_entries` currently use UTF-8 string commands (`hscan`, `lrange`, `sscan`, `zrange`). They are not guaranteed lossless for arbitrary binary member bytes.
