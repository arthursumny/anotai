import { z } from 'zod';
import { EMAIL } from '../domain/model';
import {
  all,
  one,
  run,
  now,
  assert,
  appOrigin,
  localTest,
  integrationStatus,
} from './runtime';
import {
  token,
  hash,
  limit,
  ensureUser,
  createSession,
  sessionCookie,
  user,
  cookie,
  type Context,
} from './security';
import { queueEmail, sendDelivery, emailTemplate } from './providers';
export async function authRequest(request: Request) {
  const input = z
    .object({
      email: EMAIL,
      name: z.string().trim().min(1).max(100).optional(),
    })
    .parse(await request.json());
  await limit('login:' + input.email, 5, 600);
  await limit(
    'login-ip:' + (request.headers.get('cf-connecting-ip') || 'local'),
    30,
    600,
  );
  const existingUser = await one(
    'SELECT name FROM users WHERE email=?',
    input.email,
  );
  const internal = await one(
    "SELECT name FROM participants WHERE email=? AND kind='internal' ORDER BY id LIMIT 1",
    input.email,
  );
  const name = existingUser?.name || internal?.name || input.name;
  if (!name)
    return {
      message:
        'Se este e-mail já tem conta, você receberá um link. Para seu primeiro acesso, escolha Criar conta.',
    };
  const origin = appOrigin(request);
  const raw = token();
  const hashed = await hash(raw);
  await run(
    'INSERT INTO auth_tokens (hash,email,name,expires_at,created_at) VALUES (?,?,?,?,?)',
    hashed,
    input.email,
    name,
    new Date(Date.now() + 15 * 60000).toISOString(),
    now(),
  );
  const link = `${origin}/entrar?token=${raw}`;
  const eid = await queueEmail({
    kind: 'login',
    recipient: input.email,
    subject: 'Seu acesso ao Anota Aí',
    body: emailTemplate(
      'Seu próximo passo começa aqui',
      'Seu link de acesso expira em 15 minutos. Se você não solicitou este e-mail, pode ignorá-lo.',
      link,
      'Entrar no Anota Aí',
    ),
    key: 'login/' + hashed,
  });
  await sendDelivery(eid);
  return {
    message: localTest()
      ? 'Link local gerado. Nenhum e-mail foi enviado.'
      : 'Confira seu e-mail. O link de acesso expira em 15 minutos.',
    ...(localTest() ? { localLink: link } : {}),
  };
}
export async function authVerify(request: Request) {
  const { token: raw } = z
    .object({ token: z.string().length(64) })
    .parse(await request.json());
  const t = await one(
    'UPDATE auth_tokens SET used_at=? WHERE hash=? AND used_at IS NULL AND expires_at>? RETURNING *',
    now(),
    await hash(raw),
    now(),
  );
  assert(
    t,
    410,
    'Este link expirou ou já foi utilizado. Solicite um novo acesso.',
  );
  const invitation = t.participant_id
    ? await one(
        "SELECT id,org_id FROM participants WHERE id=? AND email=? AND kind='internal'",
        t.participant_id,
        t.email,
      )
    : null;
  if (t.participant_id)
    assert(
      invitation,
      410,
      'Este convite foi revogado. Peça um novo convite ao administrador.',
    );
  const u = await ensureUser(t.email, t.name);
  const invited = await all(
    "SELECT p.org_id,p.role FROM participants p WHERE p.email=? AND p.kind='internal'",
    u.email,
  );
  for (const p of invited)
    await run(
      "INSERT INTO memberships (id,org_id,user_id,role) SELECT ?,org_id,?,role FROM participants WHERE org_id=? AND email=? AND kind='internal' ON CONFLICT(org_id,user_id) DO NOTHING",
      crypto.randomUUID(),
      u.id,
      p.org_id,
      u.email,
    );
  const s = await createSession(u.id);
  return Response.json(
    { ok: true, ...(invitation ? { orgId: invitation.org_id } : {}) },
    {
      headers: { 'Set-Cookie': sessionCookie(s), 'Cache-Control': 'no-store' },
    },
  );
}
export async function me(request: Request) {
  let u;
  try {
    u = await user(request);
  } catch {
    return { user: null, organizations: [], integrations: integrationStatus() };
  }
  const orgs = await all(
    'SELECT o.*,m.role FROM organizations o JOIN memberships m ON m.org_id=o.id WHERE m.user_id=? ORDER BY o.created_at',
    u.id,
  );
  return { user: u, organizations: orgs, integrations: integrationStatus() };
}
export async function inviteMember(c: Context, pid: string, request: Request) {
  assert(c.admin, 403, 'Somente administradores podem convidar membros.');
  const p = await one(
    "SELECT * FROM participants WHERE id=? AND org_id=? AND kind='internal'",
    pid,
    c.orgId,
  );
  assert(
    p,
    404,
    'Membro interno não encontrado. Externos usam somente o link de aceite.',
  );
  await limit('member-invite:' + pid, 5, 3600);
  const raw = token(),
    hashed = await hash(raw);
  await run(
    'INSERT INTO auth_tokens(hash,email,name,expires_at,created_at,participant_id) VALUES(?,?,?,?,?,?)',
    hashed,
    p.email,
    p.name,
    new Date(Date.now() + 7 * 86400000).toISOString(),
    now(),
    pid,
  );
  const link = `${appOrigin(request)}/entrar?token=${raw}`;
  const eid = await queueEmail({
    orgId: c.orgId,
    kind: 'member_invitation',
    recipient: p.email,
    subject: `Convite para ${c.org.org_name} no Anota Aí`,
    body: emailTemplate(
      'Você foi convidado para a equipe',
      `${c.user.name} convidou você para ${c.org.org_name}. Confirme seu e-mail para acessar a empresa e preparar suas reuniões. Não é necessário cadastrar outra empresa. Este link expira em 7 dias.`,
      link,
      'Aceitar convite e entrar',
    ),
    key: 'member-invite/' + hashed,
  });
  await sendDelivery(eid);
  return { ok: true, ...(localTest() ? { localLink: link } : {}) };
}
export async function logout(request: Request) {
  await run(
    'DELETE FROM sessions WHERE hash=?',
    await hash(cookie(request, 'anota_session')),
  );
  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': sessionCookie('', true) } },
  );
}
