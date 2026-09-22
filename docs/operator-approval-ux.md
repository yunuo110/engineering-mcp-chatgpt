# Operator Approval UX V1

Workspace Access requests follow `REQUESTED -> GRANTED / DENIED`; a grant then becomes `REVOKED` through a local operator action or `EXPIRED` when its expiry time passes. ChatGPT can submit a request and read its state. It cannot approve, deny, or revoke.

## Start the local menu

For the companion, start an **Administrator PowerShell** and point the menu at the same trusted configuration file used by the running companion:

```powershell
powershell -NoProfile -File .\ops\Workspace-Access-Operator.ps1 -Mode Companion -ConfigPath 'C:\EngineeringMCPChatGPT\config\local.private.json'
```

`-ConfigPath` can be omitted when `ENGINEERING_MCP_CHATGPT_CONFIG` is set. The menu reads only `workspaceAccess.authzRoot` from that file and does not print the configuration. It does not substitute the package's example default for a missing configuration.

For the ingress installation, supply the **trusted, administrator-owned ops directory** that contains its existing `Ingress.Common.psm1` and `Workspace-Access-Control.ps1`:

```powershell
powershell -NoProfile -File .\ops\Workspace-Access-Operator.ps1 -Mode Ingress -IngressOpsPath '<trusted ingress ops directory>'
```

Ingress mode derives the authorization directory from `Get-Constants().Data` in that module and calls the control script in the same directory. Companion mode passes its configured directory through the companion control script's `-AuthzRoot` parameter. The two modes are explicit because the current scripts have different root configuration and parameter contracts. Keep the ingress ops directory under administrator control; the UI imports its module and invokes its fixed control script.

The menu lists pending requests with a full `request_id`, workspace path, permissions, creation time, and the optional reason. A reason containing a token or secret marker is redacted. Choose `A` to approve, `D` to deny, `R` to refresh, `G` to list active grants, `V` to revoke an active grant, or `Q` to quit. Approval expiry choices are `1h`, `8h`, `24h`, and no expiry. A number selects a displayed record; pasted command text is rejected. The existing control script prompts for its exact typed acknowledgement before any decision is written. The UI never writes authorization records itself.

## Request notification

Run a second console in the interactive Windows user session:

```powershell
powershell -NoProfile -File .\ops\Workspace-Access-Operator.ps1 -Mode Companion -ConfigPath 'C:\EngineeringMCPChatGPT\config\local.private.json' -Watch
```

Use `-Mode Ingress -IngressOpsPath '<trusted ingress ops directory>'` for ingress. Watch mode checks for new pending requests every two seconds, prints the workspace path, permissions, and a shortened request ID, beeps when the console supports it, and briefly changes its title. Each request ID triggers once per watcher process. Stop it with Ctrl+C. It reads authorization records but does not require elevation and does not perform decisions. A standard user who lacks read access to the protected authorization directory will receive an access error; use the manual elevated menu in that installation. No task or background service is installed. This package does not register a Windows notification identity, so V1 uses the console watcher instead of Toast.

## Security boundary

The UI accepts only the existing request and grant ID formats, fixed actions, and fixed expiry values. It rejects malformed, oversized, incorrectly shaped, or reparse-point authorization records and local path chains. It lists metadata only; it never displays OAuth configuration or credentials. The notification never approves a request. Neither script changes a target workspace NTFS ACL, exposes a shell command field, modifies the Engineering MCP production ledger, or adds a Chat-facing decision tool. V1 has no GUI.

This source change does not deploy the menu or watcher into an ingress installation. Deployment requires a separate review of the installed ops directory and authorization ACLs; no Scheduled Task change is included.
