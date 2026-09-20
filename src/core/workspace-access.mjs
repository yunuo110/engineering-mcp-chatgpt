import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { win32 as path } from 'node:path';

export const DEFAULT_AUTHZ_ROOT = 'C:\\ProgramData\\EngineeringMCPChatGPT\\authz';
export const WORKSPACE_TOOLS = [
  'request_workspace_access',
  'get_workspace_access',
  'list_workspace',
  'read_workspace_file',
  'search_workspace',
  'write_workspace_file',
];
const REQUEST_MAX = 64 * 1024;
const FILE_READ_MAX = 256 * 1024;
const FILE_WRITE_MAX = 256 * 1024;
const SEARCH_FILE_MAX = 1024 * 1024;
const SEARCH_SCAN_MAX = 5000;
const SEARCH_RESULT_MAX = 100;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const BAD_SEGMENT = /[<>:"|?*\x00-\x1f]/;
const PERMISSIONS = new Set(['READ', 'WRITE']);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
function jsonText(value) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, 'utf8') > REQUEST_MAX) fail('AUTHZ_RECORD_TOO_LARGE');
  return text;
}
function strictObject(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('AUTHZ_RECORD_INVALID');
  const keys = Object.keys(value);
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) fail('AUTHZ_RECORD_INVALID');
  if (keys.some((key) => !required.includes(key) && !optional.includes(key))) fail('AUTHZ_RECORD_INVALID');
  return value;
}
function safeId(value, prefix) {
  if (typeof value !== 'string' || !new RegExp('^' + prefix + '[0-9a-f]{32}$').test(value)) fail('ACCESS_ID_INVALID');
  return value;
}
function assertNoReparseTree(full, code = 'AUTHZ_BOUNDARY_INVALID') {
  const normalized = path.normalize(full);
  const parsed = path.parse(normalized);
  let current = parsed.root;
  for (const segment of normalized.slice(parsed.root.length).split('\\').filter(Boolean)) {
    current = path.join(current, segment);
    if (!existsSync(current)) fail(code);
    const info = lstatSync(current);
    if (info.isSymbolicLink()) fail(code);
  }
}
function fixedDirectory(root, child) {
  const expected = path.join(root, child);
  if (!existsSync(expected)) fail('AUTHZ_NOT_PROVISIONED');
  assertNoReparseTree(expected);
  const info = lstatSync(expected);
  if (!info.isDirectory()) fail('AUTHZ_BOUNDARY_INVALID');
  return expected;
}
function localAbsoluteRoot(raw) {
  if (typeof raw !== 'string' || raw.length < 3 || raw.length > 1024) fail('WORKSPACE_ROOT_INVALID');
  if (raw.includes('\0') || raw.startsWith('\\\\') || raw.startsWith('//') || raw.startsWith('\\\\?\\') || raw.startsWith('\\\\.\\')) fail('WORKSPACE_ROOT_INVALID');
  if (!/^[A-Za-z]:[\\/]/.test(raw) || !path.isAbsolute(raw)) fail('WORKSPACE_ROOT_INVALID');
  const normalized = path.normalize(raw);
  if (normalized.slice(2).includes(':')) fail('WORKSPACE_ROOT_INVALID');
  return normalized.length === 3 && normalized[1] === ':' ? normalized : normalized.replace(/[\\/]+$/, '');
}
function permissionList(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 2) fail('PERMISSIONS_INVALID');
  const values = [...new Set(raw)];
  if (values.length !== raw.length || values.some((v) => !PERMISSIONS.has(v))) fail('PERMISSIONS_INVALID');
  return values.sort();
}
function relativeSegments(raw, allowRoot = true) {
  if (raw === undefined || raw === null || raw === '') {
    if (allowRoot) return [];
    fail('RELATIVE_PATH_REQUIRED');
  }
  if (typeof raw !== 'string' || raw.length > 2048 || raw.includes('\0')) fail('RELATIVE_PATH_INVALID');
  if (path.isAbsolute(raw) || raw.startsWith('\\') || raw.startsWith('/') || raw.includes(':')) fail('RELATIVE_PATH_INVALID');
  const segments = raw.split(/[\\/]+/);
  if (segments.some((s) =>
    s.length < 1 || s === '.' || s === '..' || s.endsWith('.') || s.endsWith(' ') ||
    BAD_SEGMENT.test(s) || RESERVED.test(s)
  )) fail('RELATIVE_PATH_INVALID');
  return segments;
}
function contained(root, targetPath) {
  const rel = path.relative(root, targetPath);
  if (rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel))) return;
  fail('WORKSPACE_ESCAPE');
}
function noReparseChain(root, segments) {
  let current = root;
  const rootInfo = lstatSync(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail('WORKSPACE_ROOT_REPARSE');
  for (const segment of segments) {
    current = path.join(current, segment);
    const info = lstatSync(current);
    if (info.isSymbolicLink()) fail('WORKSPACE_REPARSE_ESCAPE');
  }
  return current;
}
function resolveExisting(root, relative, expected = 'any') {
  const segments = relativeSegments(relative, true);
  const lexical = path.join(root, ...segments);
  contained(root, lexical);
  const walked = noReparseChain(root, segments);
  const resolved = realpathSync.native(walked);
  contained(root, resolved);
  const info = statSync(resolved);
  if (expected === 'file' && !info.isFile()) fail('WORKSPACE_FILE_REQUIRED');
  if (expected === 'directory' && !info.isDirectory()) fail('WORKSPACE_DIRECTORY_REQUIRED');
  return { path: resolved, info, relative: segments.join('\\') };
}
function resolveCreateTarget(root, relative) {
  const segments = relativeSegments(relative, false);
  const leaf = segments[segments.length - 1];
  const parentSegments = segments.slice(0, -1);
  const parent = noReparseChain(root, parentSegments);
  const parentResolved = realpathSync.native(parent);
  contained(root, parentResolved);
  const target = path.join(parentResolved, leaf);
  contained(root, target);
  return { path: target, relative: segments.join('\\') };
}
function parseRecord(file) {
  const bytes = readFileSync(file);
  if (bytes.length < 2 || bytes.length > REQUEST_MAX) fail('AUTHZ_RECORD_INVALID');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('AUTHZ_RECORD_INVALID'); }
  return value;
}
function readGrant(authzRoot, grantId, permission) {
  safeId(grantId, 'grant_');
  const grants = fixedDirectory(authzRoot, 'grants');
  const file = path.join(grants, grantId + '.json');
  if (!existsSync(file)) fail('GRANT_NOT_FOUND');
  const r = strictObject(parseRecord(file),
    ['schema', 'grant_id', 'request_id', 'status', 'canonical_root', 'permissions', 'granted_at'],
    ['expires_at', 'revoked_at']);
  if (r.schema !== 'engineering-workspace-grant/1' || r.grant_id !== grantId) fail('AUTHZ_RECORD_INVALID');
  if (!['GRANTED', 'REVOKED', 'EXPIRED'].includes(r.status)) fail('AUTHZ_RECORD_INVALID');
  const permissions = permissionList(r.permissions);
  if (r.status !== 'GRANTED') fail('GRANT_NOT_ACTIVE');
  if (r.expires_at !== undefined) {
    const expires = Date.parse(r.expires_at);
    if (!Number.isFinite(expires) || expires <= Date.now()) fail('GRANT_EXPIRED');
  }
  if (!permissions.includes(permission)) fail('PERMISSION_DENIED');
  const proposed = localAbsoluteRoot(r.canonical_root);
  if (!existsSync(proposed)) fail('WORKSPACE_ROOT_MISSING');
  assertNoReparseTree(proposed, 'WORKSPACE_ROOT_REPARSE');
  const root = realpathSync.native(proposed);
  const info = lstatSync(root);
  if (!info.isDirectory() || info.isSymbolicLink()) fail('WORKSPACE_ROOT_REPARSE');
  return { record: r, root };
}
function publicError(code) {
  return { ok: false, code };
}
function publicGrant(r) {
  return {
    grant_id: r.grant_id,
    request_id: r.request_id,
    status: r.status,
    canonical_root: r.canonical_root,
    permissions: r.permissions,
    granted_at: r.granted_at,
    ...(r.expires_at ? { expires_at: r.expires_at } : {}),
    ...(r.revoked_at ? { revoked_at: r.revoked_at } : {}),
  };
}
function guard(fn) {
  try { return fn(); }
  catch (error) { return publicError(typeof error?.code === 'string' ? error.code : 'WORKSPACE_ACCESS_FAILED'); }
}

