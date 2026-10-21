# Security and Privacy Rules

## 1. Strictly Read-Only Boundary (Non-Negotiable)
The server is read-only by construction. The following commands and patterns are strictly prohibited from being implemented, exposed, or called:
- **Data Mutation**: `SET`, `MSET`, `HSET`, `DEL`, `UNLINK`, `RENAME`, `COPY`, `MOVE`.
- **TTL / Expiry Mutation**: `EXPIRE`, `PEXPIRE`, `PERSIST`, `EXPIREAT`.
- **Keyspace Mutation**: `FLUSHDB`, `FLUSHALL`.
- **Server Control**: `CONFIG SET`, `SHUTDOWN`, `MIGRATE`, `RESTORE`.
- **Arbitrary Scripting**: `EVAL`, `EVALSHA`, `SCRIPT LOAD`, `SCRIPT FLUSH`, `FUNCTION LOAD`.
- **Unbounded Key Enumeration**: `KEYS`, `KEYS *`.
- **Raw Command Passthrough**: Any generic `execute_redis_command` or dynamic command dispatcher.

## 2. Defense-in-Depth & Redis ACLs
- **Dual-Layer Defense**: Code-level read-only guarantees are complemented by server-side Redis ACL controls. The documentation must always provide minimal least-privilege ACL templates.
- **ACL Rule Order**: All `ACL SETUSER` templates must specify `reset` as the first token (`ACL SETUSER user reset on >password ...`) because Redis evaluates ACL rules left-to-right.
- **Quoted Shell Tokens**: Shell-interpretable tokens (`'>PASSWORD'`, `'+memory|usage'`, `'+object|encoding'`) must be quoted in all documentation examples.

## 3. Credential & Data Sanitization
- **Credential Masking**: Passwords, tokens, and raw connection strings must never appear in logs, error messages, health endpoints, or tool outputs. Mask URLs as `redis://user:***@host:port/db`.
- **Binary Key Masking**: Non-printable and binary keys must never be logged or formatted as raw bytes in error strings. Format them using safe SHA-256 digest labels: `binary-key:<hash> (N bytes)`.
- **TLS by Default**: `rediss://` must validate certificates by default (`rejectUnauthorized: true`). Never disable TLS verification in production or default configurations.

## 4. Privacy & Data Minimization
- **Metadata Preference**: Prefer inspecting metadata (`get_key_info`, `get_memory_usage`) over full payload retrieval (`get_key_value`) when metadata answers the investigative question.
- **Bounded Responses**: Hard byte limits (`REDIS_MAX_VALUE_BYTES`) and result caps (`REDIS_MAX_RESULTS`) prevent inadvertent exfiltration or memory exhaustion.
- **Fail-Closed Inputs**: Malformed, non-canonical Base64, or oversized keys must fail closed with sanitized error messages before Redis execution.
