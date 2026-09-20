# Private profile quick start

The Private profile is the default and recommended starting point. It needs no OAuth provider, DNS, public host, reverse proxy, VPN, or public IP.

## 1. Install dependencies

Use Node.js 24 or newer:

```powershell
npm install
```

## 2. Create local configuration and state folders

```powershell
powershell -NoProfile -File .\ops\Initialize-PrivateProfile.ps1
```

The helper refuses to overwrite an existing local configuration.

## 3. Bind to Engineering MCP Core

Install an Engineering MCP version that provides `engineering-c2c/1`. Set these operator-owned values:

- `core.executable` — trusted `engineering-mcp` command or absolute executable path
- `core.contractVersion` — exactly `engineering-c2c/1`
- `core.repo` — canonical Engineering MCP repository

The companion launches:

```text
engineering-mcp c2c-client --contract-version engineering-c2c/1 --repo <configured-repository>
```

Request text cannot replace these values. The package does not discover, copy, patch, or replace Core and does not require a Core binary SHA-256.

## 4. Protect authorization state

The default is `C:\ProgramData\EngineeringMCPChatGPT\authz`. It contains requests, decisions, and grants. Configure OS permissions for the local operator and the runtime identity before use. This setup does not modify any target workspace ACL.

## 5. Start locally

```powershell
$env:ENGINEERING_MCP_CHATGPT_CONFIG='C:\EngineeringMCPChatGPT\config\local.private.json'
npm start
```

The example listens on `127.0.0.1:8770`. Wildcard addresses, public IP addresses, and public hostnames fail closed when `auth.mode` is `none`.

## 6. Connect ChatGPT

ChatGPT requires a public HTTPS endpoint or OpenAI Secure MCP Tunnel. For this profile, use the tunnel path described in [Secure private connection](secure-private-connection.md). No locally unverified tunnel-client command is included here.
