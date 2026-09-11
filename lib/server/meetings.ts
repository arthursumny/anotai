import { z } from 'zod';
import {
  EMAIL,
  meetingSchema,
  draftSchema,
  validateDraftReferences,
  MAX_AUDIO_BYTES,
} from '../domain/model';
import {
  all,
  one,
  run,
  stmt,
  batch,
  id,
  now,
  assert,
  event,
  runtime,
} from './runtime';
import { user, meetingAccess, visibleMeetings, type Context } from './security';
import { validateAgendaOrigins } from './planning';
export async function createOrganization(request: Request) {
  const u = await user(request);
  const d = z
    .object({
      name: z.string().trim().min(2).max(150),
      business: z.string().max(10000).default(''),
      timezone: z.string().default('America/Sao_Paulo'),
    })
    .parse(await request.json());
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: d.timezone });
  } catch {
    assert(false, 400, 'Fuso horário inválido.');
  }
  const orgId = id();
  await batch([
    stmt(
      'INSERT INTO organizations (id,name,business,timezone,created_at) VALUES (?,?,?,?,?)',
      orgId,
      d.name,
      d.business,
      d.timezone,
      now(),
    ),
    stmt(
      'INSERT INTO memberships (id,org_id,user_id,role) VALUES (?,?,?,?)',
      id(),
      orgId,
      u.id,
      'admin',
    ),
    stmt(
      'INSERT INTO participants (id,org_id,name,email,kind,role) VALUES (?,?,?,?,?,?)',
      id(),
      orgId,
      u.name,
      u.email,
      'internal',
      'admin',
    ),
  ]);
  return { id: orgId };
}
export async function updateOrganization(c: Context, request: Request) {
  assert(c.admin, 403, 'Somente administradores podem editar a organização.');
  const d = z
    .object({
      name: z.string().trim().min(2).max(150),
      business: z.string().max(10000).optional(),
    })
    .parse(await request.json());
  await run(
    'UPDATE organizations SET name=?,business=coalesce(?,business) WHERE id=?',
    d.name,
    d.business ?? null,
    c.orgId,
  );
  return { ok: true };
}
export async function saveParticipant(
  c: Context,
  request: Request,
  pid?: string,
) {
  assert(c.admin, 403, 'Somente administradores podem gerenciar pessoas.');
  const d = z
    .object({
      name: z.string().trim().min(1).max(100),
      email: EMAIL,
      kind: z.enum(['internal', 'external']),
      role: z.enum(['admin', 'member']).default('member'),
      department: z.string().trim().max(150).optional(),
      responsibilities: z.string().trim().max(3000).optional(),
    })
    .parse(await request.json());
  if (pid) {
    const existing = await one(
      'SELECT * FROM participants WHERE id=? AND org_id=?',
      pid,
      c.orgId,
    );
    assert(existing, 404, 'Participante não encontrado.');
    assert(
      existing.email === d.email,
      400,
      'O e-mail identifica o participante e não pode ser alterado.',
    );
    assert(
      existing.email !== c.user.email ||
        (d.kind === 'internal' && d.role === 'admin'),
      400,
      'Você não pode remover seu próprio acesso de administrador.',
    );
    await batch([
      stmt(
        'UPDATE participants SET name=?,kind=?,role=?,department=coalesce(?,department),responsibilities=coalesce(?,responsibilities),revision=revision+1 WHERE id=? AND org_id=?',
        d.name,
        d.kind,
        d.role,
        d.department ?? null,
        d.responsibilities ?? null,
        pid,
        c.orgId,
      ),
      ...(d.kind === 'internal'
        ? [
            stmt(
              'INSERT INTO memberships (id,org_id,user_id,role) SELECT ?,?,id,? FROM users WHERE email=? ON CONFLICT(org_id,user_id) DO UPDATE SET role=excluded.role',
              id(),
              c.orgId,
              d.role,
              d.email,
            ),
          ]
        : [
            stmt(
              'UPDATE auth_tokens SET used_at=? WHERE participant_id=? AND used_at IS NULL',
              now(),
              pid,
            ),
            stmt(
              'DELETE FROM memberships WHERE org_id=? AND user_id IN (SELECT id FROM users WHERE email=?)',
              c.orgId,
              d.email,
            ),
          ]),
    ]);
    return { id: pid };
  }
  const duplicate = await one(
    'SELECT id FROM participants WHERE org_id=? AND email=?',
    c.orgId,
    d.email,
  );
  assert(!duplicate, 409, 'Este e-mail já está cadastrado na organização.');
  const participantId = id();
  await run(
    'INSERT INTO participants (id,org_id,name,email,kind,role,department,responsibilities) VALUES (?,?,?,?,?,?,?,?)',
    participantId,
    c.orgId,
    d.name,
    d.email,
    d.kind,
    d.role,
    d.department ?? '',
    d.responsibilities ?? '',
  );
  if (d.kind === 'internal')
    await run(
      'INSERT INTO memberships (id,org_id,user_id,role) SELECT ?,?,id,? FROM users WHERE email=? ON CONFLICT(org_id,user_id) DO NOTHING',
      id(),
      c.orgId,
      d.role,
      d.email,
    );
  return { id: participantId };
}
async function validateMeetingRefs(
  c: Context,
  d: z.infer<typeof meetingSchema>,
) {
  const p = await all('SELECT id FROM participants WHERE org_id=?', c.orgId);
  assert(
    d.participantIds.every((pid) => p.some((x) => x.id === pid)),
    400,
    'Participante de outra organização ou inexistente.',
  );
  assert(
    new Set(d.participantIds).size === d.participantIds.length,
    400,
    'Participantes repetidos.',
  );
  for (const item of d.agenda) {
    if (!item.taskId) continue;
    const t = await one(
      'SELECT meeting_id FROM tasks WHERE id=? AND org_id=? AND active=1',
      item.taskId,
      c.orgId,
    );
    assert(t, 400, 'Pendência de origem inválida.');
    await meetingAccess(c, t.meeting_id);
  }
}
export async function saveMeeting(
  c: Context,
  request: Request,
  meetingId?: string,
) {
  const raw = (await request.json()) as Record<string, unknown>;
  const d = meetingSchema.parse(raw);
  await validateMeetingRefs(c, d);
  await validateAgendaOrigins(c, d.agenda, meetingId);
  if (meetingId) {
    const m = await meetingAccess(c, meetingId, true);
    assert(
      m.version === 0,
      409,
      'A preparação não pode ser alterada depois da primeira ata finalizada.',
    );
    const revision = z.number().int().parse(raw.revision);
    const marker = id();
    const results = await batch([
      stmt(
        "UPDATE meetings SET title=?,objective=?,scheduled_at=?,duration=?,location=?,topic=?,agenda=?,revision=revision+1,finalization_token=? WHERE id=? AND revision=? AND status='planned' AND draft IS NULL AND NOT EXISTS(SELECT 1 FROM jobs WHERE meeting_id=meetings.id) AND NOT EXISTS(SELECT 1 FROM files WHERE meeting_id=meetings.id)",
        d.title,
        d.objective,
        d.scheduledAt,
        d.duration,
        d.location,
        d.topic,
        JSON.stringify(d.agenda),
        marker,
        meetingId,
        revision,
      ),
      stmt(
        'DELETE FROM meeting_participants WHERE meeting_id=? AND participant_id NOT IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM meetings WHERE id=? AND finalization_token=?)',
        meetingId,
        JSON.stringify(d.participantIds),
        meetingId,
        marker,
      ),
      ...d.participantIds.map((pid) =>
        stmt(
          'INSERT INTO meeting_participants (meeting_id,participant_id,present) SELECT ?,?,0 WHERE EXISTS(SELECT 1 FROM meetings WHERE id=? AND finalization_token=?) ON CONFLICT(meeting_id,participant_id) DO NOTHING',
          meetingId,
          pid,
          meetingId,
          marker,
        ),
      ),
    ]);
    assert(
      results[0].meta.changes,
      409,
      'A preparação foi encerrada ou alterada em outra janela. Recarregue a reunião.',
    );
    await event(
      c.orgId,
      meetingId,
      c.user.name,
      'Preparação da reunião atualizada',
    );
    return { id: meetingId };
  }
  const mid = id();
  await batch([
    stmt(
      'INSERT INTO meetings (id,org_id,organizer_id,title,objective,scheduled_at,duration,location,topic,agenda,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      mid,
      c.orgId,
      c.user.id,
      d.title,
      d.objective,
      d.scheduledAt,
      d.duration,
      d.location,
      d.topic,
      JSON.stringify(d.agenda),
      now(),
    ),
    ...d.participantIds.map((pid) =>
      stmt(
        'INSERT INTO meeting_participants (meeting_id,participant_id,present) VALUES (?,?,0)',
        mid,
        pid,
      ),
    ),
  ]);
  await event(c.orgId, mid, c.user.name, 'Reunião criada');
  return { id: mid };
}
export async function meetingDetail(c: Context, mid: string) {
  const m = await meetingAccess(c, mid);
  const [
    participants,
    files,
    transcripts,
    jobs,
    minutes,
    tasks,
    decisions,
    events,
    deliveries,
    acceptances,
  ] = await Promise.all([
    all(
      'SELECT p.*,mp.present FROM participants p JOIN meeting_participants mp ON mp.participant_id=p.id WHERE mp.meeting_id=? ORDER BY p.name',
      mid,
    ),
    all(
      'SELECT id,name,mime,size,created_at FROM files WHERE meeting_id=?',
      mid,
    ),
    all(
      'SELECT * FROM transcripts WHERE meeting_id=? ORDER BY created_at DESC',
      mid,
    ),
    all(
      'SELECT id,state,step,error,attempts,result,applied,base_revision,created_at FROM jobs WHERE meeting_id=? ORDER BY created_at DESC',
      mid,
    ),
    all('SELECT * FROM minutes WHERE meeting_id=? ORDER BY number DESC', mid),
    all(
      'SELECT t.*,p.name AS assignee_name FROM tasks t LEFT JOIN participants p ON p.id=t.assignee_id WHERE t.meeting_id=? AND t.active=1',
      mid,
    ),
    all('SELECT * FROM decisions WHERE meeting_id=? AND active=1', mid),
    all(
      'SELECT * FROM events WHERE meeting_id=? ORDER BY created_at DESC',
      mid,
    ),
    all(
      'SELECT id,kind,recipient,subject,status,error,created_at FROM deliveries WHERE meeting_id=? ORDER BY created_at DESC',
      mid,
    ),
    all(
      'SELECT a.id,a.minutes_id,a.recipient_name,a.recipient_email,a.status,a.comment,a.responded_at,a.expires_at FROM acceptances a JOIN minutes v ON v.id=a.minutes_id WHERE v.meeting_id=?',
      mid,
    ),
  ]);
  return {
    meeting: {
      ...m,
      agenda: JSON.parse(m.agenda),
      draft: m.draft ? JSON.parse(m.draft) : null,
    },
    participants,
    files,
    transcripts,
    jobs,
    minutes: minutes.map((v) => ({ ...v, content: JSON.parse(v.content) })),
    tasks,
    decisions,
    events,
    deliveries,
    acceptances,
    canEdit: c.admin || m.organizer_id === c.user.id,
  };
}
export async function listWork(c: Context) {
  const meetings = await visibleMeetings(c);
  const allowed = new Set(meetings.map((m) => m.id));
  const [tasks, decisions] = await Promise.all([
    all(
      'SELECT t.*,p.name AS assignee_name,p.email AS assignee_email,m.title AS meeting_title,m.topic,m.status AS meeting_status,m.organizer_id FROM tasks t JOIN meetings m ON m.id=t.meeting_id LEFT JOIN participants p ON p.id=t.assignee_id WHERE t.org_id=? AND t.active=1 ORDER BY t.due_date IS NULL,t.due_date',
      c.orgId,
    ),
    all(
      'SELECT d.*,m.title AS meeting_title,m.topic,v.created_at FROM decisions d JOIN meetings m ON m.id=d.meeting_id JOIN minutes v ON v.id=d.minutes_id WHERE d.org_id=? AND d.active=1 ORDER BY v.created_at DESC',
      c.orgId,
    ),
  ]);
  return {
    tasks: tasks
      .filter((t) => allowed.has(t.meeting_id))
      .map((t) => ({
        ...t,
        canEdit:
          c.admin ||
          t.organizer_id === c.user.id ||
          t.assignee_email === c.user.email,
      })),
    decisions: decisions.filter((d) => allowed.has(d.meeting_id)),
  };
}
export async function updateTask(c: Context, tid: string, request: Request) {
  const d = z
    .object({ status: z.enum(['open', 'in_progress', 'done', 'cancelled']) })
    .parse(await request.json());
  const t = await one(
    'SELECT t.*,p.email FROM tasks t LEFT JOIN participants p ON p.id=t.assignee_id WHERE t.id=? AND t.org_id=? AND t.active=1',
    tid,
    c.orgId,
  );
  assert(t, 404, 'Tarefa não encontrada.');
  const m = await meetingAccess(c, t.meeting_id);
  assert(
    c.admin || m.organizer_id === c.user.id || t.email === c.user.email,
    403,
    'Somente o responsável ou organizador pode atualizar esta tarefa.',
  );
  await run(
    'UPDATE tasks SET status=?,updated_at=? WHERE id=?',
    d.status,
    now(),
    tid,
  );
  await event(
    c.orgId,
    t.meeting_id,
    c.user.name,
    'Situação da tarefa atualizada: ' + t.description,
  );
  return { ok: true };
}
export async function saveDraft(c: Context, mid: string, request: Request) {
  await meetingAccess(c, mid, true);
  const d = z
    .object({ revision: z.number().int(), draft: draftSchema })
    .parse(await request.json());
  const p = await all(
    'SELECT p.id FROM participants p JOIN meeting_participants mp ON mp.participant_id=p.id WHERE mp.meeting_id=?',
    mid,
  );
  assert(
    validateDraftReferences(d.draft, p as { id: string }[]),
    400,
    'Responsável precisa participar da reunião.',
  );
  for (const item of [...d.draft.tasks, ...d.draft.decisions]) {
    const collision = await one(
      'SELECT meeting_id FROM tasks WHERE id=? UNION ALL SELECT meeting_id FROM decisions WHERE id=?',
      item.id,
      item.id,
    );
    assert(
      !collision || collision.meeting_id === mid,
      400,
      'Identificador de item inválido.',
    );
  }
  const r = await run(
    "UPDATE meetings SET draft=?,revision=revision+1,status='review' WHERE id=? AND revision=? AND status='review'",
    JSON.stringify(d.draft),
    mid,
    d.revision,
  );
  assert(
    r.meta.changes,
    409,
    'O rascunho mudou ou foi finalizado. Recarregue antes de salvar.',
  );
  await event(c.orgId, mid, c.user.name, 'Rascunho da ata revisado');
  return { revision: d.revision + 1 };
}
export async function revise(c: Context, mid: string, request: Request) {
  const m = await meetingAccess(c, mid, true);
  const { revision } = z
    .object({ revision: z.number().int() })
    .parse(await request.json());
  assert(
    m.version > 0 && m.status !== 'review',
    409,
    'Já existe uma revisão em aberto.',
  );
  const latest = await one(
    'SELECT content FROM minutes WHERE meeting_id=? ORDER BY number DESC LIMIT 1',
    mid,
  );
  const snapshot = JSON.parse(latest!.content);
  const r = await run(
    "UPDATE meetings SET draft=?,status='review',revision=revision+1 WHERE id=? AND revision=? AND NOT EXISTS(SELECT 1 FROM acceptances a JOIN minutes v ON v.id=a.minutes_id WHERE v.meeting_id=meetings.id)",
    JSON.stringify(snapshot.draft),
    mid,
    revision,
  );
  assert(
    r.meta.changes,
    409,
    'Não é possível abrir revisão após o envio para aceite ou se a ata foi alterada.',
  );
  await event(c.orgId, mid, c.user.name, 'Nova revisão da ata iniciada');
  return { ok: true };
}
export async function finalize(c: Context, mid: string, request: Request) {
  const m = await meetingAccess(c, mid, true);
  const { revision } = z
    .object({ revision: z.number().int() })
    .parse(await request.json());
  assert(
    m.status === 'review' && m.draft,
    409,
    'Salve um rascunho antes de finalizar.',
  );
  const draft = draftSchema.parse(JSON.parse(m.draft));
  assert(draft.summary.trim(), 400, 'Preencha o resumo antes de finalizar.');
  const participants = await all(
    'SELECT p.id,p.name,p.email,mp.present FROM participants p JOIN meeting_participants mp ON mp.participant_id=p.id WHERE mp.meeting_id=?',
    mid,
  );
  assert(
    validateDraftReferences(draft, participants as { id: string }[]),
    400,
    'Responsável inválido.',
  );
  const attendance = await one(
    "SELECT id FROM jobs WHERE meeting_id=? AND json_extract(input, '$.context.attendanceConfirmed')=1 LIMIT 1",
    mid,
  );
  const vid = id();
  const snapshot = {
    attendanceConfirmed: !!attendance,
    draft,
    meeting: {
      title: m.title,
      objective: m.objective,
      scheduledAt: m.scheduled_at,
      location: m.location,
      topic: m.topic,
      agenda: JSON.parse(m.agenda),
    },
    organization: { name: c.org.org_name, timezone: c.org.timezone },
    participants,
  };
  const guard =
    'EXISTS(SELECT 1 FROM meetings WHERE id=? AND finalization_token=?)';
  const statements = [
    stmt(
      "UPDATE meetings SET status='finalized',version=version+1,revision=revision+1,finalization_token=? WHERE id=? AND revision=? AND status='review'",
      vid,
      mid,
      revision,
    ),
    stmt(
      `INSERT INTO minutes (id,org_id,meeting_id,number,content,author_id,created_at) SELECT ?,?,?,version,?,?,? FROM meetings WHERE id=? AND finalization_token=?`,
      vid,
      c.orgId,
      mid,
      JSON.stringify(snapshot),
      c.user.id,
      now(),
      mid,
      vid,
    ),
    stmt(
      `UPDATE tasks SET active=0 WHERE meeting_id=? AND ${guard}`,
      mid,
      mid,
      vid,
    ),
    stmt(
      `UPDATE decisions SET active=0 WHERE meeting_id=? AND ${guard}`,
      mid,
      mid,
      vid,
    ),
    ...draft.tasks.map((t) =>
      stmt(
        `INSERT INTO tasks (id,org_id,meeting_id,minutes_id,description,evidence,assignee_id,due_date,status,active,updated_at) SELECT ?,?,?,?,?,?,?,?,'open',1,? WHERE ${guard} ON CONFLICT(id) DO UPDATE SET minutes_id=excluded.minutes_id,description=excluded.description,evidence=excluded.evidence,assignee_id=excluded.assignee_id,due_date=excluded.due_date,active=1,updated_at=excluded.updated_at WHERE tasks.meeting_id=excluded.meeting_id AND tasks.org_id=excluded.org_id`,
        t.id,
        c.orgId,
        mid,
        vid,
        t.description,
        t.evidence,
        t.assigneeId,
        t.dueDate,
        now(),
        mid,
        vid,
      ),
    ),
    ...draft.decisions.map((d) =>
      stmt(
        `INSERT INTO decisions (id,org_id,meeting_id,minutes_id,description,evidence,active) SELECT ?,?,?,?,?,?,1 WHERE ${guard} ON CONFLICT(id) DO UPDATE SET minutes_id=excluded.minutes_id,description=excluded.description,evidence=excluded.evidence,active=1 WHERE decisions.meeting_id=excluded.meeting_id AND decisions.org_id=excluded.org_id`,
        d.id,
        c.orgId,
        mid,
        vid,
        d.description,
        d.evidence,
        mid,
        vid,
      ),
    ),
    stmt(
      `INSERT INTO events (id,org_id,meeting_id,actor,action,created_at) SELECT ?,?,?,?,?,? WHERE ${guard}`,
      id(),
      c.orgId,
      mid,
      c.user.name,
      'Ata finalizada · versão ' + (m.version + 1),
      now(),
      mid,
      vid,
    ),
  ];
  const result = await batch(statements);
  assert(
    result[0].meta.changes,
    409,
    'Outra pessoa alterou a ata. Recarregue antes de finalizar.',
  );
  return { id: vid, version: m.version + 1 };
}
export async function upload(c: Context, mid: string, request: Request) {
  await meetingAccess(c, mid, true);
  const size = Number(request.headers.get('content-length') || 0);
  assert(
    size <= MAX_AUDIO_BYTES + 1024 * 1024,
    413,
    'O arquivo deve ter até 20 MB.',
  );
  const form = await request.formData();
  const file = form.get('file');
  assert(
    file instanceof File && file.size > 0 && file.size <= MAX_AUDIO_BYTES,
    400,
    'Envie um áudio válido de até 20 MB.',
  );
  const extension = file.name.toLowerCase().split('.').pop();
  assert(
    ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm'].includes(
      extension || '',
    ),
    415,
    'Formato não suportado. Use MP3, MP4, M4A, WAV ou WebM.',
  );
  assert(
    /^(audio\/|video\/webm|video\/mp4|application\/octet-stream)/.test(
      file.type,
    ),
    415,
    'Tipo de arquivo incompatível com áudio.',
  );
  const fileId = id();
  const key = `${c.orgId}/${mid}/${fileId}.${extension}`;
  await runtime().FILES.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });
  try {
    const inserted = await run(
      "INSERT INTO files (id,org_id,meeting_id,key,name,mime,size,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM meetings WHERE id=? AND status='planned' AND draft IS NULL) AND NOT EXISTS(SELECT 1 FROM files WHERE meeting_id=?) AND NOT EXISTS(SELECT 1 FROM jobs WHERE meeting_id=?)",
      fileId,
      c.orgId,
      mid,
      key,
      file.name.slice(0, 200),
      file.type,
      file.size,
      now(),
      mid,
      mid,
      mid,
    );
    assert(
      inserted.meta.changes,
      409,
      'Esta reunião já tem conteúdo registrado. Uma nova gravação exige uma nova reunião.',
    );
  } catch (error) {
    await runtime().FILES.delete(key);
    throw error;
  }
  await event(c.orgId, mid, c.user.name, 'Arquivo de áudio armazenado');
  return { id: fileId };
}
export async function getFile(c: Context, fid: string) {
  const f = await one(
    'SELECT * FROM files WHERE id=? AND org_id=?',
    fid,
    c.orgId,
  );
  assert(f, 404, 'Arquivo não encontrado.');
  await meetingAccess(c, f.meeting_id);
  const object = await runtime().FILES.get(f.key);
  assert(object, 404, 'Arquivo não encontrado.');
  return new Response(object.body, {
    headers: {
      'Content-Type': f.mime,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
