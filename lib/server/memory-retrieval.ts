import { memoryQuery, queryTerms, fold, type Source } from '../domain/memory';
import { all } from './runtime';
import type { Context } from './security';
import { knowledgeSources, participantSources } from './knowledge';
// The ACL is part of the source query, before lexical matching, ranking or LIMIT.
export function authorizedMeetings(c: Context) {
  return {
    sql: `SELECT m.id,m.org_id,m.title,m.topic,m.objective,m.scheduled_at,m.version,m.status,m.draft FROM meetings m WHERE m.org_id=? AND (?=1 OR m.organizer_id=? OR EXISTS (SELECT 1 FROM meeting_participants mp JOIN participants p ON p.id=mp.participant_id WHERE mp.meeting_id=m.id AND p.org_id=m.org_id AND p.email=?))`,
    args: [c.orgId, c.admin ? 1 : 0, c.user.id, c.user.email],
  };
}
function normalizedSql(column: string) {
  let sql = `lower(${column})`;
  for (const [a, b] of Object.entries({
    á: 'a',
    à: 'a',
    ã: 'a',
    â: 'a',
    é: 'e',
    ê: 'e',
    í: 'i',
    ó: 'o',
    ô: 'o',
    õ: 'o',
    ú: 'u',
    ü: 'u',
    ç: 'c',
    Á: 'a',
    Ã: 'a',
    É: 'e',
    Í: 'i',
    Ó: 'o',
    Ú: 'u',
    Ç: 'c',
  }))
    sql = `replace(${sql},'${a}','${b}')`;
  return sql;
}
const like = (s: string) => '%' + fold(s).replace(/[\\%_]/g, '\\$&') + '%';
export async function retrieve(c: Context, input: unknown, focus?: string[]) {
  const { query, filters: f } = memoryQuery.parse(input);
  const acl = authorizedMeetings(c);
  const args: unknown[] = [...acl.args];
  const where = ['1=1'];
  if (focus?.length) {
    where.push('meetingId IN (SELECT value FROM json_each(?))');
    args.push(JSON.stringify(focus));
  }
  if (f.from) {
    where.push('substr(date,1,10)>=?');
    args.push(f.from);
  }
  if (f.to) {
    where.push('substr(date,1,10)<=?');
    args.push(f.to);
  }
  if (f.subject) {
    where.push(
      `${normalizedSql("title||' '||topic||' '||body")} LIKE ? ESCAPE '\\'`,
    );
    args.push(like(f.subject));
  }
  if (f.assignee) {
    where.push(
      `kind='task' AND ${normalizedSql('assignee')} LIKE ? ESCAPE '\\'`,
    );
    args.push(like(f.assignee));
  }
  const q = fold(query);
  const pending = /pendent/.test(q);
  const last = /ultim[ao].*reuniao/.test(q);
  if (last) {
    const lastWhere = ["kind='minutes'"];
    if (f.from) {
      lastWhere.push('substr(date,1,10)>=?');
      args.push(f.from);
    }
    if (f.to) {
      lastWhere.push('substr(date,1,10)<=?');
      args.push(f.to);
    }
    const subject = f.subject || queryTerms(query).join(' ');
    if (subject) {
      lastWhere.push(
        `${normalizedSql("title||' '||topic||' '||body")} LIKE ? ESCAPE '\\'`,
      );
      args.push(like(subject));
    }
    if (focus?.length) {
      lastWhere.push('meetingId IN (SELECT value FROM json_each(?))');
      args.push(JSON.stringify(focus));
    }
    where.push(
      `date=(SELECT MAX(date) FROM sources WHERE ${lastWhere.join(' AND ')})`,
    );
  }
  if (f.status === 'overdue') {
    where.push(
      "kind='task' AND status IN ('open','in_progress') AND dueDate < ?",
    );
    args.push(
      new Intl.DateTimeFormat('en-CA', { timeZone: c.org.timezone }).format(
        new Date(),
      ),
    );
  } else if (['open', 'in_progress', 'done', 'cancelled'].includes(f.status)) {
    where.push("kind='task' AND status=?");
    args.push(f.status);
  } else if (f.status === 'pending')
    where.push(
      "state IN ('Aceite pendente','Ajustes solicitados — ata bloqueada')",
    );
  else if (f.status === 'confirmed') where.push("kind<>'draft'");
  else if (f.status === 'draft') where.push("kind='draft'");
  else if (pending)
    where.push("kind='task' AND status IN ('open','in_progress')");
  if (/decisoes|decisao/.test(q)) where.push("kind='decision'");
  else if (/responsavel|quem/.test(q) && /tarefa/.test(q))
    where.push("kind='task'");
  const terms = queryTerms(query);
  const searchable = normalizedSql(
    "title||' '||topic||' '||body||' '||assignee",
  );
  const rank = terms.length
    ? terms
        .map(
          () =>
            `(CASE WHEN ${searchable} LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END)`,
        )
        .join('+')
    : '0';
  // Rank bindings follow filter bindings because scoring wraps the filtered CTE.
  args.push(...terms.map(like));
  const rows = await all<
    Source & { dueDate: string | null; score: number; version: number }
  >(
    `WITH allowed AS (${acl.sql}),
  confirmed AS (SELECT m.*,v.id AS vid,v.content,v.number,
    CASE WHEN EXISTS(SELECT 1 FROM acceptances a WHERE a.minutes_id=v.id AND a.status='changes_requested') THEN 'Ajustes solicitados — ata bloqueada'
    WHEN EXISTS(SELECT 1 FROM acceptances a WHERE a.minutes_id=v.id AND a.status<>'accepted') THEN 'Aceite pendente'
    WHEN EXISTS(SELECT 1 FROM acceptances a WHERE a.minutes_id=v.id) THEN 'Aceita por todos'
    ELSE 'Confirmado — ainda não enviado' END AS state
    FROM allowed m JOIN minutes v ON v.meeting_id=m.id AND v.org_id=m.org_id AND v.number=m.version),
  sources AS (
    SELECT 'minutes:'||vid AS id,'minutes' AS kind,id AS meetingId,title,scheduled_at AS date,topic,
      'Resumo: '||coalesce(json_extract(content,'$.draft.summary'),'')||char(10)||'Temas: '||coalesce(json_extract(content,'$.draft.topics'),'[]') AS body,
      state, '' AS assignee,'' AS status,NULL AS dueDate,number AS version FROM confirmed
    UNION ALL SELECT 'decision:'||d.id,'decision',m.id,m.title,m.scheduled_at,m.topic,d.description||char(10)||'Evidência: '||d.evidence,m.state,'','',NULL,m.number FROM confirmed m JOIN decisions d ON d.meeting_id=m.id AND d.org_id=m.org_id AND d.minutes_id=m.vid WHERE d.active=1
    UNION ALL SELECT 'task:'||t.id,'task',m.id,m.title,m.scheduled_at,m.topic,t.description||char(10)||'Responsável: '||coalesce(p.name,'Não definido')||char(10)||'Prazo: '||coalesce(t.due_date,'Não definido')||char(10)||'Situação: '||CASE t.status WHEN 'open' THEN 'Em aberto' WHEN 'in_progress' THEN 'Em andamento' WHEN 'done' THEN 'Concluída' ELSE 'Cancelada' END||char(10)||'Evidência: '||t.evidence,m.state,coalesce(p.name,''),t.status,t.due_date,m.number FROM confirmed m JOIN tasks t ON t.meeting_id=m.id AND t.org_id=m.org_id AND t.minutes_id=m.vid LEFT JOIN participants p ON p.id=t.assignee_id AND p.org_id=m.org_id WHERE t.active=1
    ${f.includeDrafts ? `UNION ALL SELECT 'draft:'||id,'draft',id,title,scheduled_at,topic,'Rascunho não confirmado: '||draft,'Rascunho — não confirmado','','',NULL,0 FROM allowed WHERE status='review' AND draft IS NOT NULL` : ''}
  ), filtered AS (SELECT * FROM sources WHERE ${where.join(' AND ')}), scored AS (SELECT *,${rank} AS score FROM filtered)
  SELECT * FROM scored ${terms.length ? 'WHERE score>0' : ''} ORDER BY CASE WHEN kind='draft' THEN 1 ELSE 0 END,score DESC,date DESC,id LIMIT 49`,
    ...args,
  );
  let budget = 36000;
  let truncated = false;
  const sources: Source[] = [];
  for (const row of rows.slice(0, 24)) {
    const body = row.body.slice(0, Math.min(6000, budget));
    if (!body) break;
    budget -= body.length;
    truncated ||= body.length < row.body.length;
    const record = encodeURIComponent(row.id.slice(row.id.indexOf(':') + 1));
    const href =
      row.kind === 'minutes'
        ? `/imprimir/${row.meetingId}?org=${c.orgId}&version=${row.version}`
        : `/reunioes/${row.meetingId}?org=${c.orgId}&tab=${row.kind === 'draft' ? 'ata' : 'acoes'}#${record}`;
    sources.push({
      id: row.id,
      kind: row.kind,
      meetingId: row.meetingId,
      title: row.title,
      date: row.date,
      topic: row.topic,
      body,
      state: row.state,
      assignee: row.assignee,
      status: row.status,
      dueDate: row.dueDate,
      href,
    });
  }
  if (
    !focus?.length &&
    !f.subject &&
    !last &&
    !f.from &&
    !f.to &&
    !f.assignee &&
    f.status === 'all' &&
    !pending &&
    !/decis/.test(q)
  ) {
    const business = String(c.org.business || '');
    if (
      business &&
      (queryTerms(query).some((t) =>
        fold(business + ' ' + c.org.org_name).includes(t),
      ) ||
        /empresa|organizacao|negocio/.test(q))
    )
      sources.push({
        id: 'organization:' + c.orgId,
        kind: 'organization',
        meetingId: null,
        title: c.org.org_name,
        date: '',
        topic: 'Empresa',
        body: business.slice(0, 4000),
        state: 'Informação cadastrada da empresa',
        href: '/organizacao?org=' + c.orgId,
        assignee: '',
        status: '',
      });
  }
  if (
    !focus?.length &&
    !last &&
    !pending &&
    !f.assignee &&
    ['all', 'confirmed'].includes(f.status)
  ) {
    const knowledge = await knowledgeSources(c, [query, f.subject].join(' '));
    sources.push(
      ...knowledge.filter(
        (s) =>
          (!f.from || s.date >= f.from) && (!f.to || !s.date || s.date <= f.to),
      ),
    );
  }
  if (
    !focus?.length &&
    !last &&
    !pending &&
    !f.assignee &&
    !f.from &&
    !f.to &&
    f.status === 'all' &&
    !/decis|tarefa|ficou responsavel|assumiu/.test(q)
  ) {
    sources.push(
      ...(await participantSources(c, [query, f.subject].join(' '))),
    );
  }
  return {
    sources,
    limited:
      rows.length > sources.filter((s) => s.meetingId).length || truncated,
    ambiguous:
      (last && new Set(sources.map((s) => s.meetingId)).size > 1) ||
      (!f.subject &&
        !terms.length &&
        /este assunto|esse assunto|este projeto|esse projeto|esta tarefa|essa tarefa/.test(
          q,
        ) &&
        (sources.filter((s) => s.kind === 'task').length > 1 ||
          new Set(sources.map((s) => s.meetingId)).size > 1)),
  };
}
