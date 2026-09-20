import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWorkspaceAccess } from '../src/core/workspace-access.mjs';

function id(prefix) { return prefix + randomUUID().replaceAll('-', ''); }
function setup() {
  const base = mkdtempSync(join(tmpdir(), 'engineering-workspace-access-'));
  const authz = join(base, 'authz');
  const workspace = join(base, 'workspace');
  const outside = join(base, 'outside');
  mkdirSync(authz); mkdirSync(join(authz, 'requests')); mkdirSync(join(authz, 'decisions')); mkdirSync(join(authz, 'grants'));
  mkdirSync(workspace); mkdirSync(outside);
  writeFileSync(join(workspace, 'hello.txt'), 'alpha\nbeta\n', 'utf8');
  writeFileSync(join(outside, 'secret.txt'), 'outside-secret', 'utf8');
  return { base, authz, workspace, outside, api: createWorkspaceAccess(authz) };
}
function grant(env, request, permissions = ['READ', 'WRITE'], extra = {}) {
  const grantId = id('grant_');
  const now = new Date().toISOString();
  const record = {
    schema: 'engineering-workspace-grant/1',
    grant_id: grantId,
    request_id: request.request_id,
    status: 'GRANTED',
    canonical_root: env.workspace,
    permissions,
    granted_at: now,
    ...extra,
  };
  writeFileSync(join(env.authz, 'grants', grantId + '.json'), JSON.stringify(record), 'utf8');
  writeFileSync(join(env.authz, 'decisions', request.request_id + '.json'), JSON.stringify({
    schema: 'engineering-workspace-decision/1',
    request_id: request.request_id,
    status: 'GRANTED',
    grant_id: grantId,
    decided_at: now,
  }), 'utf8');
  return { grantId, record };
}

test('request remains REQUESTED until a local decision exists; deny is visible', () => {
  const env = setup();
  try {
    const request = env.api.requestWorkspaceAccess({ workspace_root: env.workspace, permissions: ['READ'], reason: 'inspect source' });
    assert.equal(request.ok, true);
    assert.equal(request.status, 'REQUESTED');
    assert.equal(env.api.getWorkspaceAccess({ access_id: request.request_id }).status, 'REQUESTED');
    writeFileSync(join(env.authz, 'decisions', request.request_id + '.json'), JSON.stringify({
      schema: 'engineering-workspace-decision/1', request_id: request.request_id, status: 'DENIED', decided_at: new Date().toISOString(),
    }), 'utf8');
    assert.equal(env.api.getWorkspaceAccess({ access_id: request.request_id }).status, 'DENIED');
  } finally { rmSync(env.base, { recursive: true, force: true }); }
});

test('active grant gates list/read/search/create/replace/rename and never needs an Engineering ledger', () => {
  const env = setup();
  try {
    const request = env.api.requestWorkspaceAccess({ workspace_root: env.workspace, permissions: ['READ', 'WRITE'] });
    const { grantId } = grant(env, request);
    const status = env.api.getWorkspaceAccess({ access_id: grantId });
    assert.equal(status.status, 'GRANTED');
    assert.deepEqual(status.permissions, ['READ', 'WRITE']);

    const listed = env.api.listWorkspace({ grant_id: grantId, depth: 2 });
    assert.equal(listed.ok, true);
    assert.ok(listed.entries.some((entry) => entry.path === 'hello.txt' && entry.type === 'FILE'));

    const read = env.api.readWorkspaceFile({ grant_id: grantId, relative_path: 'hello.txt' });
    assert.equal(read.text, 'alpha\nbeta\n');

    const searched = env.api.searchWorkspace({ grant_id: grantId, query: 'beta' });
    assert.deepEqual(searched.results.map((x) => x.path), ['hello.txt']);

    assert.equal(env.api.writeWorkspaceFile({ grant_id: grantId, relative_path: 'new.txt', operation: 'create', content: 'one' }).ok, true);
    assert.equal(env.api.writeWorkspaceFile({ grant_id: grantId, relative_path: 'new.txt', operation: 'replace', content: 'x' }).ok, true);
    assert.equal(readFileSync(join(env.workspace, 'new.txt'), 'utf8'), 'x');
    assert.equal(env.api.writeWorkspaceFile({ grant_id: grantId, relative_path: 'new.txt', destination_relative_path: 'renamed.txt', operation: 'rename' }).ok, true);
    assert.equal(readFileSync(join(env.workspace, 'renamed.txt'), 'utf8'), 'x');
  } finally { rmSync(env.base, { recursive: true, force: true }); }
});

