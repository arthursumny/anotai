import { all, one, run, assert, now, id, localTest } from './runtime';
export const token = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
export async function hash(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
    (x) => x.toString(16).padStart(2, '0'),
  ).join('');
}
export function cookie(request: Request, name: string) {
  return (
    (request.headers.get('cookie') || '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(name + '='))
      ?.slice(name.length + 1) || ''
  );
}
export function sessionCookie(value: string, clear = false) {
  return `anota_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 604800}${localTest() ? '' : '; Secure'}`;
}
export async function user(request: Request) {
  const s = cookie(request, 'anota_session');
  assert(s, 401, 'Entre para continuar.');
  const u = await one(
    'SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires_at>?',
    await hash(s),
    now(),
  );
  assert(u, 401, 'Sua sessão expirou. Entre novamente.');
  return u;
}
export async function context(request: Request) {
  const u = await user(request);
  const requested =
    request.headers.get('x-organization-id') ||
    new URL(request.url).searchParams.get('org');
  const m = await one(
    'SELECT m.*,o.name AS org_name,o.business,o.timezone FROM memberships m JOIN organizations o ON o.id=m.org_id WHERE m.user_id=?' +
      (requested ? ' AND m.org_id=?' : '') +
      ' ORDER BY o.created_at LIMIT 1',
    ...(requested ? [u.id, requested] : [u.id]),
  );
  assert(m, 409, 'Cadastre sua organização para continuar.');
  return {
    user: u,
    org: m,
    orgId: m.org_id as string,
    admin: m.role === 'admin',
  };
}
export type Context = Awaited<ReturnType<typeof context>>;
export async function meetingAccess(
  c: Context,
  meetingId: string,
  edit = false,
) {
  const m = await one(
    'SELECT * FROM meetings WHERE id=? AND org_id=?',
    meetingId,
    c.orgId,
  );
  assert(m, 404, 'Reunião não encontrada.');
  if (!c.admin && m.organizer_id !== c.user.id) {
    const p = await one(
      'SELECT p.id FROM participants p JOIN meeting_participants mp ON mp.participant_id=p.id WHERE mp.meeting_id=? AND p.org_id=? AND p.email=?',
      meetingId,
      c.orgId,
      c.user.email,
    );
    assert(p && !edit, 403, 'Você não tem permissão para esta ação.');
  }
  return m;
}
export async function visibleMeetings(c: Context) {
  return await all(
    'SELECT m.* FROM meetings m WHERE m.org_id=?' +
      (c.admin
        ? ''
        : ' AND (m.organizer_id=? OR EXISTS(SELECT 1 FROM meeting_participants mp JOIN participants p ON p.id=mp.participant_id WHERE mp.meeting_id=m.id AND p.email=? AND p.org_id=m.org_id))') +
      ' ORDER BY m.scheduled_at DESC',
    ...(c.admin ? [c.orgId] : [c.orgId, c.user.id, c.user.email]),
  );
}
export function checkOrigin(request: Request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const origin = request.headers.get('origin');
  assert(
    origin === new URL(request.url).origin,
    403,
    'Origem da solicitação inválida.',
  );
}
export async function limit(key: string, max: number, seconds: number) {
  const until = new Date(Date.now() + seconds * 1000).toISOString();
  const r = await one(
    'INSERT INTO rate_limits (key,count,until) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.until<? THEN 1 ELSE rate_limits.count+1 END, until=CASE WHEN rate_limits.until<? THEN excluded.until ELSE rate_limits.until END RETURNING count',
    key,
    until,
    now(),
    now(),
  );
  assert(
    r && r.count <= max,
    429,
    'Muitas tentativas. Aguarde alguns minutos.',
  );
}
export async function createSession(userId: string) {
  const raw = token();
  await run(
    'INSERT INTO sessions (hash,user_id,expires_at) VALUES (?,?,?)',
    await hash(raw),
    userId,
    new Date(Date.now() + 7 * 86400000).toISOString(),
  );
  return raw;
}
export async function ensureUser(email: string, name: string) {
  await run(
    'INSERT INTO users (id,email,name,created_at) VALUES (?,?,?,?) ON CONFLICT(email) DO NOTHING',
    id(),
    email,
    name,
    now(),
  );
  return (await one('SELECT * FROM users WHERE email=?', email))!;
}