export function createWorkspaceAccess(authzRoot = DEFAULT_AUTHZ_ROOT) {
  localAbsoluteRoot(authzRoot);

  function requestWorkspaceAccess(input) {
    return guard(() => {
      strictObject(input, ['workspace_root', 'permissions'], ['reason']);
      const workspaceRoot = localAbsoluteRoot(input.workspace_root);
      const permissions = permissionList(input.permissions);
      if (input.reason !== undefined && (typeof input.reason !== 'string' || input.reason.length < 1 || input.reason.length > 2000)) fail('REASON_INVALID');
      const requests = fixedDirectory(authzRoot, 'requests');
      const requestId = 'req_' + randomUUID().replaceAll('-', '');
      const record = {
        schema: 'engineering-workspace-request/1',
        request_id: requestId,
        status: 'REQUESTED',
        workspace_root: workspaceRoot,
        permissions,
        ...(input.reason ? { reason: input.reason } : {}),
        created_at: new Date().toISOString(),
      };
      const file = path.join(requests, requestId + '.json');
      const fd = openSync(file, 'wx');
      try { writeSync(fd, Buffer.from(jsonText(record), 'utf8')); }
      finally { closeSync(fd); }
      return {
        ok: true,
        request_id: requestId,
        status: 'REQUESTED',
        workspace_root: workspaceRoot,
        permissions,
      };
    });
  }

  function getWorkspaceAccess(input) {
    return guard(() => {
      strictObject(input, ['access_id']);
      const id = input.access_id;
      if (typeof id !== 'string') fail('ACCESS_ID_INVALID');
      if (id.startsWith('grant_')) {
        const grants = fixedDirectory(authzRoot, 'grants');
        safeId(id, 'grant_');
        const file = path.join(grants, id + '.json');
        if (!existsSync(file)) fail('GRANT_NOT_FOUND');
        const r = parseRecord(file);
        strictObject(r, ['schema', 'grant_id', 'request_id', 'status', 'canonical_root', 'permissions', 'granted_at'], ['expires_at', 'revoked_at']);
        if (r.schema !== 'engineering-workspace-grant/1' || r.grant_id !== id) fail('AUTHZ_RECORD_INVALID');
        permissionList(r.permissions);
        const effectiveStatus = r.status === 'GRANTED' && r.expires_at && Date.parse(r.expires_at) <= Date.now() ? 'EXPIRED' : r.status;
        return { ok: true, ...publicGrant({ ...r, status: effectiveStatus }) };
      }
      safeId(id, 'req_');
      const requests = fixedDirectory(authzRoot, 'requests');
      const requestFile = path.join(requests, id + '.json');
      if (!existsSync(requestFile)) fail('REQUEST_NOT_FOUND');
      const request = parseRecord(requestFile);
      strictObject(request, ['schema', 'request_id', 'status', 'workspace_root', 'permissions', 'created_at'], ['reason']);
      if (request.schema !== 'engineering-workspace-request/1' || request.request_id !== id || request.status !== 'REQUESTED') fail('AUTHZ_RECORD_INVALID');
      const decisions = fixedDirectory(authzRoot, 'decisions');
      const decisionFile = path.join(decisions, id + '.json');
      if (!existsSync(decisionFile)) return { ok: true, request_id: id, status: 'REQUESTED', workspace_root: request.workspace_root, permissions: request.permissions };
      const decision = parseRecord(decisionFile);
      strictObject(decision, ['schema', 'request_id', 'status', 'decided_at'], ['grant_id']);
      if (decision.schema !== 'engineering-workspace-decision/1' || decision.request_id !== id || !['GRANTED', 'DENIED'].includes(decision.status)) fail('AUTHZ_RECORD_INVALID');
      if (decision.status === 'DENIED') return { ok: true, request_id: id, status: 'DENIED', decided_at: decision.decided_at };
      safeId(decision.grant_id, 'grant_');
      const grants = fixedDirectory(authzRoot, 'grants');
      const grant = parseRecord(path.join(grants, decision.grant_id + '.json'));
      return { ok: true, ...publicGrant(grant) };
    });
  }

  function listWorkspace(input) {
    return guard(() => {
      strictObject(input, ['grant_id'], ['relative_path', 'depth']);
      const { root } = readGrant(authzRoot, input.grant_id, 'READ');
      const depth = input.depth === undefined ? 1 : input.depth;
      if (!Number.isInteger(depth) || depth < 1 || depth > 5) fail('DEPTH_INVALID');
      const start = resolveExisting(root, input.relative_path ?? '', 'directory');
      const entries = [];
      const walk = (directory, relBase, remaining) => {
        for (const item of readdirSync(directory, { withFileTypes: true })) {
          if (entries.length >= 1000) fail('LIST_LIMIT');
          const rel = relBase ? relBase + '\\' + item.name : item.name;
          const full = path.join(directory, item.name);
          const info = lstatSync(full);
          const reparse = info.isSymbolicLink();
          entries.push({ path: rel, type: reparse ? 'REPARSE' : info.isDirectory() ? 'DIRECTORY' : info.isFile() ? 'FILE' : 'OTHER' });
          if (!reparse && info.isDirectory() && remaining > 1) walk(full, rel, remaining - 1);
        }
      };
      walk(start.path, start.relative, depth);
      return { ok: true, grant_id: input.grant_id, root: start.relative, entries };
    });
  }

  function readWorkspaceFile(input) {
    return guard(() => {
      strictObject(input, ['grant_id', 'relative_path'], ['offset', 'length']);
      const { root } = readGrant(authzRoot, input.grant_id, 'READ');
      const target = resolveExisting(root, input.relative_path, 'file');
      const offset = input.offset ?? 0;
      const length = input.length ?? FILE_READ_MAX;
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 1 || length > FILE_READ_MAX) fail('READ_RANGE_INVALID');
      const fd = openSync(target.path, 'r');
      try {
        const size = Math.min(length, Math.max(0, target.info.size - offset));
        const bytes = Buffer.alloc(size);
        const count = size === 0 ? 0 : readSync(fd, bytes, 0, size, offset);
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count));
        return { ok: true, grant_id: input.grant_id, relative_path: target.relative, offset, bytes: count, eof: offset + count >= target.info.size, text };
      } finally { closeSync(fd); }
    });
  }

  function searchWorkspace(input) {
    return guard(() => {
      strictObject(input, ['grant_id', 'query'], ['relative_path', 'file_extension', 'max_results']);
      if (typeof input.query !== 'string' || input.query.length < 1 || input.query.length > 500) fail('SEARCH_QUERY_INVALID');
      if (input.file_extension !== undefined && (typeof input.file_extension !== 'string' || !/^\.[A-Za-z0-9._-]{1,20}$/.test(input.file_extension))) fail('SEARCH_EXTENSION_INVALID');
      const maxResults = input.max_results ?? 50;
      if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > SEARCH_RESULT_MAX) fail('SEARCH_LIMIT_INVALID');
      const { root } = readGrant(authzRoot, input.grant_id, 'READ');
      const start = resolveExisting(root, input.relative_path ?? '', 'directory');
      const results = [];
      let scanned = 0;
      const stack = [{ full: start.path, rel: start.relative }];
      while (stack.length) {
        const current = stack.pop();
        for (const item of readdirSync(current.full, { withFileTypes: true })) {
          if (++scanned > SEARCH_SCAN_MAX) fail('SEARCH_SCAN_LIMIT');
          const rel = current.rel ? current.rel + '\\' + item.name : item.name;
          const full = path.join(current.full, item.name);
          const info = lstatSync(full);
          if (info.isSymbolicLink()) continue;
          if (info.isDirectory()) { stack.push({ full, rel }); continue; }
          if (!info.isFile() || info.size > SEARCH_FILE_MAX) continue;
          if (input.file_extension && path.extname(item.name).toLowerCase() !== input.file_extension.toLowerCase()) continue;
          let text;
          try { text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(full)); } catch { continue; }
          const index = text.indexOf(input.query);
          if (index >= 0) {
            results.push({ path: rel, index });
            if (results.length >= maxResults) return { ok: true, grant_id: input.grant_id, results, truncated: true };
          }
        }
      }
      return { ok: true, grant_id: input.grant_id, results, truncated: false };
    });
  }

  function writeWorkspaceFile(input) {
    return guard(() => {
      strictObject(input, ['grant_id', 'relative_path', 'operation'], ['content', 'destination_relative_path']);
      const { root } = readGrant(authzRoot, input.grant_id, 'WRITE');
      if (!['create', 'replace', 'rename'].includes(input.operation)) fail('WRITE_OPERATION_INVALID');
      if (input.operation === 'rename') {
        if (input.content !== undefined || typeof input.destination_relative_path !== 'string') fail('WRITE_REQUEST_INVALID');
        const source = resolveExisting(root, input.relative_path, 'file');
        const destination = resolveCreateTarget(root, input.destination_relative_path);
        if (existsSync(destination.path)) fail('DESTINATION_EXISTS');
        renameSync(source.path, destination.path);
        return { ok: true, grant_id: input.grant_id, operation: 'rename', relative_path: source.relative, destination_relative_path: destination.relative };
      }
      if (input.destination_relative_path !== undefined || typeof input.content !== 'string') fail('WRITE_REQUEST_INVALID');
      const bytes = Buffer.from(input.content, 'utf8');
      if (bytes.length > FILE_WRITE_MAX) fail('WRITE_SIZE_LIMIT');
      if (input.operation === 'create') {
        const target = resolveCreateTarget(root, input.relative_path);
        const fd = openSync(target.path, 'wx');
        try { writeSync(fd, bytes); } finally { closeSync(fd); }
        return { ok: true, grant_id: input.grant_id, operation: 'create', relative_path: target.relative, bytes: bytes.length };
      }
      const target = resolveExisting(root, input.relative_path, 'file');
      writeFileSync(target.path, bytes, { flag: 'w' });
      return { ok: true, grant_id: input.grant_id, operation: 'replace', relative_path: target.relative, bytes: bytes.length };
    });
  }

  return { requestWorkspaceAccess, getWorkspaceAccess, listWorkspace, readWorkspaceFile, searchWorkspace, writeWorkspaceFile };
}

