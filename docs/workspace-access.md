# Workspace Access

Workspace Access is an application-layer authorization system separate from both transport authentication and the Engineering MCP production ledger.

## Lifecycle

```text
REQUESTED -> GRANTED -> REVOKED
          -> GRANTED -> EXPIRED
          -> DENIED
```

Chat-facing tools can create a request, read state, and use an active grant. They cannot approve, deny, or revoke.

## Grant boundary

Every file operation requires:

- `grant_id`
- canonical workspace root stored in the grant
- `READ` or `WRITE`
- relative path

The implementation rejects traversal segments, absolute paths, UNC paths, device paths, alternate data streams, reserved device names, and reparse/junction traversal. Listing identifies reparse points but does not recurse through them.

`READ` gates listing, reading, and searching. `WRITE` gates create, replace, and rename. There is no delete operation and no arbitrary process execution.

## Operator control plane

Use `ops/Workspace-Access-Control.ps1` with an explicit `-AuthzRoot`. Approve, Deny, and Revoke require typed acknowledgements. The operator script writes only companion-owned authorization records and does not change the target workspace's NTFS ACL.

## State isolation

Authorization records stay under the configured companion-owned `authzRoot`. They never enter the Engineering MCP lifecycle or production ledger.

