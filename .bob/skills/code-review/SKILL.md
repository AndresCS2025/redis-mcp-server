---
name: code-review
description: Comprehensive, evidence-based code review for redis-mcp-server covering TypeScript, security, performance, Redis semantics, and MCP protocol compliance.
---

# Redis MCP Server Code Review

Perform a deep, evidence-based code review of the `redis-mcp-server` codebase or a proposed pull request.

## Review Principles & Discipline

1. **Inspection Only**: Do NOT modify code during review.
2. **Prove with Evidence**: Every finding must quote exact file paths and lines from source.
3. **Meaningful Complexity**: Assess algorithmic time and space complexity ($O(N)$, $O(K)$, $O(B)$) only where it materially impacts Redis workload, memory, or network transfer. Do not flag bounded linear operations without demonstrating real risk.
4. **False-Positive Discipline**: Distinguish confirmed bugs from theoretical considerations. Check configured limits before claiming DoS vulnerabilities.
5. **Acknowledge Strengths**: Note well-implemented patterns and positive architectural decisions alongside improvement areas.

## Core Review Dimensions

1. **TypeScript Quality**: Strict typing, no unjustified `any`, no unsafe casts, discriminated unions, fail-closed validation.
2. **Buffer & Binary Safety**: Binary key round-tripping, lossless UTF-8 verification, canonical Base64 encoding, multibyte boundary truncation.
3. **Security & Read-Only Contract**: No mutating commands (`SET`, `DEL`, `FLUSHDB`, `EVAL`, `KEYS`), no raw command passthrough, credential masking across logs and errors.
4. **Redis Semantics**: Bounded single-step `SCAN`, work hint semantics of `COUNT`, exact TTL states (`-2`, `-1`, `>0`), `MEMORY USAGE` restrictions, race conditions between `TYPE` and `GET`.
5. **MCP Protocol & Transport**: Streamable HTTP statelessness (`sessionIdGenerator: undefined`), STDIO `stderr` logging discipline, structured error envelopes, tool registration schemas.
6. **Complexity & Scalability**: Clamping against configured maximums (`REDIS_MAX_SCAN_COUNT`, `REDIS_MAX_RESULTS`, `REDIS_MAX_VALUE_BYTES`), event loop non-blocking behavior.
7. **Privacy & Data Minimization**: Safe key labels in errors (`binary-key:<hash>`), filtering sensitive server info fields, payload minimization.
8. **Testing & Verification**: Automated unit, security, safety, and protocol-level integration coverage.

## Inspection Checklist

Inspect the following files:
- `package.json` & `tsconfig.json`
- `src/index.ts` & `src/server.ts`
- `src/config/redis-config.ts`
- `src/redis/redis-client.ts`
- `src/schemas/tool-schemas.ts`
- `src/utils/key-codec.ts`
- `src/tools/*.ts`
- `src/errors/*.ts`
- `src/metadata/*.ts`
- `test/*.ts`
- `README.md`, `CONTRIBUTING.md`, `SECURITY.md`
- `Dockerfile` & `compose.yml`

## Finding Format

Format every finding using this structure:

```markdown
### [<SEVERITY>] <Clear Title>
- **Category**: <TypeScript | Security | Performance | Redis | MCP | Privacy | Testing>
- **Location**: [`<path>:<line-range>`](<path>:<line>)
- **Evidence**: <Quote exact code lines or behavior>
- **Why It Matters**: <Explanation of risk or defect>
- **Complexity Impact**: <Time/Space complexity if applicable, e.g. Time: O(K), Space: O(B)>
- **Recommendation**: <Concrete, minimal actionable fix>
- **Required Tests**: <Test cases needed to verify the fix>
- **Breaking Change**: <Yes | No>
- **Confidence**: <High | Medium | Low>
```

Severities: `CRITICAL` | `HIGH` | `MEDIUM` | `LOW` | `INFORMATIONAL`.
