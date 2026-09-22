# engineering-mcp-chatgpt

An **optional companion sidecar plugin** for Engineering MCP. It adds a ChatGPT-facing MCP endpoint, strict C2C forwarding, and operator-approved Workspace Access without changing or embedding the Engineering MCP core.

This package requires [Engineering MCP](https://github.com/yunuo110/engineering-mcp) with the private [`engineering-c2c/1` contract](https://github.com/yunuo110/engineering-mcp/blob/main/docs/c2c-private-contract.md), which is now part of Core `main`. The companion invokes the operator-configured `engineering-mcp` executable as:

```text
engineering-mcp c2c-client --contract-version engineering-c2c/1 --repo <configured-repository>
```

The private Core process exposes only `execute_c2c_plan` over MCP stdio. The companion exposes only `engineering_execute_c2c_plan` to ChatGPT. Core implementation is not copied into this package.

> Release status: `0.1.0`, source public on GitHub, npm unpublished. Licensed under Apache-2.0.

## Compatibility

```text
engineering-mcp-chatgpt 0.1.x
  -> requires engineering-c2c/1
  -> invokes private execute_c2c_plan
```

The configured executable and canonical repository are trusted startup/operator configuration. MCP request text cannot select the executable, change the repository binding, or change the contract version. Missing or incorrect versions fail closed.

The companion does not depend on Core Store implementation, SQLite schema, lifecycle internals, Broker layout, a Core binary hash, or OAuth provider internals. OAuth/OIDC, Workspace Access, ChatGPT configuration, and public HTTPS deployment remain companion concerns.

## Choose a path

- **Core only** — install no companion. Use Engineering MCP directly.
- **Local MCP client** — use the core's own local MCP connection; this companion is unnecessary unless Workspace Access or the ChatGPT-facing public tool name is required.
- **ChatGPT without public hosting** — use the Private profile and OpenAI's Secure MCP Tunnel. The server stays on loopback or a private address.
- **Remote ChatGPT** — use the Remote OAuth profile behind an HTTPS reverse proxy with a conforming OAuth/OIDC provider.

ChatGPT cannot directly reach a localhost or private-network MCP endpoint. OpenAI documents Secure MCP Tunnel as the supported developer-mode path for a private MCP server without public exposure. See [Secure private connection](docs/secure-private-connection.md).

## Profiles

| Capability | Private profile | Remote OAuth profile |
|---|---|---|
| C2C | Yes | Yes |
| Workspace Access | Yes | Yes |
| Public Internet | No | Via HTTPS reverse proxy |
| Domain | Not required | Required for the public HTTPS endpoint |
| OAuth provider | Not required | Generic OAuth 2.1/OIDC |
| ChatGPT path | Secure MCP Tunnel | Public HTTPS `/mcp` |
| Beginner friendliness | Recommended | Advanced |

The codebase is shared. Only configuration and the outer authentication/deployment layer change.

## Security boundary

Authentication and Workspace Authorization are separate:

- **Authentication** proves who may reach the MCP server. Private uses `auth.mode = "none"` only on loopback/private binds. Remote verifies bearer tokens against configured issuer, audience, JWKS, and scopes.
- **Workspace Authorization** grants a specific `grant_id`, canonical root, and `READ`/`WRITE` permissions. It is always required for workspace operations, even after OAuth succeeds.

A Private configuration using a wildcard, public IP, or public hostname fails with `UNSAFE_PUBLIC_NO_AUTH_BIND`. There is no insecure override.

## Public tools

Exactly seven tools are registered:

- `engineering_execute_c2c_plan`
- `request_workspace_access`
- `get_workspace_access`
- `list_workspace`
- `read_workspace_file`
- `search_workspace`
- `write_workspace_file`

The private core tool `execute_c2c_plan` is not exposed. Approve, Deny, and Revoke remain operator-only actions. No shell, PowerShell, command prompt, or arbitrary process tool exists.

## Private Quick Start

Requirements: Windows, Node.js 24 or newer, Engineering MCP with `engineering-c2c/1`, and a local NTFS location for authorization state.

```powershell
npm install
powershell -NoProfile -File .\ops\Initialize-PrivateProfile.ps1
```

Then edit `C:\EngineeringMCPChatGPT\config\local.private.json`:

1. Set `core.executable` to the trusted `engineering-mcp` command or absolute executable path selected by the operator.
2. Keep `core.contractVersion` exactly `engineering-c2c/1`.
3. Set `core.repo` to the canonical repository bound to Engineering MCP.
4. Confirm `workspaceAccess.authzRoot` and protect that directory for the operator and runtime identity.
5. Keep `server.host` on loopback or a private address.

Start:

```powershell
$env:ENGINEERING_MCP_CHATGPT_CONFIG='C:\EngineeringMCPChatGPT\config\local.private.json'
npm start
```

Verify `http://127.0.0.1:8770/healthz`, then connect through Secure MCP Tunnel. This repository deliberately omits tunnel-client commands because they have not been validated against this local package. Follow the current [OpenAI connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).

## Workspace approvals

A ChatGPT call creates only a `REQUESTED` record. A local administrator decides it:

```powershell
powershell -NoProfile -File .\ops\Workspace-Access-Control.ps1 -AuthzRoot 'C:\ProgramData\EngineeringMCPChatGPT\authz' -RequestId 'req_00000000000000000000000000000000' -Approve
```

The script demands a typed acknowledgement. Deny and Revoke use the same script. The script never changes the target workspace's NTFS ACL.

For a local pending-request menu and console notification watcher, see [Operator Approval UX V1](docs/operator-approval-ux.md). The menu keeps the existing typed acknowledgement and supports both the companion configuration and the ingress `Get-Constants` boundary.

## Remote profile

Start with `config/oauth.example.json` and [Remote OAuth](docs/remote-oauth.md). The Node server listens on a private address; an HTTPS reverse proxy publishes `https://mcp.example.com/mcp`. Provider values remain generic. ZITADEL is documented only as the tested reference provider.

## Development

```powershell
npm run typecheck
npm test
npm pack --dry-run
```

See [Validation](docs/VALIDATION.md), [Threat model](docs/threat-model.md), and [Packaging map](docs/packaging-map.md).

## License

Apache License 2.0. See [LICENSE](LICENSE). This package contains no NOTICE file because no NOTICE attribution was identified for this contract-only integration.
