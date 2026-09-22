import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('Windows operator UX fixture tests', { skip: process.platform !== 'win32' }, () => {
  const script = fileURLToPath(new URL('./operator-approval-ux.ps1', import.meta.url));
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /OPERATOR_UX_TESTS_PASS/);
});
