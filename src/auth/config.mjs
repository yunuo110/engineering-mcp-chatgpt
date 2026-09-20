import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { win32 as path } from 'node:path';
import { C2C_CONTRACT_VERSION } from '../core/contract.mjs';

const PROFILES = new Set(['private', 'remote-oauth']);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function object(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value;
}

function exactKeys(value, required, optional, code) {
  const keys = Object.keys(value);
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) fail(code);
  if (keys.some((key) => !required.includes(key) && !optional.includes(key))) fail(code);
}

function nonEmpty(value, code, maximum = 2048) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) fail(code);
  return value;
}

function httpsUrl(value, code) {
  nonEmpty(value, code);
  let parsed;
  try { parsed = new URL(value); } catch { fail(code); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) fail(code);
  return parsed.toString().replace(/\/$/, '');
}

function isSafePrivateIp(host) {
  const kind = isIP(host);
  if (kind === 4) {
    const bytes = host.split('.').map(Number);
    return (
      bytes[0] === 127 ||
      bytes[0] === 10 ||
      (bytes[0] === 172 && bytes[1] >= 16 && bytes[1] <= 31) ||
      (bytes[0] === 192 && bytes[1] === 168) ||
      (bytes[0] === 169 && bytes[1] === 254)
    );
  }
  if (kind === 6) {
    const normalized = host.toLowerCase();
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb');
  }
  return false;
}

export function isSafePrivateBind(host) {
  return host === 'localhost' || isSafePrivateIp(host);
}

function validateServer(raw) {
  const server = object(raw, 'SERVER_CONFIG_INVALID');
  exactKeys(server, ['host', 'port', 'path'], [], 'SERVER_CONFIG_INVALID');
  const host = nonEmpty(server.host, 'SERVER_HOST_INVALID', 253);
  if (!Number.isInteger(server.port) || server.port < 1 || server.port > 65535) fail('SERVER_PORT_INVALID');
  if (typeof server.path !== 'string' || !/^\/[A-Za-z0-9._~!$&'()*+,;=:@/-]*$/.test(server.path) || server.path.includes('..')) fail('SERVER_PATH_INVALID');
  return { host, port: server.port, path: server.path };
}

function validateCore(raw) {
  const core = object(raw, 'CORE_CONFIG_INVALID');
  exactKeys(core, ['executable', 'contractVersion', 'repo'], ['timeoutMs'], 'CORE_CONFIG_INVALID');
  const executable = nonEmpty(core.executable, 'CORE_EXECUTABLE_INVALID');
  if (executable.trim() !== executable || executable.includes('\0')) fail('CORE_EXECUTABLE_INVALID');
  if (core.contractVersion !== C2C_CONTRACT_VERSION) fail('CORE_CONTRACT_VERSION_INVALID');
  if (typeof core.repo !== 'string' || !path.isAbsolute(core.repo)) fail('CORE_REPO_INVALID');
  if (core.timeoutMs !== undefined && (!Number.isInteger(core.timeoutMs) || core.timeoutMs < 1000 || core.timeoutMs > 120000)) fail('CORE_CLIENT_TIMEOUT_INVALID');
  return {
    executable,
    contractVersion: C2C_CONTRACT_VERSION,
    repo: path.normalize(core.repo),
    ...(core.timeoutMs ? { timeoutMs: core.timeoutMs } : {}),
  };
}

function validateWorkspaceAccess(raw) {
  const workspaceAccess = object(raw, 'WORKSPACE_ACCESS_CONFIG_INVALID');
  exactKeys(workspaceAccess, ['authzRoot'], [], 'WORKSPACE_ACCESS_CONFIG_INVALID');
  if (typeof workspaceAccess.authzRoot !== 'string' || !path.isAbsolute(workspaceAccess.authzRoot)) fail('AUTHZ_ROOT_INVALID');
  return { authzRoot: path.normalize(workspaceAccess.authzRoot) };
}

function validateAuth(profile, raw) {
  const auth = object(raw, 'AUTH_CONFIG_INVALID');
  if (profile === 'private') {
    exactKeys(auth, ['mode'], [], 'AUTH_CONFIG_INVALID');
    if (auth.mode !== 'none') fail('PRIVATE_AUTH_MODE_INVALID');
    return { mode: 'none' };
  }

  exactKeys(auth, ['mode', 'issuer', 'audience', 'scopes', 'resource', 'jwksUri'], [], 'AUTH_CONFIG_INVALID');
  if (auth.mode !== 'oauth') fail('REMOTE_AUTH_MODE_INVALID');
  const issuer = httpsUrl(auth.issuer, 'OAUTH_ISSUER_INVALID');
  const audience = httpsUrl(auth.audience, 'OAUTH_AUDIENCE_INVALID');
  const resource = httpsUrl(auth.resource, 'OAUTH_RESOURCE_INVALID');
  const jwksUri = httpsUrl(auth.jwksUri, 'OAUTH_JWKS_URI_INVALID');
  if (audience !== resource) fail('OAUTH_RESOURCE_AUDIENCE_MISMATCH');
  if (!Array.isArray(auth.scopes) || auth.scopes.length < 1 || auth.scopes.length > 32) fail('OAUTH_SCOPES_INVALID');
  const scopes = [...new Set(auth.scopes.map((scope) => nonEmpty(scope, 'OAUTH_SCOPES_INVALID', 200)))];
  if (scopes.length !== auth.scopes.length) fail('OAUTH_SCOPES_INVALID');
  return { mode: 'oauth', issuer, audience, resource, jwksUri, scopes };
}

export function validateConfig(raw) {
  const config = object(raw, 'CONFIG_INVALID');
  exactKeys(config, ['profile', 'server', 'auth', 'core', 'workspaceAccess'], [], 'CONFIG_INVALID');
  if (!PROFILES.has(config.profile)) fail('PROFILE_INVALID');
  const server = validateServer(config.server);
  if (config.profile === 'private' && !isSafePrivateBind(server.host)) fail('UNSAFE_PUBLIC_NO_AUTH_BIND');
  if (config.profile === 'remote-oauth' && !isSafePrivateBind(server.host)) fail('UNSAFE_DIRECT_HTTP_BIND');
  return {
    profile: config.profile,
    server,
    auth: validateAuth(config.profile, config.auth),
    core: validateCore(config.core),
    workspaceAccess: validateWorkspaceAccess(config.workspaceAccess),
  };
}

export function loadConfig(file) {
  nonEmpty(file, 'CONFIG_PATH_REQUIRED');
  let raw;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { fail('CONFIG_READ_FAILED'); }
  return validateConfig(raw);
}