export function registerEngineeringWorkspaceAccess(server, z, authzRoot = DEFAULT_AUTHZ_ROOT) {
  const api = createWorkspaceAccess(authzRoot);
  const text = (n) => z.string().min(1).max(n);
  const accessId = text(64);
  const grantId = text(64);
  const relative = z.string().max(2048).optional();
  const result = (fn) => async (request) => {
    const value = fn(request);
    return {
      ...(value.ok === false ? { isError: true } : {}),
      structuredContent: value,
      content: [{ type: 'text', text: JSON.stringify(value) }],
    };
  };
  server.registerTool('request_workspace_access', {
    title: 'Request workspace access',
    description: 'Create a REQUESTED application-layer workspace access request. This never approves access or changes NTFS permissions.',
    inputSchema: z.object({
      workspace_root: text(1024),
      permissions: z.array(z.enum(['READ', 'WRITE'])).min(1).max(2),
      reason: text(2000).optional(),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, result(api.requestWorkspaceAccess));
  server.registerTool('get_workspace_access', {
    title: 'Get workspace access state',
    description: 'Read REQUESTED/GRANTED/DENIED/REVOKED/EXPIRED application-layer access state by request or grant id.',
    inputSchema: z.object({ access_id: accessId }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, result(api.getWorkspaceAccess));
  server.registerTool('list_workspace', {
    title: 'List granted workspace',
    description: 'List files under an active READ grant. Reparse points are never traversed.',
    inputSchema: z.object({ grant_id: grantId, relative_path: relative, depth: z.number().int().min(1).max(5).optional() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, result(api.listWorkspace));
  server.registerTool('read_workspace_file', {
    title: 'Read granted workspace file',
    description: 'Read UTF-8 file bytes under an active READ grant using a relative path only.',
    inputSchema: z.object({ grant_id: grantId, relative_path: text(2048), offset: z.number().int().nonnegative().optional(), length: z.number().int().min(1).max(FILE_READ_MAX).optional() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, result(api.readWorkspaceFile));
  server.registerTool('search_workspace', {
    title: 'Search granted workspace',
    description: 'Bounded literal UTF-8 content search under an active READ grant. Reparse points are skipped.',
    inputSchema: z.object({ grant_id: grantId, query: text(500), relative_path: relative, file_extension: z.string().regex(/^\.[A-Za-z0-9._-]{1,20}$/).optional(), max_results: z.number().int().min(1).max(SEARCH_RESULT_MAX).optional() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, result(api.searchWorkspace));
  server.registerTool('write_workspace_file', {
    title: 'Write granted workspace file',
    description: 'Create, replace, or rename one file under an active WRITE grant. Paths are relative and cannot traverse reparse points.',
    inputSchema: z.object({
      grant_id: grantId,
      relative_path: text(2048),
      operation: z.enum(['create', 'replace', 'rename']),
      content: z.string().max(FILE_WRITE_MAX).optional(),
      destination_relative_path: text(2048).optional(),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, result(api.writeWorkspaceFile));
}

