import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  C2C_CONTRACT_VERSION,
  PRIVATE_TOOL,
  PUBLIC_TOOL,
  boundedRequest,
  validateCoreToolResponse,
} from '../src/core/contract.mjs';
import { coreClientParameters, registerEngineeringC2CForwarder } from '../src/core/c2c-forwarding.mjs';

function validRequest() {
  return {
    plan_message: {
      protocol_version: C2C_CONTRACT_VERSION,
      message_id: 'message-example',
      task_id: 'task-example',
      sender_role: 'OWNER',
      state: 'PLAN',
      expected_revision: 1,
    },
    acceptance_command_id: 'accept-example',
    delegation_command_id: 'delegate-example',
    worker_profile_id: 'worker-example',
  };
}

function successfulCoreResult() {
  return {
    ok: true,
    stage: 'launch',
    plan_message_id: 'message-example',
    task_id: 'task-example',
    evaluation: { decision: 'REQUIRES_OWNER_ACTION', evaluated_revision: 1 },
    acceptance: { command_id: 'accept-example', decision: 'ACCEPTED', accepted_revision: 1 },
    delegation: {
      command_id: 'delegate-example',
      decision: 'CREATED',
      dispatch_run_id: 'dispatch-example',
      worker_profile_id: 'worker-example',
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

function registration(executor) {
  const registrations = new Map();
  const server = {
    registerTool(name, metadata, handler) {
      registrations.set(name, { metadata, handler });
    },
  };
  registerEngineeringC2CForwarder(server, z, executor);
  return registrations;
}

test('trusted startup config fixes the engineering-c2c/1 invocation', () => {
  assert.deepEqual(coreClientParameters({
    executable: 'engineering-mcp',
    contractVersion: C2C_CONTRACT_VERSION,
    repo: 'C:\\EngineeringMCP\\workspace',
  }), {
    command: 'engineering-mcp',
    args: [
      'c2c-client',
      '--contract-version', C2C_CONTRACT_VERSION,
      '--repo', 'C:\\EngineeringMCP\\workspace',
    ],
  });
});

test('public C2C request keeps the frozen exact surface', () => {
  assert.equal(boundedRequest(validRequest(), z).plan_message.state, 'PLAN');
  for (const extra of [
    'tool', 'method', 'repo', 'executable', 'contractVersion', 'db', 'argv', 'environment',
    'execution_instance_id',
  ]) {
    const request = validRequest();
    request[extra] = 'forbidden';
    assert.throws(() => boundedRequest(request, z), /INVALID_C2C_REQUEST/);
  }
});

test('Core success and error envelopes are validated strictly', () => {
  const success = successfulCoreResult();
  assert.deepEqual(validateCoreToolResponse({
    content: [{ type: 'text', text: JSON.stringify(success) }],
    structuredContent: success,
  }, z), { status: 'CONTROLLER_RESULT', result: success });

  const failure = {
    ok: false,
    stage: 'input',
    error: { code: 'INVALID_PROTOCOL_VERSION', message: 'Core rejected the request.' },
  };
  assert.deepEqual(validateCoreToolResponse({
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(failure) }],
    structuredContent: failure,
  }, z), { status: 'CONTROLLER_RESULT', result: failure });
});

test('Core success response schema mismatch fails closed', () => {
  const invalid = { ok: true, stage: 'launch' };
  assert.throws(() => validateCoreToolResponse({
    content: [{ type: 'text', text: JSON.stringify(invalid) }],
    structuredContent: invalid,
  }, z), /CORE_RESPONSE_SCHEMA_MISMATCH/);
});

test('Core error envelope schema mismatch fails closed', () => {
  const invalid = { ok: false, stage: 'input', error: { code: 5, message: 'invalid' } };
  assert.throws(() => validateCoreToolResponse({
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(invalid) }],
    structuredContent: invalid,
  }, z), /CORE_RESPONSE_SCHEMA_MISMATCH/);
});

test('public registration forwards only to private execute_c2c_plan semantics', async () => {
  let forwarded;
  const registrations = registration(async (request) => {
    forwarded = request;
    return { status: 'CONTROLLER_RESULT', result: successfulCoreResult() };
  });
  assert.deepEqual([...registrations.keys()], [PUBLIC_TOOL]);
  assert.equal(registrations.has(PRIVATE_TOOL), false);

  const result = await registrations.get(PUBLIC_TOOL).handler(validRequest());
  assert.deepEqual(forwarded, validRequest());
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.status, 'CONTROLLER_RESULT');
});

test('request payload cannot override trusted executable or repository binding', async () => {
  let calls = 0;
  const registrations = registration(async () => {
    calls += 1;
    return { status: 'CONTROLLER_RESULT', result: successfulCoreResult() };
  });
  for (const field of ['executable', 'repo']) {
    const request = validRequest();
    request[field] = 'untrusted-request-value';
    const result = await registrations.get(PUBLIC_TOOL).handler(request);
    assert.equal(result.isError, true);
    assert.deepEqual(result.structuredContent, { status: 'REJECTED', code: 'INVALID_C2C_REQUEST' });

    const nested = validRequest();
    nested.plan_message[field] = 'untrusted-request-value';
    const nestedResult = await registrations.get(PUBLIC_TOOL).handler(nested);
    assert.equal(nestedResult.isError, true);
    assert.deepEqual(nestedResult.structuredContent, { status: 'REJECTED', code: 'INVALID_C2C_REQUEST' });
  }
  assert.equal(calls, 0);
});
