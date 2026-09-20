# Packaging map

## Included

- frozen C2C request and response contract
- `engineering-c2c/1` MCP stdio adapter with trusted executable and repository configuration
- Workspace Access implementation
- standalone Streamable HTTP MCP server
- Private and Remote OAuth configuration validation
- generic JWT/JWKS OAuth verification and protected-resource metadata
- local operator Workspace Access control script
- sanitized examples, documentation, and portable tests

## Rewritten for portability

- the generated production client binding became the Core-owned `engineering-c2c/1` contract
- the production Bridge patch became an independent server entrypoint
- the operator control script now requires an explicit companion-owned authorization root
- deployment-specific setup became non-overwriting profile initialization helpers

## Excluded

- built broker and pipe-client executables
- staged release directories and archived release bundles
- release and deployment descriptor files
- before/after production Bridge evidence
- scheduled-task definitions
- runtime diagnostic output
- authorization audit records
- production validation reports
- host/account bindings
- production ledger locations and hashes
- OAuth credentials, tokens, tenant values, and application identifiers
- Desktop Bridge source or binaries
- Engineering MCP core implementation

The exclusions prevent production evidence and machine bindings from becoming runtime constants or distributable artifacts.

## Source provenance

The plugin contains no copied Engineering MCP Core source file. Its C2C modules implement the companion side of the published `engineering-c2c/1` request, response, and tool-name contract. An exact SHA-256 comparison between plugin `src/` files and Core `src/` files found zero identical source files during this publication pass.

Dependencies are installed from npm and are not vendored into the package. No third-party or Core NOTICE attribution is copied into this project, so this package does not create a NOTICE file.
