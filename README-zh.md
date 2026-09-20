# engineering-mcp-chatgpt

这是 Engineering MCP 的**可选 companion sidecar plugin**。它提供面向 ChatGPT 的 MCP 入口、严格 C2C 转发和由本机操作员批准的 Workspace Access；它不修改、不内嵌 Engineering MCP core。

本包要求 [Engineering MCP](https://github.com/yunuo110/engineering-mcp) 包含私有 [`engineering-c2c/1` contract](https://github.com/yunuo110/engineering-mcp/blob/feat/private-c2c-contract-v1/docs/c2c-private-contract.md)。该 contract 位于 [Core PR #2](https://github.com/yunuo110/engineering-mcp/pull/2)；必须使用包含它的 Core release 或 branch，不能把当前 Core `main` 当作已包含该 contract。插件通过操作员配置的 `engineering-mcp` executable 启动：

```text
engineering-mcp c2c-client --contract-version engineering-c2c/1 --repo <configured-repository>
```

Core 私有进程通过 MCP stdio 只暴露 `execute_c2c_plan`；插件对 ChatGPT 只暴露 `engineering_execute_c2c_plan`。插件不复制 Core 实现。

> 发布状态：`0.1.0`，源码已公开于 GitHub，npm 未发布。许可证为 Apache-2.0。

## 兼容性

```text
engineering-mcp-chatgpt 0.1.x
  -> requires engineering-c2c/1
  -> invokes private execute_c2c_plan
```

Core executable 与 canonical repository 只能来自受信任的启动/操作员配置。MCP 请求文本不能选择 executable、覆盖 repository binding 或改变 contract version。版本缺失或错误时直接拒绝。

插件不依赖 Core Store 实现、SQLite schema、lifecycle 内部逻辑、Broker 布局、Core binary hash 或 OAuth provider 内部实现。OAuth/OIDC、Workspace Access、ChatGPT 配置和公网 HTTPS 部署仍属于 companion 范围。

## 如何选择

- **只用 core**：不安装本 companion。
- **本地 MCP client**：直接使用 core 的本地 MCP；只有需要 Workspace Access 或 ChatGPT 公共工具名时才安装本 companion。
- **ChatGPT、不做公网托管**：使用默认 Private profile，通过 OpenAI Secure MCP Tunnel 连接。
- **远程 ChatGPT**：使用 Remote OAuth profile，在 HTTPS 反向代理后部署，并连接符合要求的 OAuth/OIDC provider。

ChatGPT 不能直接访问 localhost 或私有网络 MCP 地址。OpenAI 官方文档把 Secure MCP Tunnel 定义为开发者模式下连接私有 MCP、且无需公网暴露的路径。详见 [私有安全连接](docs/secure-private-connection.md)。

## 两种 profile

| 能力 | Private profile | Remote OAuth profile |
|---|---|---|
| C2C | 支持 | 支持 |
| Workspace Access | 支持 | 支持 |
| 公网 | 禁止 | 由 HTTPS 反向代理提供 |
| 域名 | 不需要 | 公共 HTTPS 端点需要 |
| OAuth provider | 不需要 | 通用 OAuth 2.1/OIDC |
| ChatGPT 连接路径 | Secure MCP Tunnel | 公共 HTTPS `/mcp` |
| 入门难度 | 推荐默认 | 高级 |

两种 profile 共用同一套代码，只改变配置和外层认证/部署拓扑。

## 两层权限必须分开

- **Authentication**：决定谁能到达 MCP server。Private 的 `auth.mode = "none"` 只允许 loopback/private bind；Remote 校验 issuer、audience、JWKS 和 scopes。
- **Workspace Authorization**：用 `grant_id`、canonical root 和 `READ`/`WRITE` 权限约束每一次工作区操作。即使 OAuth 已通过，也不能跳过这一层。

Private 配置若使用通配地址、公网 IP 或公网主机名，将以 `UNSAFE_PUBLIC_NO_AUTH_BIND` 失败；不存在不安全覆盖选项。

## Chat-facing 工具

公开工具严格为七个：

- `engineering_execute_c2c_plan`
- `request_workspace_access`
- `get_workspace_access`
- `list_workspace`
- `read_workspace_file`
- `search_workspace`
- `write_workspace_file`

私有 `execute_c2c_plan` 不对 ChatGPT 暴露。Approve、Deny、Revoke 仅允许本机操作员执行。插件没有 shell、PowerShell、cmd 或任意进程工具。

## Private Quick Start

要求：Windows、Node.js 24 或更高版本、提供 `engineering-c2c/1` 的 Engineering MCP，以及位于本地 NTFS 的 authz state。

```powershell
npm install
powershell -NoProfile -File .\ops\Initialize-PrivateProfile.ps1
```

编辑 `C:\EngineeringMCPChatGPT\config\local.private.json`：

1. 把 `core.executable` 设置为操作员选择的可信 `engineering-mcp` 命令或绝对 executable 路径。
2. 保持 `core.contractVersion` 严格等于 `engineering-c2c/1`。
3. 把 `core.repo` 设置为 Engineering MCP 绑定的 canonical repository。
4. 核对 `workspaceAccess.authzRoot`，并只向操作员和运行身份开放该目录。
5. 保持 `server.host` 为 loopback 或私有地址。

启动：

```powershell
$env:ENGINEERING_MCP_CHATGPT_CONFIG='C:\EngineeringMCPChatGPT\config\local.private.json'
npm start
```

先检查 `http://127.0.0.1:8770/healthz`，再通过 Secure MCP Tunnel 连接。本仓库不提供未经本机验证的 tunnel-client 命令；请遵循当前 [OpenAI 官方连接指南](https://developers.openai.com/plugins/deploy/connect-chatgpt)。

## Workspace Access 审批

ChatGPT 只能创建 `REQUESTED`。本机管理员执行决策：

```powershell
powershell -NoProfile -File .\ops\Workspace-Access-Control.ps1 -AuthzRoot 'C:\ProgramData\EngineeringMCPChatGPT\authz' -RequestId 'req_00000000000000000000000000000000' -Approve
```

脚本要求人工输入完整确认文本。Deny、Revoke 使用同一脚本。它不会修改目标 workspace 的 NTFS ACL。

## Remote OAuth

从 `config/oauth.example.json` 开始，并阅读 [Remote OAuth](docs/remote-oauth.md)。Node server 监听私有地址，由 HTTPS 反向代理发布 `https://mcp.example.com/mcp`。所有 provider 值均为通用示例；ZITADEL 只作为已测试的 reference provider 记录。

## 验证

```powershell
npm run typecheck
npm test
npm pack --dry-run
```

继续阅读 [验收摘要](docs/VALIDATION.md)、[威胁模型](docs/threat-model.md) 和 [打包映射](docs/packaging-map.md)。

## 许可证

Apache License 2.0，全文见 [LICENSE](LICENSE)。本插件采用 contract-only 集成，未发现需要写入 NOTICE 的归属声明，因此不创建 NOTICE。
