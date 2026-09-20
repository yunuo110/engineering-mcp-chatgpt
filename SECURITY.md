# Security Policy

## Supported release

Security fixes apply to the current `0.1.x` source line.

## Report a vulnerability

Do not include credentials, access tokens, private workspace contents, or production logs in a public issue. Use the maintainer's private security-reporting channel published with the eventual repository. No reporting address is invented in this package.

## Deployment requirements

- Never expose the Private profile to the public Internet.
- Protect the authorization-state directory with operating-system permissions appropriate to the local operator and runtime identity.
- Select the Engineering MCP executable and canonical repository only in protected operator configuration.
- Keep `core.contractVersion` fixed to `engineering-c2c/1`; missing or different values fail closed.
- Do not permit MCP request text to select the executable or repository binding.
- Terminate Remote OAuth traffic at an HTTPS reverse proxy and validate issuer, audience, signature, expiry, and required scopes.
- Keep approval, denial, and revocation on the local operator control plane.
- Treat `UNKNOWN` C2C results as uncertain and retry only with the same stable identities.

See [Threat model](docs/threat-model.md).
