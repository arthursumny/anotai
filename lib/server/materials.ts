import { z } from 'zod';
import { type Agenda } from '../domain/model';
import { type Source } from '../domain/memory';
import {
  materialSlides,
  renderMaterial,
  type MaterialSnapshot,
} from '../domain/materials';
import { context, meetingAccess, limit, type Context } from './security';
import { agendaOrigins, proposalSourcesAllowed } from './planning';
import { authorizedMeetings, retrieve } from './memory-retrieval';
import { all, one, run, id, now, assert, runtime, appOrigin } from './runtime';
export async function materialAccess(
  c: Context,
  mid: string,
  materialId: string,
) {
  await meetingAccess(c, mid);
  const row = await one(
    'SELECT * FROM meeting_materials WHERE id=? AND org_id=? AND meeting_id=?',
    materialId,
    c.orgId,
    mid,
  );
  assert(row, 404, 'Material não encontrado.');
  const snapshot = JSON.parse(row.snapshot) as MaterialSnapshot;
  assert(
    await proposalSourcesAllowed(c, snapshot.sources),
    403,
    'Este material contém fontes às quais você não tem mais acesso.',
  );
  return { row, snapshot };
}
export async function listMaterials(c: Context, mid: string) {
  await meetingAccess(c, mid);
  const rows = await all(
    'SELECT id,revision,created_at,dependencies FROM meeting_materials WHERE org_id=? AND meeting_id=? ORDER BY created_at DESC LIMIT 100',
    c.orgId,
    mid,
  );
  const acl = authorizedMeetings(c);
  const visible = await all<{ id: string }>(
    `SELECT id FROM (${acl.sql})`,
    ...acl.args,
  );
  const ids = new Set(visible.map((m) => m.id));
  return rows
    .filter((row) =>
      (JSON.parse(row.dependencies) as string[]).every((dep) => ids.has(dep)),
    )
    .map((row) => ({
      id: row.id,
      revision: row.revision,
      createdAt: row.created_at,
    }));
}
export async function createMaterial(
  c: Context,
  mid: string,
  request: Request,
) {
  const d = z
    .object({
      requestId: z.uuid(),
      revision: z.number().int().min(0),
      agendaReviewed: z.literal(true),
    })
    .parse(await request.json());
  const meeting = await meetingAccess(c, mid, true);
  assert(
    meeting.revision === d.revision,
    409,
    'A reunião mudou. Atualize a página e confira a pauta novamente.',
  );
  const agenda = JSON.parse(meeting.agenda) as Agenda;
  assert(
    agenda.length,
    400,
    'Salve pelo menos um item de pauta antes de gerar o material.',
  );
  const previous = await one(
    'SELECT org_id,meeting_id,revision FROM meeting_materials WHERE id=?',
    d.requestId,
  );
  if (previous) {
    assert(
      previous.org_id === c.orgId &&
        previous.meeting_id === mid &&
        previous.revision === d.revision,
      409,
      'Identificador utilizado por outro material.',
    );
    await materialAccess(c, mid, d.requestId);
    return { id: d.requestId };
  }
  await limit('meeting-material:' + c.orgId + ':' + c.user.id, 30, 3600);
  const origins = await agendaOrigins(c, mid);
  const map = new Map<string, Source>();
  for (const origin of Object.values(origins))
    for (const source of origin.sources) map.set(source.id, source);
  // Resolve manually linked tasks directly inside the ACL, without searching an unrelated corpus.
  const taskIds = agenda.flatMap((item) => (item.taskId ? [item.taskId] : []));
  const acl = authorizedMeetings(c);
  if (taskIds.length) {
    const tasks = await all(
      `SELECT t.*,m.title,m.topic,m.scheduled_at,p.name AS assignee FROM tasks t JOIN (${acl.sql}) m ON m.id=t.meeting_id AND m.org_id=t.org_id LEFT JOIN participants p ON p.id=t.assignee_id AND p.org_id=t.org_id WHERE t.id IN (SELECT value FROM json_each(?))`,
      ...acl.args,
      JSON.stringify(taskIds),
    );
    for (const t of tasks)
      map.set('task:' + t.id, {
        id: 'task:' + t.id,
        kind: 'task',
        meetingId: t.meeting_id,
        title: t.title,
        date: t.scheduled_at,
        topic: t.topic,
        body: `${t.description}\nResponsável: ${t.assignee || 'Não definido'}\nPrazo: ${t.due_date || 'Não definido'}\nSituação: ${{ open: 'Em aberto', in_progress: 'Em andamento', done: 'Concluída', cancelled: 'Cancelada' }[t.status as string] || t.status}`,
        state: t.active ? 'Tarefa confirmada' : 'Registro anterior inativo',
        href: `/reunioes/${t.meeting_id}?org=${c.orgId}&tab=acoes#${encodeURIComponent(t.id)}`,
        assignee: t.assignee || '',
        status: t.status,
        dueDate: t.due_date,
      });
  }
  if (!map.size) {
    const query = (
      meeting.topic ||
      [meeting.objective, ...agenda.map((item) => item.title)].join(' ')
    ).slice(0, 2000);
    const history = await retrieve(c, {
      query,
      filters: { to: meeting.scheduled_at.slice(0, 10) },
    });
    for (const source of history.sources
      .filter((source) => source.meetingId !== mid)
      .slice(0, 6))
      map.set(source.id, source);
  }
  const sources = [...map.values()];
  const stamp = now();
  const snapshot: MaterialSnapshot = {
    title: meeting.title,
    objective: meeting.objective,
    agenda,
    sources,
    slides: materialSlides({
      title: meeting.title,
      objective: meeting.objective,
      agenda,
      sources,
      meetingHref: `/reunioes/${mid}?org=${c.orgId}&tab=preparacao`,
    }),
    revision: d.revision,
    createdAt: stamp,
    meetingId: mid,
    orgId: c.orgId,
  };
  assert(
    snapshot.slides.length <= 160,
    400,
    'O material ficou extenso. Reduza os itens de pauta ou as fontes de apoio.',
  );
  const html = renderMaterial(snapshot, appOrigin(request));
  const fresh = await context(request);
  await meetingAccess(fresh, mid, true);
  assert(
    fresh.orgId === c.orgId && (await proposalSourcesAllowed(fresh, sources)),
    403,
    'O acesso às fontes mudou. Atualize a reunião.',
  );
  const key = `materials/${c.orgId}/${mid}/${id()}.html`;
  await runtime().FILES.put(key, html, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  });
  try {
    const inserted = await run(
      `INSERT INTO meeting_materials(id,org_id,meeting_id,author_id,revision,key,snapshot,dependencies,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM meetings WHERE id=? AND org_id=? AND revision=?) ON CONFLICT(id) DO NOTHING`,
      d.requestId,
      c.orgId,
      mid,
      c.user.id,
      d.revision,
      key,
      JSON.stringify(snapshot),
      JSON.stringify([
        ...new Set(sources.flatMap((s) => (s.meetingId ? [s.meetingId] : []))),
      ]),
      stamp,
      mid,
      c.orgId,
      d.revision,
    );
    if (!inserted.meta.changes) {
      await runtime().FILES.delete(key);
      const existing = await one(
        'SELECT id FROM meeting_materials WHERE id=? AND org_id=? AND meeting_id=? AND revision=?',
        d.requestId,
        c.orgId,
        mid,
        d.revision,
      );
      assert(
        existing,
        409,
        'A pauta mudou durante a geração. Confira a revisão e tente novamente.',
      );
    }
  } catch (error) {
    await runtime().FILES.delete(key);
    throw error;
  }
  return { id: d.requestId };
}
export async function getMaterial(
  c: Context,
  mid: string,
  materialId: string,
  request: Request,
) {
  const { row, snapshot } = await materialAccess(c, mid, materialId);
  if (new URL(request.url).searchParams.get('format') === 'json')
    return Response.json(snapshot, {
      headers: { 'Cache-Control': 'no-store' },
    });
  const object = await runtime().FILES.get(row.key);
  assert(object, 404, 'Arquivo do material não encontrado.');
  const download = new URL(request.url).searchParams.get('download') === '1';
  return new Response(object.body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; sandbox allow-popups allow-popups-to-escape-sandbox",
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="pauta-${mid}.html"`,
    },
  });
}
