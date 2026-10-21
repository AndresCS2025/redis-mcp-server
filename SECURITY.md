# Security Policy

## Reporting Security Issues

If you discover a security vulnerability or potential credential exposure in `redis-mcp-server`, please **do NOT** open a public issue.

Instead, please report the vulnerability through your enterprise security vulnerability management process or directly to the repository maintainers:

- **Security Contact**: Contact the repository maintainers or file an internal security ticket through your organization's approved security reporting portal.

## Core Security Commitments

1. **Strictly Read-Only**: The server enforces read-only boundaries by construction. Mutating commands will never be included.
2. **Credential Sanitization**: Passwords, tokens, and connection strings are masked across logs, errors, and health endpoints.
3. **No Dynamic Execution**: Dynamic command evaluation or escape hatches (`execute_redis_command`, `EVAL`, `KEYS`) are strictly prohibited.
4. **Dependency Auditing**: Production and development dependencies are audited with `npm audit` to maintain 0 known vulnerabilities.
