# Redis MCP Server Documentation

Welcome to the technical documentation for `redis-mcp-server`. This documentation provides in-depth technical details, architectural specifications, security models, configuration guides, and operational references.

---

## Documentation Index

| Document | Description |
| :--- | :--- |
| [**Architecture**](architecture.md) | System design, component breakdown, transport models, and lifecycle management. |
| [**Tools Reference**](tools.md) | Comprehensive specifications, inputs, outputs, commands, and examples for all 6 MCP tools. |
| [**Configuration**](configuration.md) | Complete environment variable reference, connection formats, and client configuration examples. |
| [**Security & ACLs**](security.md) | Read-only enforcement, Redis ACL templates, credential masking, data privacy, and TLS. |
| [**Binary Data & Codec**](binary-data.md) | Byte-level preservation, lossless UTF-8 detection, Base64 transport, and cross-tool round-tripping. |
| [**Deployment Guide**](deployment.md) | Running via Node.js, Docker, and Podman, health checking, and production considerations. |
| [**Testing & Verification**](testing.md) | Automated test suites, test categories, protocol verification, and local test workflows. |
| [**Known Limitations**](known-limitations.md) | Documented constraints, supported formats, and intentional design non-goals. |

---

## Quick Navigation

- Looking to connect an MCP client? See [Configuration: Client Configuration](configuration.md#mcp-client-configuration).
- Setting up a secure Redis user? See [Security: Redis ACL Configuration](security.md#redis-acl-configuration).
- Understanding tool parameters and return formats? See [Tools Reference](tools.md).
- Investigating binary or serialized keys? See [Binary Data & Codec](binary-data.md).
