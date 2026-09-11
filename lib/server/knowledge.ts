import { z } from 'zod';
import { all, one, run, id, now, assert, runtime } from './runtime';
import { type Context, limit } from './security';
import { fold, queryTerms, type Source } from '../domain/memory';

const fields = z.object({
  title: z.string().trim().min(2).max(200),
  category: z.enum(['minutes', 'team', 'project', 'process', 'business']),
  date: z
    .string()
    .max(10)
    .refine(
      (value) =>
        !value ||
        (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
          !Number.isNaN(Date.parse(value)) &&
          new Date(value).toISOString().startsWith(value)),
      'Data inválida.',
    )
    .default(''),
  content: z.string().trim().min(3).max(100000),
});
export async function listKnowledge(c: Context) {
  return all(
    `SELECT id,title,category,date,content,state,revision,filename,updated_at FROM knowledge_documents WHERE org_id=? ${c.admin ? '' : "AND state='confirmed'"} ORDER BY updated_at DESC LIMIT 100`,
    c.orgId,
  );
}
export async function createKnowledge(c: Context, request: Request) {
  assert(c.admin, 403, 'Somente administradores podem cadastrar conhecimento.');
  await limit('knowledge:' + c.orgId, 50, 3600);
  assert(
    Number(request.headers.get('content-length') || 0) <= 6 * 1024 * 1024,
    413,
    'Documento muito grande. Use até 5 MB.',
  );
  const form = await request.formData();
  const file = form.get('file');
  const rawContent = form.get('content');
  let content = typeof rawContent === 'string' ? rawContent : '';
  let bytes: ArrayBuffer | undefined;
  if (file instanceof File && file.size) {
    assert(file.size <= 5 * 1024 * 1024, 413, 'Use um documento de até 5 MB.');
    bytes = await file.arrayBuffer();
    if (/\.pdf$/i.test(file.name)) {
      const { getDocumentProxy, extractText } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(bytes.slice(0)), {
        disableFontFace: true,
        useSystemFonts: false,
      });
      try {
        assert(
          pdf.numPages <= 100,
          400,
          'Importe até 100 páginas por documento.',
        );
        content = (await extractText(pdf, { mergePages: true })).text;
      } finally {
        await pdf.loadingTask.destroy();
      }
      assert(
        content.trim().length >= 3,
        400,
        'Este PDF não contém texto extraível. Cole o texto para revisão; imagens não passam por OCR.',
      );
    } else {
      assert(
        /\.(txt|md)$/i.test(file.name),
        415,
        'Use PDF com texto, TXT ou Markdown, ou cole o conteúdo.',
      );
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        assert(false, 400, 'O arquivo de texto não está em UTF-8 válido.');
      }
    }
  }
  const data = fields.parse({
    title: form.get('title'),
    category: form.get('category'),
    date: form.get('date') || '',
    content,
  });
  const did = id(),
    key = bytes ? `${c.orgId}/knowledge/${did}` : null;
  if (key && bytes) await runtime().FILES.put(key, bytes);
  try {
    await run(
      'INSERT INTO knowledge_documents(id,org_id,title,category,date,content,key,filename,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      did,
      c.orgId,
      data.title,
      data.category,
      data.date,
      data.content,
      key,
      file instanceof File ? file.name.slice(0, 200) : null,
      now(),
      now(),
    );
  } catch (error) {
    if (key) await runtime().FILES.delete(key);
    throw error;
  }
  return { id: did };
}
export async function updateKnowledge(
  c: Context,
  did: string,
  request: Request,
) {
  assert(c.admin, 403, 'Somente administradores podem revisar conhecimento.');
  const data = fields
    .extend({
      revision: z.number().int().min(0),
      state: z.enum(['draft', 'confirmed', 'archived']),
      reviewed: z.boolean().default(false),
    })
    .parse(await request.json());
  assert(
    data.state !== 'confirmed' || data.reviewed,
    400,
    'Confira o conteúdo e confirme o compartilhamento antes de disponibilizar à IA.',
  );
  const r = await run(
    'UPDATE knowledge_documents SET title=?,category=?,date=?,content=?,state=?,revision=revision+1,updated_at=? WHERE id=? AND org_id=? AND revision=?',
    data.title,
    data.category,
    data.date,
    data.content,
    data.state,
    now(),
    did,
    c.orgId,
    data.revision,
  );
  assert(
    r.meta.changes,
    409,
    'Documento indisponível ou alterado. Atualize antes de salvar.',
  );
  return { id: did };
}
export async function downloadKnowledge(c: Context, did: string) {
  const d = await one(
    `SELECT * FROM knowledge_documents WHERE id=? AND org_id=? ${c.admin ? '' : "AND state='confirmed'"}`,
    did,
    c.orgId,
  );
  assert(d?.key, 404, 'Anexo indisponível.');
  const file = await runtime().FILES.get(d.key);
  assert(file, 404, 'Anexo indisponível.');
  return new Response(file.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(d.filename)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
export async function knowledgeSources(
  c: Context,
  query: string,
): Promise<Source[]> {
  const terms = queryTerms(query);
  // A pergunta precisa trazer um termo verificável; perguntas genéricas não
  // devem receber documentos de empresa sem relação.
  if (!terms.length) return [];
  const documents = await all(
    "SELECT id,title,category,date,content,revision FROM knowledge_documents WHERE org_id=? AND state='confirmed' ORDER BY updated_at DESC LIMIT 100",
    c.orgId,
  );
  return documents
    .map((d) => ({
      d,
      score: terms.reduce(
        (score, t) =>
          score + Number(fold(d.title + ' ' + d.content).includes(t)),
        0,
      ),
    }))
    .filter((x) => !terms.length || x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ d }) => {
      const positions = terms
        .map((term) => fold(d.content).indexOf(term))
        .filter((position) => position >= 0);
      const start = Math.max(
        0,
        (positions.length ? Math.min(...positions) : 0) - 500,
      );
      return {
        id: `knowledge:${d.id}:${d.revision}`,
        kind: 'knowledge',
        meetingId: null,
        title: d.title,
        date: d.date,
        topic: d.category,
        body: d.content.slice(start, start + 4000),
        state:
          d.category === 'minutes'
            ? 'Ata importada e revisada — sem aceite na plataforma'
            : 'Conhecimento da empresa revisado',
        href: `/organizacao?org=${c.orgId}#knowledge-${d.id}`,
        assignee: '',
        status: '',
      };
    });
}
export async function knowledgeSourcesAllowed(c: Context, sources: Source[]) {
  for (const source of sources.filter((s) => s.kind === 'participant')) {
    const [, pid, revision] = source.id.split(':');
    const p = await one(
      'SELECT revision FROM participants WHERE id=? AND org_id=?',
      pid,
      c.orgId,
    );
    if (!p || String(p.revision) !== revision) return false;
  }
  for (const source of sources.filter((s) => s.kind === 'knowledge')) {
    const [, did, revision] = source.id.split(':');
    const d = await one(
      "SELECT revision FROM knowledge_documents WHERE id=? AND org_id=? AND state='confirmed'",
      did,
      c.orgId,
    );
    if (!d || String(d.revision) !== revision) return false;
  }
  return true;
}
export async function participantSources(
  c: Context,
  query: string,
  meetingId?: string,
): Promise<Source[]> {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const rows = await all(
    `SELECT id,name,kind,department,responsibilities,revision FROM participants WHERE org_id=? ${meetingId ? 'AND id IN (SELECT participant_id FROM meeting_participants WHERE meeting_id=?)' : ''} ORDER BY name LIMIT 500`,
    c.orgId,
    ...(meetingId ? [meetingId] : []),
  );
  return rows
    .map((p) => ({
      p,
      score: terms.reduce(
        (n, t) =>
          n +
          Number(
            fold(`${p.name} ${p.department} ${p.responsibilities}`).includes(t),
          ),
        0,
      ),
    }))
    .filter(({ p, score }) => score > 0 && (p.department || p.responsibilities))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ p }) => ({
      id: `participant:${p.id}:${p.revision}`,
      kind: 'participant',
      meetingId: null,
      title: p.name,
      topic: p.department,
      date: '',
      body: `Nome: ${p.name}\nSetor: ${p.department || 'Não informado'}\nResponsabilidades: ${p.responsibilities || 'Não informadas'}`,
      state:
        'Perfil cadastrado pelo administrador — não é atribuição de tarefa',
      href: `/pessoas?org=${c.orgId}#participant-${p.id}`,
      assignee: '',
      status: '',
    }));
}
