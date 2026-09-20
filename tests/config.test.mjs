import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafePrivateBind, validateConfig } from '../src/auth/config.mjs';

function privateConfig(host = '127.0.0.1') {
  return {
    profile: 'private',
    server: { host, port: 8770, path: '/mcp' },
    auth: { mode: 'none' },
    core: {
      executable: 'engineering-mcp',
      contractVersion: 'engineering-c2c/1',
      repo: 'C:\\EngineeringMCP\\workspace',
      timeoutMs: 45000,
    },
    workspaceAccess: { authzRoot: 'C:\\ProgramData\\EngineeringMCPChatGPT\\authz' },
  };
}

test('private profile accepts loopback and private-address binds', () => {
  for (const host of ['localhost', '127.0.0.1', '10.20.30.40', '172.16.1.2', '172.31.255.254', '192.168.1.2', '::1', 'fd00::1']) {
    assert.equal(isSafePrivateBind(host), true, host);
    assert.equal(validateConfig(privateConfig(host)).auth.mode, 'none');
  }
});

test('private profile fails closed for wildcard and public binds', () => {
  for (const host of ['0.0.0.0', '::', '8.8.8.8', 'mcp.example.com']) {
    assert.throws(() => validateConfig(privateConfig(host)), { code: 'UNSAFE_PUBLIC_NO_AUTH_BIND' });
  }
});

test('private profile cannot select OAuth and remote profile cannot select no-auth', () => {
  const wrongPrivate = privateConfig();
  wrongPrivate.auth = { mode: 'oauth' };
  assert.throws(() => validateConfig(wrongPrivate), { code: 'PRIVATE_AUTH_MODE_INVALID' });

  const wrongRemote = { ...privateConfig(), profile: 'remote-oauth' };
  assert.throws(() => validateConfig(wrongRemote), { code: 'AUTH_CONFIG_INVALID' });
});

test('Core contract version is required and fixed to engineering-c2c/1', () => {
  const missing = privateConfig();
  delete missing.core.contractVersion;
  assert.throws(() => validateConfig(missing), { code: 'CORE_CONFIG_INVALID' });

  const wrong = privateConfig();
  wrong.core.contractVersion = 'engineering-c2c/2';
  assert.throws(() => validateConfig(wrong), { code: 'CORE_CONTRACT_VERSION_INVALID' });
});

test('legacy mandatory binary path and SHA configuration is rejected', () => {
  const legacy = privateConfig();
  legacy.core.clientPath = 'C:\\EngineeringMCP\\bin\\LegacyClient.exe';
  legacy.core.clientSha256 = '0'.repeat(64);
  assert.throws(() => validateConfig(legacy), { code: 'CORE_CONFIG_INVALID' });
});

test('remote OAuth profile validates generic issuer, resource, audience, scopes and JWKS', () => {
  const config = {
    ...privateConfig(),
    profile: 'remote-oauth',
    auth: {
      mode: 'oauth',
      issuer: 'https://id.example.com',
      audience: 'https://mcp.example.com',
      resource: 'https://mcp.example.com',
      jwksUri: 'https://id.example.com/oauth/v2/keys',
      scopes: ['engineering-mcp:execute'],
    },
  };
  const parsed = validateConfig(config);
  assert.equal(parsed.auth.issuer, 'https://id.example.com');
  assert.equal(parsed.auth.audience, parsed.auth.resource);
  assert.deepEqual(parsed.auth.scopes, ['engineering-mcp:execute']);
});

test('remote OAuth resource must be HTTPS and equal the token audience', () => {
  const config = {
    ...privateConfig(),
    profile: 'remote-oauth',
    auth: {
      mode: 'oauth',
      issuer: 'https://id.example.com',
      audience: 'https://mcp.example.com',
      resource: 'https://different.example.com',
      jwksUri: 'https://id.example.com/oauth/v2/keys',
      scopes: ['engineering-mcp:execute'],
    },
  };
  assert.throws(() => validateConfig(config), { code: 'OAUTH_RESOURCE_AUDIENCE_MISMATCH' });
  config.auth.resource = 'http://mcp.example.com';
  assert.throws(() => validateConfig(config), { code: 'OAUTH_RESOURCE_INVALID' });
});

test('remote profile keeps the Node HTTP listener on loopback or a private address', () => {
  const config = {
    ...privateConfig('0.0.0.0'),
    profile: 'remote-oauth',
    auth: {
      mode: 'oauth',
      issuer: 'https://id.example.com',
      audience: 'https://mcp.example.com',
      resource: 'https://mcp.example.com',
      jwksUri: 'https://id.example.com/oauth/v2/keys',
      scopes: ['engineering-mcp:execute'],
    },
  };
  assert.throws(() => validateConfig(config), { code: 'UNSAFE_DIRECT_HTTP_BIND' });
});
