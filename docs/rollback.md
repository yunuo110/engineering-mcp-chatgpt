# Rollback

Rollback removes only the companion and its own configuration/state. It never edits Engineering MCP core, the production ledger, a target workspace ACL, or the reverse proxy's unrelated configuration.

## Stop

Stop the companion process or service created by the operator.

## Disconnect

Remove or disable the corresponding ChatGPT connection or Secure MCP Tunnel association.

## Preserve evidence

Before removal, preserve the companion configuration and authorization records if they are required for audit. Do not publish them.

## Remove deployment-specific entries

Remove only the reverse-proxy route, scheduled task, service, or tunnel association that the operator created for this companion. This repository does not create any of them automatically.

## Remove files

After confirming the exact install root, remove only that root. Remove the configured authorization-state root only after audit retention is complete and after verifying that it contains companion-owned `requests`, `decisions`, and `grants` data.

Reinstalling the package does not restore revoked or expired authority.

