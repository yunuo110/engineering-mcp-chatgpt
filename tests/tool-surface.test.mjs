import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createCompanionServer } from '../src/server/app.mjs';

function fixtureConfig(authzRoot) {
  return {
    profile: 'private',
    server: { host: '127.0.0.1', port: 0, path: '/mcp' },
    auth: { mode: 'none' },
    core: {
      executable: 'engineering-mcp',
      contractVersion: 'engineering-c2c/1',
      repo: 'C:\\EngineeringMCP\\workspace',
      timeoutMs: 45000,
    },
    workspaceAccess: { authzRoot },
  };
}

test('live MCP discovery exposes exactly the public C2C tool and six Workspace Access tools', async () => {
  const base = mkdtempSync(join(tmpdir(), 'engineering-mcp-chatgpt-'));
  const authz = join(base, 'authz');
  mkdirSync(authz);
  for (const name of ['requests', 'decisions', 'grants']) mkdirSync(join(authz, name));

  const httpServer = createCompanionServer(fixtureConfig(authz), {
    executeCoreC2C: async () => ({
      status: 'UNKNOWN',
      code: 'IPC_OR_CONTROLLER_UNCERTAIN',
      retry: 'RETRY_WITH_SAME_IDENTITIES',
    }),
  });
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });

  const address = httpServer.address();
  const client = new Client({ name: 'surface-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`));
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      [
        'engineering_execute_c2c_plan',
        'get_workspace_access',
        'list_workspace',
        'read_workspace_file',
        'request_workspace_access',
        'search_workspace',
        'write_workspace_file',
      ],
    );
    assert.equal(tools.tools.some((tool) => tool.name === 'execute_c2c_plan'), false);
    assert.equal(tools.tools.some((tool) => /approve|deny|revoke/i.test(tool.name)), false);
  } finally {
    await client.close().catch(() => {});
    await new Promise((resolve) => httpServer.close(resolve));
    rmSync(base, { recursive: true, force: true });
  }
});
