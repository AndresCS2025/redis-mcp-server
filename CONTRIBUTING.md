# Contributing to `redis-mcp-server`

Thank you for your interest in contributing to `redis-mcp-server`. This project is an Inner Source Model Context Protocol (MCP) server providing strictly **read-only**, evidence-oriented inspection of Redis instances.

---

## 1. Project Purpose & Scope

The `redis-mcp-server` enables AI assistants (such as IBM Bob) and developer tools to safely inspect Redis cache state without risking data corruption, cache eviction, or performance degradation.

---

## 2. Prerequisites

- **Node.js**: `v20.0.0` or higher (verified with Node 20 / 22 / 24).
- **npm**: `v10.0.0` or higher.
- *(Optional)* **Podman** or **Docker** for containerized testing.

---

## 3. Development Workflow

### Installation
```bash
npm install
```

### Type Checking
```bash
npm run typecheck
```

### Running Tests
```bash
npm test
# Run in watch mode:
npm run test:watch
```

### Building the Project
```bash
npm run build
```

### Local Development Server
```bash
npm run dev
```

### Dependency Audit
```bash
npm audit
```

---

## 4. Strict Read-Only Contribution Policy

**CRITICAL**: `redis-mcp-server` is strictly **read-only by construction**. Contributions that introduce any of the following will **NOT** be accepted into the core server:

- **Data Mutation**: `SET`, `MSET`, `HSET`, `DEL`, `UNLINK`, `RENAME`, `COPY`, `MOVE`.
- **TTL / Expiration Mutation**: `EXPIRE`, `PEXPIRE`, `PERSIST`, `EXPIREAT`.
- **Keyspace Flush**: `FLUSHDB`, `FLUSHALL`.
- **Server Configuration / Control**: `CONFIG SET`, `SHUTDOWN`, `MIGRATE`, `RESTORE`.
- **Arbitrary Scripting**: `EVAL`, `EVALSHA`, `SCRIPT LOAD`, `SCRIPT FLUSH`, `FUNCTION LOAD`.
- **Unbounded Key Enumeration**: `KEYS`, `KEYS *`.
- **Raw Command Passthrough**: Any generic `execute_redis_command` or dynamic command dispatcher.
- **Unbounded Scanning**: Automatically recursive cursor loops that scan the entire keyspace in a single tool call.

### Adding New Read-Only Inspection Commands
If you propose a new read-only Redis inspection tool:
1. **Explicit Whitelisting**: Must use explicit typed methods on `SafeRedisClient`—never dynamic or raw command execution.
2. **Strict Bounding**: Must implement hard input and output limits (`COUNT`, `limit`, byte caps).
3. **ACL Documentation**: Must update the command-to-ACL mapping matrix in `README.md`.
4. **Binary Safety**: Must preserve arbitrary binary keys and values using `key-codec.ts`.
5. **Credential Masking**: Must never log or expose credentials or connection strings.
6. **Automated Testing**: Must include comprehensive unit tests and safety assertions in `test/`.

---

## 5. Binary Data Policy

- **Lossless UTF-8**: Strings that round-trip losslessly to UTF-8 and back are returned as UTF-8.
- **Base64 Canonical Transport**: Arbitrary binary payloads (e.g., Java serialization, Protocol Buffers, MessagePack, Python pickle) are transported as canonical Base64.
- **Serializer-Agnostic Core**: The core server transports raw bytes as diagnostic evidence and does not perform semantic deserialization into application classes.

---

## 6. Coding Conventions

- **Strict TypeScript**: Enable all strict compiler options. Avoid `any` and unsafe type assertions.
- **Fail-Closed Validation**: Use Zod schemas at tool boundaries to validate inputs before touching Redis.
- **Focused Modules**: Keep tool handlers, schemas, codecs, and clients cohesive and lightweight.
- **Minimal, High-Value Comments**: Write code that is self-explanatory. Use comments only to explain *why*, not *what*.
- **No Duplicated Logic**: Reuse `src/utils/key-codec.ts` and `src/errors/error-handler.ts` across all tools.

---

## 7. Pull Request Expectations

Before opening a pull request, ensure:
- [ ] Changes are focused and do not include unrelated refactors.
- [ ] Strict read-only boundary is preserved.
- [ ] All new logic is covered by unit tests.
- [ ] `npm run typecheck` passes with 0 errors.
- [ ] `npm test` passes 100%.
- [ ] `npm run build` compiles cleanly.
- [ ] `npm audit` reports 0 vulnerabilities.
- [ ] `README.md` and ACL documentation are updated if tool capabilities changed.

---

## 8. Semantic Versioning

This project follows [Semantic Versioning (SemVer)](https://semver.org/):

- **Patch (1.0.x)**: Bug fixes, performance improvements, documentation enhancements.
- **Minor (1.x.0)**: New read-only MCP tools, backward-compatible schema enhancements.
- **Major (x.0.0)**: Breaking changes, including:
  - Renaming or removing MCP tools.
  - Incompatible changes to tool input schemas.
  - Incompatible changes to tool output structures.
  - Removing legacy key input support.
  - Renaming environment variables or changing transport endpoints.
