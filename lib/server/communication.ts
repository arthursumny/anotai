import { z } from 'zod';
import {
  all,
  one,
  run,
  stmt,
  batch,
  assert,
  id,
  now,
  event,
  appOrigin,
  localTest,
  runtime,
} from './runtime';
import { meetingAccess, token, hash, type Context } from './security';
import {
  emailTemplate,
  queueEmail,
  protectBody,
  revealBody,
} from './providers';
import { dispatchEmail } from './jobs';
import { acceptanceStatus } from '../domain/model';
function requireMail() {
  if (localTest()) return;
  const e = runtime();
  assert(
    e.RESEND_API_KEY &&
      e.MAIL_FROM &&
      e.INNGEST_EVENT_KEY &&
      e.INNGEST_SIGNING_KEY &&
      e.APP_ENCRYPTION_KEY,
    503,
    'Configure e-mail, proteção de links e fila de envio para continuar.',
  );
}
export async function invite(c: Context, mid: string, request: Request) {
  const m = await meetingAccess(c, mid, true);
  const started = await one(
    'SELECT id FROM files WHERE meeting_id=? UNION ALL SELECT id FROM jobs WHERE meeting_id=? LIMIT 1',
    mid,
    mid,
  );
  assert(
    m.status === 'planned' && !m.draft && !started,
    409,
    'A preparação já foi encerrada.',
  );
  requireMail();
  const origin = appOrigin(request);
  const participants = await all(
    'SELECT p.* FROM participants p JOIN meeting_participants mp ON mp.participant_id=p.id WHERE mp.meeting_id=?',
    mid,
  );
  assert(participants.length, 400, 'Adicione participantes antes de convidar.');
  const agenda = JSON.parse(m.agenda) as { title: string }[];
  const content = `${c.org.org_name} convida você para ${m.title}.\n\nQuando: ${new Date(m.scheduled_at).toLocaleString('pt-BR', { timeZone: c.org.timezone })} (${c.org.timezone})\nDuração: ${m.duration} minutos\nLocal: ${m.location || 'A combinar'}\nObjetivo: ${m.objective || 'A combinar'}\n\nPauta:\n${agenda.map((a, i) => `${i + 1}. ${a.title}`).join('\n')}`;
  for (const p of participants) {
    const eid = await queueEmail({
      orgId: c.orgId,
      meetingId: mid,
      kind: 'invitation',
      recipient: p.email,
      subject: `Convite: ${m.title}`,
      body: emailTemplate(
        m.title,
        content,
        p.kind === 'internal' ? `${origin}/reunioes/${mid}` : '',
        p.kind === 'internal' ? 'Abrir reunião' : 'Anota Aí',
      ),
      key: `invite/${mid}/${m.revision}/${p.id}`,
    });
    await dispatchEmail(eid);
  }
  await event(
    c.orgId,
    mid,
    c.user.name,
    localTest()
      ? 'Convites preparados em teste local'
      : 'Convites encaminhados para envio',
  );
  return { ok: true, count: participants.length };
}
export async function sendMinutes(c: Context, mid: string, request: Request) {
  const m = await meetingAccess(c, mid, true);
  assert(
    m.version > 0 && m.status !== 'review',
    409,
    'Finalize a revisão antes de enviar a ata.',
  );
  assert(
    m.status !== 'accepted',
    409,
    'Esta ata já foi aceita e não pode ser enviada novamente.',
  );
  requireMail();
  const { participantIds } = z
    .object({ participantIds: z.array(z.string()).min(1).max(100) })
    .parse(await request.json());
  const version = (await one(
    'SELECT * FROM minutes WHERE meeting_id=? ORDER BY number DESC LIMIT 1',
    mid,
  ))!;
  const p = await all(
    'SELECT p.* FROM participants p JOIN meeting_participants mp ON mp.participant_id=p.id WHERE mp.meeting_id=?',
    mid,
  );
  assert(
    participantIds.every((pid) => p.some((x) => x.id === pid)),
    400,
    'Destinatário inválido.',
  );
  const origin = appOrigin(request);
  for (const pid of new Set(participantIds)) {
    const person = p.find((x) => x.id === pid)!;
    const raw = token();
    const tokenHash = await hash(raw);
    const aid = id();
    const did = id();
    const link = `${origin}/aceite?token=${raw}`;
    const body = await protectBody(
      emailTemplate(
        `Ata: ${m.title}`,
        `${c.org.org_name} compartilhou a versão ${version.number} da ata. Leia o documento e registre seu aceite ou solicite ajustes. O link é individual e expira em 7 dias.`,
        link,
        'Revisar e responder',
      ),
    );
    await batch([
      stmt(
        "INSERT INTO acceptances (id,org_id,minutes_id,participant_id,recipient_name,recipient_email,token_hash,expires_at,status,comment,created_at) SELECT ?,?,?,?,?,?,?,?,'pending','',? WHERE EXISTS(SELECT 1 FROM meetings WHERE id=? AND version=? AND status NOT IN ('review','accepted')) ON CONFLICT(minutes_id,participant_id) DO NOTHING",
        aid,
        c.orgId,
        version.id,
        pid,
        person.name,
        person.email,
        tokenHash,
        new Date(Date.now() + 7 * 86400000).toISOString(),
        now(),
        mid,
        version.number,
      ),
      stmt(
        "INSERT INTO deliveries (id,org_id,meeting_id,kind,recipient,subject,body,status,dedupe_key,created_at,updated_at) SELECT ?,?,?,'minutes',?,?,?,'queued',?,?,? WHERE EXISTS(SELECT 1 FROM acceptances WHERE id=? AND token_hash=?) ON CONFLICT(dedupe_key) DO NOTHING",
        did,
        c.orgId,
        mid,
        person.email,
        `Ata para aceite: ${m.title}`,
        body,
        `minutes/${version.id}/${pid}`,
        now(),
        now(),
        aid,
        tokenHash,
      ),
    ]);
    const delivery = await one(
      'SELECT id FROM deliveries WHERE dedupe_key=?',
      `minutes/${version.id}/${pid}`,
    );
    assert(
      delivery,
      409,
      'A ata foi alterada ou já foi aceita. Recarregue a reunião.',
    );
    await dispatchEmail(delivery.id);
  }
  await refreshAcceptance(mid, version.id);
  await event(
    c.orgId,
    mid,
    c.user.name,
    `Versão ${version.number} encaminhada para aceite${localTest() ? ' · teste local' : ''}`,
  );
  return { ok: true };
}
async function refreshAcceptance(mid: string, vid: string) {
  const rows = await all(
    'SELECT status FROM acceptances WHERE minutes_id=?',
    vid,
  );
  const status = acceptanceStatus(rows as { status: string }[]);
  await run(
    "UPDATE meetings SET status=? WHERE id=? AND status!='review' AND version=(SELECT number FROM minutes WHERE id=?)",
    status,
    mid,
    vid,
  );
}
export async function publicAcceptance(request: Request) {
  const raw = new URL(request.url).searchParams.get('token');
  assert(raw && raw.length === 64, 404, 'Link de aceite inválido.');
  const a = await one(
    'SELECT a.*,v.content,v.number,v.meeting_id,m.version AS current_version FROM acceptances a JOIN minutes v ON v.id=a.minutes_id JOIN meetings m ON m.id=v.meeting_id WHERE a.token_hash=?',
    await hash(raw),
  );
  assert(a, 404, 'Link de aceite inválido.');
  assert(
    a.expires_at > now(),
    410,
    'Este link expirou. Peça ao organizador um novo envio.',
  );
  if (request.method === 'GET')
    return {
      id: a.id,
      recipient: a.recipient_name,
      status: a.status,
      comment: a.comment,
      respondedAt: a.responded_at,
      version: a.number,
      superseded: a.number !== a.current_version,
      content: JSON.parse(a.content),
    };
  const d = z
    .object({
      status: z.enum(['accepted', 'changes_requested']),
      comment: z.string().max(5000).default(''),
    })
    .parse(await request.json());
  assert(
    a.number === a.current_version,
    409,
    'Existe uma versão mais recente. Solicite o link atualizado ao organizador.',
  );
  assert(a.status === 'pending', 409, 'Sua manifestação já foi registrada.');
  assert(
    d.status !== 'changes_requested' || d.comment.trim().length > 0,
    400,
    'Descreva o ajuste solicitado.',
  );
  const r = await run(
    "UPDATE acceptances SET status=?,comment=?,responded_at=? WHERE id=? AND status='pending' AND expires_at>?",
    d.status,
    d.comment,
    now(),
    a.id,
    now(),
  );
  assert(
    r.meta.changes,
    409,
    'Esta manifestação já foi registrada ou o link expirou.',
  );
  await refreshAcceptance(a.meeting_id, a.minutes_id);
  await event(
    a.org_id,
    a.meeting_id,
    a.recipient_name,
    d.status === 'accepted'
      ? `Aceite registrado · versão ${a.number}`
      : `Ajustes solicitados · versão ${a.number}`,
  );
  return { ok: true };
}
export async function resendAcceptance(
  c: Context,
  aid: string,
  request: Request,
) {
  const a = await one(
    'SELECT a.*,v.meeting_id,v.number,m.title,m.version AS current_version FROM acceptances a JOIN minutes v ON v.id=a.minutes_id JOIN meetings m ON m.id=v.meeting_id WHERE a.id=? AND a.org_id=?',
    aid,
    c.orgId,
  );
  assert(a, 404, 'Aceite não encontrado.');
  await meetingAccess(c, a.meeting_id, true);
  assert(
    a.status === 'pending' && a.number === a.current_version,
    409,
    'Somente aceites pendentes da versão atual podem ser reenviados.',
  );
  requireMail();
  const raw = token();
  const link = `${appOrigin(request)}/aceite?token=${raw}`;
  const did = id();
  const body = await protectBody(
    emailTemplate(
      `Ata: ${a.title}`,
      `Novo link individual para revisar a versão ${a.number}. O link anterior deixa de funcionar. Este link expira em 7 dias.`,
      link,
      'Revisar e responder',
    ),
  );
  await batch([
    stmt(
      "UPDATE acceptances SET token_hash=?,expires_at=? WHERE id=? AND status='pending'",
      await hash(raw),
      new Date(Date.now() + 7 * 86400000).toISOString(),
      aid,
    ),
    stmt(
      "INSERT INTO deliveries (id,org_id,meeting_id,kind,recipient,subject,body,status,dedupe_key,created_at,updated_at) VALUES (?,?,?,'minutes',?,?,?,'queued',?,?,?)",
      did,
      c.orgId,
      a.meeting_id,
      a.recipient_email,
      `Novo link de aceite: ${a.title}`,
      body,
      'resend/' + did,
      now(),
      now(),
    ),
  ]);
  await dispatchEmail(did);
  await event(
    c.orgId,
    a.meeting_id,
    c.user.name,
    'Link de aceite renovado para ' + a.recipient_name,
  );
  return { ok: true };
}
export async function localMail(c: Context, deliveryId: string) {
  assert(localTest(), 404, 'Recurso não encontrado.');
  const d = await one(
    'SELECT * FROM deliveries WHERE id=? AND org_id=? AND status=?',
    deliveryId,
    c.orgId,
    'test',
  );
  assert(d && d.meeting_id, 404, 'Envio não encontrado.');
  await meetingAccess(c, d.meeting_id, true);
  const body = await revealBody(d.body);
  const url = body.match(/href="([^"]+)"/)?.[1];
  return { url };
}