test('path validation rejects traversal, absolute paths, UNC/device forms and ADS', () => {
  const env = setup();
  try {
    const request = env.api.requestWorkspaceAccess({ workspace_root: env.workspace, permissions: ['READ', 'WRITE'] });
    const { grantId } = grant(env, request);
    for (const relative_path of ['..\\outside\\secret.txt', 'C:\\Windows\\win.ini', '\\\\server\\share\\x', '\\\\?\\C:\\x', 'hello.txt:stream']) {
      const result = env.api.readWorkspaceFile({ grant_id: grantId, relative_path });
      assert.equal(result.ok, false, relative_path);
      assert.equal(result.code, 'RELATIVE_PATH_INVALID', relative_path);
    }
    const write = env.api.writeWorkspaceFile({ grant_id: grantId, relative_path: '..\\escape.txt', operation: 'create', content: 'no' });
    assert.deepEqual(write, { ok: false, code: 'RELATIVE_PATH_INVALID' });
  } finally { rmSync(env.base, { recursive: true, force: true }); }
});

test('reparse/junction traversal is rejected and listing does not recurse through it', (t) => {
  const env = setup();
  try {
    const request = env.api.requestWorkspaceAccess({ workspace_root: env.workspace, permissions: ['READ'] });
    const { grantId } = grant(env, request, ['READ']);
    try { symlinkSync(env.outside, join(env.workspace, 'link'), 'junction'); }
    catch (error) { t.skip('junction creation unavailable in this runner: ' + error.code); return; }
    const listed = env.api.listWorkspace({ grant_id: grantId, depth: 5 });
    assert.ok(listed.entries.some((entry) => entry.path === 'link' && entry.type === 'REPARSE'));
    assert.ok(!listed.entries.some((entry) => entry.path.includes('secret.txt')));
    assert.deepEqual(env.api.readWorkspaceFile({ grant_id: grantId, relative_path: 'link\\secret.txt' }), { ok: false, code: 'WORKSPACE_REPARSE_ESCAPE' });
  } finally { rmSync(env.base, { recursive: true, force: true }); }
});

test('READ and WRITE are independently enforced', () => {
  const env = setup();
  try {
    const request = env.api.requestWorkspaceAccess({ workspace_root: env.workspace, permissions: ['READ'] });
    const { grantId } = grant(env, request, ['READ']);
    assert.equal(env.api.readWorkspaceFile({ grant_id: grantId, relative_path: 'hello.txt' }).ok, true);
    assert.deepEqual(env.api.writeWorkspaceFile({ grant_id: grantId, relative_path: 'x.txt', operation: 'create', content: 'x' }), { ok: false, code: 'PERMISSION_DENIED' });
  } finally { rmSync(env.base, { recursive: true, force: true }); }
});

test('revoked and expired grants fail closed', () => {
  const env = setup();
  try {
    const request = env.api.requestWorkspaceAccess({ workspace_root: env.workspace, permissions: ['READ'] });
    const { grantId, record } = grant(env, request, ['READ']);
    writeFileSync(join(env.authz, 'grants', grantId + '.json'), JSON.stringify({ ...record, status: 'REVOKED', revoked_at: new Date().toISOString() }), 'utf8');
    assert.deepEqual(env.api.readWorkspaceFile({ grant_id: grantId, relative_path: 'hello.txt' }), { ok: false, code: 'GRANT_NOT_ACTIVE' });

    const request2 = env.api.requestWorkspaceAccess({ workspace_root: env.workspace, permissions: ['READ'] });
    const expired = grant(env, request2, ['READ'], { expires_at: new Date(Date.now() - 1000).toISOString() });
    assert.equal(env.api.getWorkspaceAccess({ access_id: expired.grantId }).status, 'EXPIRED');
    assert.deepEqual(env.api.readWorkspaceFile({ grant_id: expired.grantId, relative_path: 'hello.txt' }), { ok: false, code: 'GRANT_EXPIRED' });
  } finally { rmSync(env.base, { recursive: true, force: true }); }
});


