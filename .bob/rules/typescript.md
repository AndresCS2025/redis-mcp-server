# TypeScript and Node.js Quality Rules

## 1. Type Safety & Compiler Strictness
- **Strict Mode**: `strict: true` must remain enabled in `tsconfig.json`. All compiler checks (`noImplicitAny`, `strictNullChecks`, `noUnusedLocals`, `noUncheckedIndexedAccess`) are mandatory.
- **No Unjustified `any`**: The `any` type is prohibited. Use `unknown` for unvalidated data and narrow using type guards, Zod schemas, or discriminated unions before use.
- **Unsafe Casts & Assertions**: Avoid `as T` and non-null assertions (`!`). Use explicit checks and throw typed operational errors if expected invariants fail.
- **Discriminated Unions**: Prefer discriminated unions (e.g., `{ encoding: 'utf8', value: string } | { encoding: 'base64', value: string }`) over optional fields for mutually exclusive states.

## 2. Validation Boundaries
- **External vs Internal**: Enforce runtime validation via Zod schemas at system boundaries (MCP tool parameters, environment variables, external payloads). Do not require redundant runtime validation on internal trusted function calls.
- **Single Source of Truth**: Codecs, input schemas, and validation routines must reside in centralized modules (`src/utils/key-codec.ts`, `src/schemas/tool-schemas.ts`). Do not duplicate validation or encoding logic.
- **Fail-Closed Validation**: Invalid external inputs must be rejected immediately before invoking database or system operations.

## 3. Node.js & Buffer Discipline
- **Binary Redis Bytes**: Never assume Redis keys or values are valid UTF-8. Use `Buffer` objects for binary data manipulation.
- **Lossless UTF-8 Detection**: Validate UTF-8 round-trip safety (`Buffer.from(str, 'utf-8').equals(rawBuffer)`) before converting binary data to strings. Fall back to Base64 when bytes do not round-trip.
- **Memory Copying**: Minimize unnecessary `Buffer` copies and allocations. Use `subarray()` over `slice()` when referencing slices of existing buffers.

## 4. Error Handling & Resource Lifecycle
- **Typed Operational Errors**: Throw explicit subclasses of `RedisMcpError` (`KeyNotFoundError`, `TypeMismatchError`, `TimeoutError`, etc.).
- **No Swallowed Errors**: Catch blocks must either handle the error, wrap it in a typed domain error, or report it cleanly. Never leave empty catch blocks.
- **Async & Lifecycle**: All asynchronous operations must use `async/await` with explicit `Promise` handling. Graceful shutdown handlers (`SIGINT`, `SIGTERM`) must cleanly disconnect connections.

## 5. Code Organization & Clean Code
- **Small & Focused**: Functions and modules must have single, well-defined responsibilities.
- **Naming**: Type, function, and variable names must be self-descriptive and domain-accurate.
- **Comments**: Keep comments minimal. Explain *why* a non-obvious decision was made, never *what* the code trivially does.
- **No Speculative Abstraction**: Do not introduce generic layers or interfaces without demonstrated, concrete multi-consumer requirements.
