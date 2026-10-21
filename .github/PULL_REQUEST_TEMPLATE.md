## Description
<!-- Provide a concise description of the changes and the problem they solve. -->

## Type of Change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New read-only inspection feature (non-breaking change)
- [ ] Documentation improvement
- [ ] Maintenance / Dependency update

## Read-Only & Security Checklist
- [ ] **Strict Read-Only Boundary**: No data-mutating, TTL-mutating, or administrative Redis commands are added or exposed.
- [ ] **No Raw Command Execution**: No dynamic dispatch, raw command passthrough, or `execute_redis_command` tools are added.
- [ ] **No KEYS Command**: Key enumeration uses bounded `SCAN` / `scanBuffer` only.
- [ ] **Bounded Operations**: All inputs, outputs, scan counts, and collection limits are strictly bounded.
- [ ] **Binary Safety**: Binary keys and values are preserved losslessly via Base64/UTF-8.
- [ ] **Credential Masking**: No passwords, tokens, or raw connection strings are exposed in logs, errors, or tool outputs.
- [ ] **ACL Mapping**: Command-to-ACL documentation in `README.md` is updated if new read commands are introduced.

## Verification Checklist
- [ ] `npm run typecheck` passes with 0 errors.
- [ ] `npm test` passes with 100% test coverage for new/modified code.
- [ ] `npm run build` compiles cleanly into `dist/`.
- [ ] `npm audit` reports 0 vulnerabilities.
- [ ] `README.md` and `CONTRIBUTING.md` are updated if applicable.
