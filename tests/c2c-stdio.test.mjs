import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { C2C_CONTRACT_VERSION } from '../src/core/contract.mjs';
import { createCoreC2CExecutor } from '../src/core/c2c-forwarding.mjs';

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mock-core-stdio.mjs');

function request() {
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

function wrapper(mode) {
  const root = mkdtempSync(join(tmpdir(), 'engineering-mcp-chatgpt-core-'));
  const executable = join(root, 'engineering-mcp.cmd');
  writeFileSync(executable, `@echo off\r\n"${process.execPath}" "${fixture}" "${mode}" %*\r\n`, 'utf8');
  return { root, executable };
}

function config(executable) {
  return {
    executable,
    contractVersion: C2C_CONTRACT_VERSION,
    repo: 'C:\\EngineeringMCP\\workspace',
    timeoutMs: 5000,
  };
}

test('mock stdio Core receives engineering-c2c/1 and returns a validated success', {
  skip: process.platform !== 'win32',
}, async () => {
  const mock = wrapper('valid-success');
  try {
    const result = await createCoreC2CExecutor(config(mock.executable))(request());
    assert.equal(result.status, 'CONTROLLER_RESULT');
    assert.equal(result.result.ok, true);
    assert.equal(result.result.plan_message_id, 'message-example');
  } finally {
    rmSync(mock.root, { recursive: true, force: true });
  }
});

test('mock stdio Core success schema mismatch fails closed', {
  skip: process.platform !== 'win32',
}, async () => {
  const mock = wrapper('invalid-success');
  try {
    const result = await createCoreC2CExecutor(config(mock.executable))(request());
    assert.deepEqual(result, { status: 'REJECTED', code: 'CORE_RESPONSE_SCHEMA_MISMATCH' });
  } finally {
    rmSync(mock.root, { recursive: true, force: true });
  }
});

test('mock stdio Core error schema mismatch fails closed', {
  skip: process.platform !== 'win32',
}, async () => {
  const mock = wrapper('invalid-error');
  try {
    const result = await createCoreC2CExecutor(config(mock.executable))(request());
    assert.deepEqual(result, { status: 'REJECTED', code: 'CORE_RESPONSE_SCHEMA_MISMATCH' });
  } finally {
    rmSync(mock.root, { recursive: true, force: true });
  }
});
