import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import {
  BODY_MAX,
  C2C_CONTRACT_VERSION,
  PRIVATE_TOOL,
  PUBLIC_TOOL,
  boundedRequest,
  inputSchema,
  rejected,
  uncertain,
  validateCoreToolResponse,
} from './contract.mjs';

function validateCoreConfig(core) {
  if (!core || typeof core !== 'object' || Array.isArray(core)) throw new Error('CORE_CONFIG_INVALID');
  if (typeof core.executable !== 'string' || core.executable.length < 1) throw new Error('CORE_EXECUTABLE_INVALID');
  if (core.contractVersion !== C2C_CONTRACT_VERSION) throw new Error('CORE_CONTRACT_VERSION_INVALID');
  if (typeof core.repo !== 'string' || core.repo.length < 1) throw new Error('CORE_REPO_INVALID');
  const timeoutMs = core.timeoutMs ?? 45000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    throw new Error('CORE_CLIENT_TIMEOUT_INVALID');
  }
  return timeoutMs;
}

export function coreClientParameters(core) {
  validateCoreConfig(core);
  return {
    command: core.executable,
    args: [
      'c2c-client',
      '--contract-version', C2C_CONTRACT_VERSION,
      '--repo', core.repo,
    ],
  };
}

export function createCoreC2CExecutor(core) {
  const timeoutMs = validateCoreConfig(core);
  const parameters = coreClientParameters(core);

  return async function executeCoreC2C(request) {
    const transport = new StdioClientTransport({
      ...parameters,
      stderr: 'pipe',
      maxBufferSize: BODY_MAX,
    });
    transport.stderr?.resume();
    const client = new Client({ name: 'engineering-mcp-chatgpt', version: '0.1.0' });
    try {
      await client.connect(transport);
      const listed = await client.listTools(undefined, { timeout: timeoutMs, maxTotalTimeout: timeoutMs });
      if (listed.tools.length !== 1 || listed.tools[0]?.name !== PRIVATE_TOOL) {
        return rejected('CORE_TOOL_SURFACE_MISMATCH');
      }
      const raw = await client.callTool(
        { name: PRIVATE_TOOL, arguments: request },
        undefined,
        { timeout: timeoutMs, maxTotalTimeout: timeoutMs },
      );
      try {
        return validateCoreToolResponse(raw, z);
      } catch {
        return rejected('CORE_RESPONSE_SCHEMA_MISMATCH');
      }
    } catch {
      return uncertain();
    } finally {
      await client.close().catch(() => transport.close().catch(() => {}));
    }
  };
}

export function registerEngineeringC2CForwarder(server, schemaLibrary, executeCoreC2C) {
  if (typeof executeCoreC2C !== 'function') throw new Error('CORE_EXECUTOR_REQUIRED');

  server.registerTool(PUBLIC_TOOL, {
    title: 'Execute an Engineering C2C PLAN',
    description: 'Forward one OWNER PLAN through engineering-c2c/1 using stable caller-supplied identities. Timeout is UNKNOWN; retry only with the same identities. Does not create tasks.',
    inputSchema: inputSchema(schemaLibrary),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  }, async (request) => {
    let input;
    try {
      input = boundedRequest(request, schemaLibrary);
    } catch {
      const result = rejected('INVALID_C2C_REQUEST');
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    }
    const result = await executeCoreC2C(input);
    return {
      ...(result.status !== 'CONTROLLER_RESULT' || result.result.ok === false ? { isError: true } : {}),
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
    };
  });
}
