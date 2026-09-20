import { isDeepStrictEqual } from 'node:util';

export const C2C_CONTRACT_VERSION = 'engineering-c2c/1';
export const PUBLIC_TOOL = 'engineering_execute_c2c_plan';
export const PRIVATE_TOOL = 'execute_c2c_plan';
export const BODY_MAX = 128 * 1024;
export const PLAN_MAX = 64 * 1024;

const TASK_STATUSES = ['READY', 'RUNNING', 'BLOCKED', 'FAILED', 'CANCELLED', 'COMPLETED', 'CLOSED'];
const DISPATCH_STATUSES = ['launching', 'running', 'completed', 'blocked', 'failed'];

export function inputSchema(z) {
  const text = (n) => z.string().min(1).max(n);
  return z.object({
    plan_message: z.object({
      protocol_version: z.literal(C2C_CONTRACT_VERSION),
      message_id: text(200), task_id: text(500), sender_role: z.literal('OWNER'), state: z.literal('PLAN'),
      expected_revision: z.number().int().positive(),
      in_reply_to: text(200).optional(), goal: text(16384).optional(), rationale: text(16384).optional(),
      evidence_refs: z.array(text(2048)).max(256).optional(), error: text(16384).optional(),
    }).strict(),
    acceptance_command_id: text(200), delegation_command_id: text(200), worker_profile_id: text(200),
  }).strict();
}

function progressSchema(z) {
  const text = (maximum = 500) => z.string().min(1).max(maximum);
  return z.object({
    plan_message_id: text(200).optional(),
    task_id: text().optional(),
    evaluation: z.object({
      decision: z.enum(['REJECT', 'NOOP_WITH_EXISTING_RECEIPT', 'REQUIRES_OWNER_ACTION', 'READY_FOR_REVIEW']),
      evaluated_revision: z.number().int().positive().optional(),
    }).strict().optional(),
    acceptance: z.object({
      command_id: text(200),
      decision: z.enum(['REJECT', 'ACCEPTED', 'NOOP_WITH_EXISTING_ACCEPTANCE']),
      accepted_revision: z.number().int().positive().optional(),
    }).strict().optional(),
    delegation: z.object({
      command_id: text(200),
      decision: z.enum(['REJECT', 'CREATED', 'NOOP_WITH_EXISTING_DELEGATION']),
      dispatch_run_id: text().optional(),
      worker_profile_id: text(200).optional(),
    }).strict().optional(),
  }).strict();
}

export function coreResultSchema(z) {
  const progress = progressSchema(z);
  return z.discriminatedUnion('ok', [
    progress.required().extend({
      ok: z.literal(true),
      stage: z.literal('launch'),
      launch: z.object({
        state: z.enum(['SPAWNED', 'ALREADY_CLAIMED', 'TERMINAL']),
        dispatch_status: z.enum(DISPATCH_STATUSES),
        task_status: z.enum(TASK_STATUSES),
        physical_spawn_requested: z.boolean(),
        physical_spawn_observed: z.boolean(),
      }).strict(),
    }).strict(),
    progress.extend({
      ok: z.literal(false),
      stage: z.enum(['input', 'evaluation', 'acceptance', 'delegation', 'launch']),
      error: z.object({
        code: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/),
        message: z.string().min(1).max(2048),
      }).strict(),
    }).strict(),
  ]);
}

export function boundedRequest(request, z) {
  const parsed = inputSchema(z).safeParse(request);
  if (!parsed.success) throw new Error('INVALID_C2C_REQUEST');
  const text = JSON.stringify(parsed.data);
  if (Buffer.byteLength(text) > BODY_MAX || Buffer.byteLength(JSON.stringify(parsed.data.plan_message)) > PLAN_MAX) {
    throw new Error('C2C_REQUEST_SIZE_LIMIT');
  }
  return parsed.data;
}

export const uncertain = () => ({
  status: 'UNKNOWN',
  code: 'IPC_OR_CONTROLLER_UNCERTAIN',
  retry: 'RETRY_WITH_SAME_IDENTITIES',
});

export const rejected = (code) => ({ status: 'REJECTED', code });

export function validateCoreToolResponse(raw, z) {
  const responseSchema = z.object({
    content: z.array(z.object({ type: z.literal('text'), text: z.string() }).strict()).length(1),
    structuredContent: coreResultSchema(z),
    isError: z.boolean().optional(),
  }).passthrough();
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new Error('CORE_RESPONSE_SCHEMA_MISMATCH');

  const { content, structuredContent, isError } = parsed.data;
  if (Buffer.byteLength(content[0].text) > BODY_MAX) throw new Error('CORE_RESPONSE_SCHEMA_MISMATCH');
  let contentValue;
  try {
    contentValue = JSON.parse(content[0].text);
  } catch {
    throw new Error('CORE_RESPONSE_SCHEMA_MISMATCH');
  }
  if (!isDeepStrictEqual(contentValue, structuredContent)) throw new Error('CORE_RESPONSE_SCHEMA_MISMATCH');
  if (structuredContent.ok === false ? isError !== true : isError === true) {
    throw new Error('CORE_RESPONSE_SCHEMA_MISMATCH');
  }
  return { status: 'CONTROLLER_RESULT', result: structuredContent };
}
