# Sanitized V1 acceptance summary

The frozen V1 system completed production acceptance across phases A-I before this open-source packaging pass. This summary intentionally omits machine names, hostnames, account identifiers, file hashes, release identifiers, ledger locations, raw logs, and audit records.

Validated behavior categories:

- effective operating-system ACL boundary for the accepted deployment
- live discovery of the full 21-tool combined Bridge surface
- Workspace Access request, grant, deny, revoke, and expiry behavior
- thirty negative path-security checks
- static traversal, absolute, UNC, device, ADS, reparse, and junction rejection
- rollback rehearsal
- C2C strict forwarding and authoritative result projection

That acceptance applies to the frozen deployed system, not automatically to every new install of this sanitized package.

This packaging pass adds portable checks for:

- exact public C2C registration
- absence of the private core tool and operator decision tools
- exact `engineering-c2c/1` Core invocation through MCP stdio
- fail-closed missing and incorrect Core contract versions
- trusted executable and repository binding that request text cannot override
- strict Core success and error envelope validation
- Private no-auth bind rejection
- generic OAuth metadata/config validation
- Workspace Access lifecycle and path-security behavior
- live seven-tool MCP discovery
- syntax checks and package contents

No public host, OAuth client, secret, tunnel, npm release, or repository publication is created by this package.

Packaging verification on Node.js 24.13.1:

- 28 of 28 Node tests passed
- 7 source modules passed syntax checks
- 3 PowerShell helpers passed parser checks
- npm dry-run package contained 30 intended files
- npm dependency audit reported zero known vulnerabilities
- publication sanitization and secret scan reported zero findings
- exact source-file hash comparison found zero copied Engineering MCP Core source files

The dry-run package contains no `node_modules`, release staging directories, deployment descriptors, production validation reports, runtime logs, authorization audit records, task XML, or production Bridge-change evidence.
