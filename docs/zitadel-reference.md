# ZITADEL reference

ZITADEL is recorded as the tested reference provider for the earlier Remote OAuth acceptance. This guide contains no tenant, project, application, resource, or client identifiers from that environment.

Map the generic configuration as follows:

| Companion field | ZITADEL value |
|---|---|
| `auth.issuer` | The exact issuer published by the selected ZITADEL authorization server |
| `auth.audience` | `https://mcp.example.com` or the exact resource identifier configured for deployment |
| `auth.resource` | The same exact canonical resource identifier |
| `auth.jwksUri` | The JWKS URI published by discovery metadata |
| `auth.scopes` | The exact scopes enabled for this MCP resource |

Before connection:

1. Confirm authorization-server or OIDC discovery is reachable over HTTPS.
2. Confirm the discovery metadata advertises PKCE `S256`.
3. Confirm the configured token contains the exact issuer, audience, expiry, and required scopes.
4. Copy the exact ChatGPT redirect URI shown for the connection into the provider configuration when required.
5. Keep all secrets outside this repository.

This is a sanitized provider mapping, not an automated tenant setup.

