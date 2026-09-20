# Secure private connection

A ChatGPT service connection cannot reach `localhost` or a private LAN address directly.

OpenAI documents [Secure MCP Tunnel](https://developers.openai.com/plugins/deploy/connect-chatgpt) as the supported developer-mode path for connecting a private MCP server without exposing it to the public Internet. The tunnel can reach an HTTP or stdio MCP server configured for it.

For this package:

1. Keep the Private profile on loopback or a private address.
2. Verify `/healthz` and `/mcp` locally.
3. Configure Secure MCP Tunnel by following the current OpenAI documentation.
4. In ChatGPT Plugins, choose the Tunnel connection method.
5. Review the discovered tools before use.

This repository contains no tunnel enrollment command, workspace association command, or stored tunnel identifier. An exact local walkthrough remains outside this package until the tunnel client is validated on the target environment.

A generic public forwarding tunnel is not equivalent to the Private profile because it creates a public endpoint. Do not expose `auth.mode = "none"` through one.

