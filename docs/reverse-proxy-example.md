# Reverse proxy example

The companion's Remote OAuth profile listens on a private address. A reverse proxy provides the public HTTPS endpoint.

## Caddy example

Caddy was used as the reverse-proxy implementation in the earlier acceptance topology. It is not a dependency.

```caddyfile
mcp.example.com {
    reverse_proxy 127.0.0.1:8770
}
```

The public MCP URL is:

```text
https://mcp.example.com/mcp
```

The protected-resource metadata URL is:

```text
https://mcp.example.com/.well-known/oauth-protected-resource
```

Requirements:

- Forward the original `Authorization` header.
- Do not rewrite `/mcp` or the well-known metadata path.
- Keep the Node listener unreachable from the public Internet.
- Terminate TLS with a certificate valid for `mcp.example.com`.
- Preserve response status and `WWW-Authenticate` headers.

Any reverse proxy satisfying those requirements can replace Caddy. A VPS, VPN, or WireGuard link belongs to the deployment topology and is not a package dependency.

