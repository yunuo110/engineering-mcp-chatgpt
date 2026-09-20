import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const [mode, ...args] = process.argv.slice(2);
const expected = [
  'c2c-client',
  '--contract-version', 'engineering-c2c/1',
  '--repo', 'C:\\EngineeringMCP\\workspace',
];
if (JSON.stringify(args) !== JSON.stringify(expected)) process.exit(64);

const server = new McpServer({ name: 'mock-engineering-mcp-core', version: '0.0.0' });
server.registerTool('execute_c2c_plan', {
  inputSchema: z.object({
    plan_message: z.object({
      protocol_version: z.literal('engineering-c2c/1'),
      message_id: z.string(),
      task_id: z.string(),
      sender_role: z.literal('OWNER'),
      state: z.literal('PLAN'),
      expected_revision: z.number().int().positive(),
    }).passthrough(),
    acceptance_command_id: z.string(),
    delegation_command_id: z.string(),
    worker_profile_id: z.string(),
  }).strict(),
}, async (request) => {
  let result;
  if (mode === 'invalid-success') {
    result = { ok: true, stage: 'launch' };
  } else if (mode === 'invalid-error') {
    result = { ok: false, stage: 'input', error: { code: 5, message: 'invalid' } };
  } else {
    result = {
      ok: true,
      stage: 'launch',
      plan_message_id: request.plan_message.message_id,
      task_id: request.plan_message.task_id,
      evaluation: { decision: 'REQUIRES_OWNER_ACTION', evaluated_revision: request.plan_message.expected_revision },
      acceptance: {
        command_id: request.acceptance_command_id,
        decision: 'ACCEPTED',
        accepted_revision: request.plan_message.expected_revision,
      },
      delegation: {
        command_id: request.delegation_command_id,
        decision: 'CREATED',
        dispatch_run_id: 'dispatch-example',
        worker_profile_id: request.worker_profile_id,
      },
      launch: {
        state: 'SPAWNED',
        dispatch_status: 'launching',
        task_status: 'READY',
        physical_spawn_requested: true,
        physical_spawn_observed: false,
      },
    };
  }
  return {
    ...(result.ok === false ? { isError: true } : {}),
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
  };
});

await server.connect(new StdioServerTransport());
