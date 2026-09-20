# Engineering MCP Core compatibility

`engineering-mcp-chatgpt` is an optional companion/sidecar plugin. Version `0.1.x` requires the Core-owned private contract:

```text
engineering-c2c/1
```

The companion starts the executable selected by trusted operator configuration with these fixed arguments:

```text
engineering-mcp c2c-client --contract-version engineering-c2c/1 --repo <configured-repository>
```

The resulting MCP stdio server must advertise exactly one private operation:

```text
execute_c2c_plan
```

The companion maps its public `engineering_execute_c2c_plan` tool to that private operation. It never publishes `execute_c2c_plan` in its public `tools/list`.

## Trusted binding

The operator configuration owns:

- `core.executable`
- `core.contractVersion`
- `core.repo`
- optional `core.timeoutMs`

The public request owns only `plan_message`, `acceptance_command_id`, `delegation_command_id`, and `worker_profile_id`. Strict request validation rejects executable, repository, argv, environment, database, process, and execution-identity overrides before Core is invoked.

`core.contractVersion` is required and must equal `engineering-c2c/1`. The companion validates Core `tools/list`, the MCP call envelope, `content`, `structuredContent`, `isError`, and the frozen success/error result schema. A schema mismatch fails closed.

Executable SHA-256 pinning is not a compatibility requirement and is not part of the default configuration. Operators may apply external OS allowlisting, package provenance, or executable controls without changing this contract.

## Frozen semantics

- `report_result` remains the authoritative execution-result path.
- C2C does not replace `report_result`.
- `EXECUTED` is emitted only after the authoritative Engineering lifecycle accepts the execution result.
- Terminal tasks do not need to retain `TaskContract.execution_instance_id`.
- Execution provenance comes from authoritative dispatch and runner identity.
- No wire `execution_id` becomes authoritative identity.
- `READY_FOR_REVIEW` means only that an authoritative result is available and eligible for review.
- C2C does not redefine lifecycle or Store authority.

## Deliberate non-dependencies

The companion does not depend on Core Store implementation, SQLite schema, lifecycle internals, Broker layout, Desktop Bridge internals, or a Core binary hash. It imports no Core source and communicates only through `engineering-c2c/1`.

OAuth/OIDC, identity-provider configuration, ChatGPT setup, Workspace Access, operator grant decisions, reverse proxies, and private-connection guidance remain companion responsibilities.
