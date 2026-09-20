# Connect in ChatGPT

The current OpenAI workflow is documented at [Connect and test your plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt).

## Enable developer mode

1. Open ChatGPT Settings.
2. Select **Security and login**.
3. Turn on **Developer mode**.

Availability is controlled by account and workspace policy.

## Private profile

1. Start this companion on its loopback/private endpoint.
2. Provision a Secure MCP Tunnel using the current OpenAI workflow.
3. Open **ChatGPT Plugins** and select the plus button.
4. Enter a user-facing name and description.
5. Under **Connection**, select **Tunnel** and select the available tunnel or enter its `tunnel_id`.
6. Create the connection.
7. Review the seven discovered tools.

The exact tunnel-client setup is intentionally omitted until validated with this package.

## Remote OAuth profile

1. Confirm the public endpoint is HTTPS and ends in `/mcp`.
2. Confirm protected-resource metadata is available at `/.well-known/oauth-protected-resource`.
3. Open **ChatGPT Plugins** and select the plus button.
4. Enter the HTTPS MCP URL and connection details.
5. Complete OAuth.
6. Create the connection and review the seven discovered tools.

## After tool changes

Restart or deploy the MCP server, open the connection in ChatGPT Plugins, select **Refresh**, confirm the new metadata, then start a new conversation and rerun the affected tests. This is the current official refresh flow for developer-mode MCP connections.

