import { createServer as createHttpServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createCoreC2CExecutor, registerEngineeringC2CForwarder } from '../core/c2c-forwarding.mjs';
import { registerEngineeringWorkspaceAccess } from '../core/workspace-access.mjs';
import { createOAuthGuard, protectedResourceMetadata } from '../auth/oauth.mjs';

const BODY_LIMIT = 1024 * 1024;

function json(res, status, value, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(value));
}

async function requestBody(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > BODY_LIMIT) throw new Error('HTTP_BODY_LIMIT');
    chunks.push(chunk);
  }
  if (length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function registerTools(server, config, executeCoreC2C) {
  registerEngineeringC2CForwarder(server, z, executeCoreC2C);
  registerEngineeringWorkspaceAccess(server, z, config.workspaceAccess.authzRoot);
}

export function createCompanionServer(config, options = {}) {
  const executeCoreC2C = options.executeCoreC2C ?? createCoreC2CExecutor(config.core);
  const authenticate = config.auth.mode === 'oauth' ? createOAuthGuard(config.auth) : null;

  return createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/healthz') {
        json(res, 200, { status: 'ok', profile: config.profile });
        return;
      }

      if (
        config.auth.mode === 'oauth' &&
        req.method === 'GET' &&
        url.pathname === '/.well-known/oauth-protected-resource'
      ) {
        json(res, 200, protectedResourceMetadata(config.auth), { 'cache-control': 'public, max-age=300' });
        return;
      }

      if (url.pathname !== config.server.path) {
        json(res, 404, { error: 'not_found' });
        return;
      }

      if (req.method !== 'POST') {
        res.setHeader('allow', 'POST');
        json(res, 405, { error: 'method_not_allowed' });
        return;
      }

      if (authenticate && !(await authenticate(req, res))) return;

      const body = await requestBody(req);
      const mcp = new McpServer(
        { name: 'engineering-mcp-chatgpt', version: '0.1.0' },
        {
          instructions: 'Optional Engineering MCP companion. Workspace authorization is separate from transport authentication. The only public C2C entry is engineering_execute_c2c_plan.',
        },
      );
      registerTools(mcp, config, executeCoreC2C);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        transport.close().catch(() => {});
        mcp.close().catch(() => {});
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      if (!res.headersSent) {
        json(res, error?.message === 'HTTP_BODY_LIMIT' ? 413 : 400, { error: 'invalid_request' });
      } else {
        res.end();
      }
    }
  });
}
