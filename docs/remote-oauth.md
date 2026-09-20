# Remote OAuth profile

The Remote OAuth profile publishes the companion through an HTTPS reverse proxy and authenticates every MCP POST with OAuth 2.1/OIDC-compatible bearer tokens.

## Required configuration

`config/oauth.example.json` defines these exact fields:

- `auth.issuer` — canonical HTTPS issuer.
- `auth.audience` — expected token audience.
- `auth.resource` — canonical HTTPS MCP resource identifier; this implementation requires it to equal `auth.audience`.
- `auth.jwksUri` — HTTPS JWKS endpoint used for signature verification.
- `auth.scopes` — every listed scope must be present.
- `server.host` and `server.port` — private listener used by the reverse proxy.

The example values are non-production placeholders.

## Resource metadata

The server publishes:

```text
GET /.well-known/oauth-protected-resource
```

It returns `resource`, `authorization_servers`, and `scopes_supported`. Unauthorized MCP requests receive a `WWW-Authenticate` challenge referring to this metadata.

OpenAI's [authentication guide](https://developers.openai.com/plugins/build/auth) requires protected-resource metadata, authorization-server discovery, the `resource` parameter, OAuth client identification/registration, and PKCE S256 support.

## HTTPS topology

The Node process stays on loopback or a private address. A reverse proxy terminates TLS and forwards only to that listener. See [Reverse proxy example](reverse-proxy-example.md).

## Provider status

ZITADEL is the tested reference provider from the earlier acceptance environment. This package uses no provider-specific runtime code. No other provider is claimed as validated.

