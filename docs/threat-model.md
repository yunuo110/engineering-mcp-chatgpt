# Threat model

## Protected assets

- Engineering MCP controller authority
- caller-stable C2C identities
- companion authorization records
- workspace files covered by active grants
- OAuth bearer tokens
- trusted Core executable and canonical repository binding

## Enforced controls

- Only `engineering_execute_c2c_plan` is public; private `execute_c2c_plan` is not registered.
- C2C input uses a strict four-field request and bounded OWNER PLAN schema.
- Core contract version is fixed to `engineering-c2c/1`; missing or different values fail closed.
- Core executable and repository come only from protected operator configuration, never request text.
- Core MCP `tools/list` and success/error envelopes are schema-validated before results are returned.
- Private no-auth configurations reject public and wildcard binds.
- Remote OAuth verifies signature, issuer, audience, expiry through JWT verification, and all configured scopes.
- Workspace paths reject static traversal, absolute, UNC, device, ADS, symlink, reparse, and junction escapes.
- Approve, Deny, and Revoke remain local operator actions.
- No shell or arbitrary process capability is exposed.

## Explicit V1 limits

The validated path checks establish static traversal and reparse/junction protection. They do **not** establish safety against hostile concurrent filesystem mutation, handle-level TOCTOU, or a reparse race between validation and file use. These limits are documented V1 limits and are not treated as a V1 release blocker.

The operator must protect the companion authorization directory with OS permissions. The package does not infer the correct runtime account.

The stdio contract adapter inherits Engineering MCP availability. Timeout returns `UNKNOWN`; it never creates a new wire execution authority.

## Trust boundaries

- TLS termination and OAuth provider are outside the Node process.
- The compatible core remains authoritative for lifecycle and result acceptance.
- Workspace grants authorize files only; they do not grant Engineering MCP task authority.
