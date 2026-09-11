import { env } from 'cloudflare:workers';
export type AppEnv = {
  DB: D1Database;
  FILES: R2Bucket;
  APP_URL?: string;
  APP_MODE?: string;
  OPENAI_API_KEY?: string;
  OPENAI_TRANSCRIPTION_MODEL?: string;
  OPENAI_TEXT_MODEL?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  INNGEST_EVENT_KEY?: string;
  INNGEST_SIGNING_KEY?: string;
  APP_ENCRYPTION_KEY?: string;
};
export const runtime = () => env as unknown as AppEnv;
export function localTest() {
  return import.meta.env.DEV && runtime().APP_MODE === 'test';
}
export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assert(
  value: unknown,
  status: number,
  message: string,
): asserts value {
  if (!value) throw new HttpError(status, message);
}
export const stmt = (sql: string, ...args: unknown[]) =>
  runtime()
    .DB.prepare(sql)
    .bind(...args);
// eslint-disable-next-line typescript/no-explicit-any -- Untyped D1 rows are narrowed by service queries and validated at writes.
export async function one<T = Record<string, any>>(
  sql: string,
  ...args: unknown[]
) {
  return await stmt(sql, ...args).first<T>();
}
// eslint-disable-next-line typescript/no-explicit-any -- Untyped D1 rows are narrowed by service queries and validated at writes.
export async function all<T = Record<string, any>>(
  sql: string,
  ...args: unknown[]
) {
  return (await stmt(sql, ...args).all<T>()).results;
}
export async function run(sql: string, ...args: unknown[]) {
  return await stmt(sql, ...args).run();
}
export function batch(statements: D1PreparedStatement[]) {
  return runtime().DB.batch(statements);
}
export async function event(
  orgId: string,
  meetingId: string | null,
  actor: string,
  action: string,
) {
  await run(
    'INSERT INTO events (id,org_id,meeting_id,actor,action,created_at) VALUES (?,?,?,?,?,?)',
    id(),
    orgId,
    meetingId,
    actor,
    action,
    now(),
  );
}
export function integrationStatus() {
  const e = runtime();
  return {
    test: localTest(),
    ai: !!e.OPENAI_API_KEY,
    email: !!(e.RESEND_API_KEY && e.MAIL_FROM && e.APP_ENCRYPTION_KEY),
    jobs: !!(e.INNGEST_EVENT_KEY && e.INNGEST_SIGNING_KEY),
    url: !!e.APP_URL,
  };
}
export function appOrigin(request?: Request) {
  const e = runtime();
  if (e.APP_URL) return new URL(e.APP_URL).origin;
  if (localTest() && request) {
    const u = new URL(request.url);
    if (['localhost', '127.0.0.1'].includes(u.hostname)) return u.origin;
  }
  throw new HttpError(
    503,
    'Endereço HTTPS da plataforma ainda não configurado.',
  );
}
