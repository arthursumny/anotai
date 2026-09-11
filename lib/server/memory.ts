import { z } from 'zod';
import { memoryFilters, queryTerms, fold, type Answer } from '../domain/memory';
import { inferChatFilters, isPresentationRequest } from '../domain/chat';
import { all, one, run, id, now, assert, HttpError } from './runtime';
import { type Context, context, limit, meetingAccess } from './security';
import { answerMemory } from './memory-provider';
import { createProposal } from './planning';
import { knowledgeSourcesAllowed } from './knowledge';
import { isAgendaRequest } from '../domain/planning';
import { retrieve, authorizedMeetings } from './memory-retrieval';
export { retrieve } from './memory-retrieval';

async function chatAccess(c: Context, chatId: string) {
  const chat = await one(
    'SELECT * FROM memory_chats WHERE id=? AND org_id=? AND user_id=?',
    chatId,
    c.orgId,
    c.user.id,
  );
  assert(chat, 404, 'Conversa não encontrada.');
  return chat;
}
export async function listChats(c: Context, before?: string | null) {
  const cursor = before ? await chatAccess(c, z.uuid().parse(before)) : null;
  return all(
    `SELECT id,title,created_at FROM memory_chats WHERE org_id=? AND user_id=? ${cursor ? 'AND (created_at,id)<(?,?)' : ''} ORDER BY created_at DESC,id DESC LIMIT 100`,
    c.orgId,
    c.user.id,
    ...(cursor ? [cursor.created_at, cursor.id] : []),
  );
}
export async function createChat(c: Context) {
  await limit('memory-create:' + c.user.id, 100, 3600);
  const cid = id();
  await run(
    'INSERT INTO memory_chats(id,org_id,user_id,title,created_at) VALUES (?,?,?,?,?)',
    cid,
    c.orgId,
    c.user.id,
    'Nova conversa',
    now(),
  );
  return { id: cid };
}
async function dependenciesAllowed(c: Context, dependencies: string[]) {
  if (!dependencies.length) return true;
  const acl = authorizedMeetings(c);
  const rows = await all<{ id: string }>(
    `SELECT id FROM (${acl.sql}) WHERE id IN (SELECT value FROM json_each(?))`,
    ...acl.args,
    JSON.stringify(dependencies),
  );
  return dependencies.every((d) => rows.some((r) => r.id === d));
}
export async function readChat(
  c: Context,
  chatId: string,
  before?: string | null,
) {
  const chat = await chatAccess(c, chatId);
  const cursor = before
    ? await one(
        'SELECT id,created_at FROM memory_turns WHERE id=? AND chat_id=?',
        z.uuid().parse(before),
        chatId,
      )
    : null;
  assert(!before || cursor, 404, 'Mensagem não encontrada.');
  const page = await all(
    `SELECT * FROM memory_turns WHERE chat_id=? ${cursor ? 'AND (created_at,id)<(?,?)' : ''} ORDER BY created_at DESC,id DESC LIMIT 101`,
    chatId,
    ...(cursor ? [cursor.created_at, cursor.id] : []),
  );
  const rows = page.slice(0, 100).reverse();
  const dependencies = [
    ...new Set(rows.flatMap((row) => JSON.parse(row.dependencies) as string[])),
  ];
  const acl = authorizedMeetings(c);
  const visible = dependencies.length
    ? await all<{ id: string }>(
        `SELECT id FROM (${acl.sql}) WHERE id IN (SELECT value FROM json_each(?))`,
        ...acl.args,
        JSON.stringify(dependencies),
      )
    : [];
  const allowedIds = new Set(visible.map((row) => row.id));
  const turns = [];
  for (const row of rows) {
    const answer = row.answer ? (JSON.parse(row.answer) as Answer) : null;
    const allowed =
      (await knowledgeSourcesAllowed(c, [
        ...(answer?.sources || []),
        ...(answer?.proposal?.sources || []),
      ])) &&
      (JSON.parse(row.dependencies) as string[]).every((mid) =>
        allowedIds.has(mid),
      );
    turns.push({
      id: row.id,
      question: allowed
        ? row.question
        : 'Mensagem indisponível após alteração de acesso.',
      filters: allowed ? JSON.parse(row.filters) : null,
      state: allowed ? row.state : 'restricted',
      answer: allowed && row.answer ? JSON.parse(row.answer) : null,
      createdAt: row.created_at,
    });
  }
  return { chat, turns, hasMore: page.length > 100 };
}
export async function ask(c: Context, chatId: string, request: Request) {
  await chatAccess(c, chatId);
  const input = z
    .object({
      requestId: z.uuid(),
      question: z.string().trim().min(1).max(2000),
      filters: memoryFilters.optional(),
    })
    .parse(await request.json());
  const inferred = inferChatFilters(input.question);
  const filters = {
    ...inferred,
    ...input.filters,
  };
  const existing = await one(
    'SELECT * FROM memory_turns WHERE id=?',
    input.requestId,
  );
  if (existing) {
    assert(
      existing.chat_id === chatId &&
        existing.question === input.question &&
        existing.filters === JSON.stringify(filters),
      409,
      'Identificador já utilizado por outra pergunta.',
    );
    if (existing.state === 'completed') return readChat(c, chatId);
  }
  await limit('memory-ask:' + c.orgId + ':' + c.user.id, 30, 3600);
  const timestamp = now();
  const claim = await run(
    `INSERT INTO memory_turns(id,chat_id,question,filters,state,created_at,updated_at) VALUES (?,?,?,?,'pending',?,?) ON CONFLICT(id) DO UPDATE SET state='pending',updated_at=excluded.updated_at WHERE memory_turns.chat_id=excluded.chat_id AND (memory_turns.state='failed' OR (memory_turns.state='pending' AND memory_turns.updated_at<?))`,
    input.requestId,
    chatId,
    input.question,
    JSON.stringify(filters),
    timestamp,
    timestamp,
    new Date(Date.now() - 120000).toISOString(),
  );
  assert(
    claim.meta.changes,
    409,
    'Esta pergunta ainda está sendo respondida. Aguarde e atualize a conversa.',
  );
  try {
    // Follow-ups can reuse the scope of an authorized answer. Re-fetch current rows;
    // never use a previous model response as factual evidence.
    let query = input.question;
    let focus: string[] | undefined;
    if (
      !filters.subject &&
      !queryTerms(query).length &&
      /\b(essa|esse|esta|este|disso|dessa|desse|desta|deste)\b/.test(
        fold(query),
      )
    ) {
      const history = await readChat(c, chatId);
      const previous = history.turns
        .filter((t) => t.state === 'completed')
        .at(-1);
      if (previous?.answer) {
        focus = [
          ...new Set(
            (previous.answer as Answer).sources.flatMap((s) =>
              s.meetingId ? [s.meetingId] : [],
            ),
          ),
        ];
        query = (query + ' ' + queryTerms(previous.question).join(' ')).slice(
          0,
          2000,
        );
      }
    }
    const proposal = isAgendaRequest(input.question)
      ? await createProposal(
          c,
          {
            requestId: input.requestId,
            objective: input.question,
            subject: filters.subject,
          },
          request,
        )
      : undefined;
    const found = proposal
      ? {
          sources: proposal.sources,
          limited: proposal.limited,
          ambiguous: false,
        }
      : await retrieve(c, { query, filters }, focus);
    let previousProposal: Answer['proposal'];
    let presentationMeetingId: string | null = null;
    if (isPresentationRequest(input.question)) {
      const history = await readChat(c, chatId);
      const previous = history.turns
        .filter((t) => t.state === 'completed')
        .at(-1);
      const previousAnswer = previous?.answer as Answer | null | undefined;
      previousProposal = previousAnswer?.proposal;
      // Historical sources are not the meeting the user wants to prepare.
      const candidate = previousProposal?.meetingId || null;
      if (candidate) {
        try {
          await meetingAccess(c, candidate, true);
          presentationMeetingId = candidate;
        } catch {
          presentationMeetingId = null;
        }
      }
    }
    const dependencies = [
      ...new Set(
        [...found.sources, ...(previousProposal?.sources || [])].flatMap((s) =>
          s.meetingId ? [s.meetingId] : [],
        ),
      ),
    ];
    if (presentationMeetingId) dependencies.push(presentationMeetingId);
    await run(
      'UPDATE memory_turns SET dependencies=? WHERE id=? AND updated_at=?',
      JSON.stringify(dependencies),
      input.requestId,
      timestamp,
    );
    const answer: Answer = proposal
      ? {
          mode:
            proposal.mode === 'ai'
              ? 'ai'
              : proposal.mode === 'local'
                ? 'local'
                : 'search',
          outcome: proposal.sources.length ? 'evidence' : 'insufficient',
          sources: proposal.sources,
          excerpts: [],
          limited: proposal.limited,
          proposal,
        }
      : isPresentationRequest(input.question)
        ? {
            mode: 'search',
            outcome: previousProposal ? 'evidence' : 'insufficient',
            summary: presentationMeetingId
              ? 'A pauta está vinculada a uma reunião editável. Abra a preparação, confira a revisão e confirme a geração da apresentação.'
              : previousProposal
                ? 'A pauta foi proposta, mas ainda precisa ser incorporada e salva em uma reunião antes da geração da apresentação.'
                : 'Para gerar uma apresentação, primeiro crie ou selecione uma reunião com uma pauta salva e revisada.',
            excerpts: [],
            citations: [],
            sources: previousProposal?.sources || found.sources,
            limited: previousProposal?.limited || found.limited,
            action: {
              kind: 'presentation',
              meetingId: presentationMeetingId,
              proposalId: previousProposal?.id,
              reason: presentationMeetingId
                ? 'A geração exige revisão explícita da pauta na reunião.'
                : 'A apresentação só pode ser gerada depois que a pauta estiver salva em uma reunião.',
            },
          }
        : await answerMemory(input.question, found);
    const fresh = await context(request);
    assert(
      fresh.orgId === c.orgId &&
        (await dependenciesAllowed(fresh, dependencies)) &&
        (await knowledgeSourcesAllowed(fresh, [
          ...found.sources,
          ...(previousProposal?.sources || []),
        ])),
      403,
      'O acesso às fontes mudou. Faça uma nova consulta.',
    );
    const saved = await run(
      "UPDATE memory_turns SET answer=?,state='completed',updated_at=? WHERE id=? AND state='pending' AND updated_at=?",
      JSON.stringify(answer),
      now(),
      input.requestId,
      timestamp,
    );
    assert(
      saved.meta.changes,
      409,
      'A pergunta foi retomada em outra solicitação. Atualize a conversa.',
    );
    // Keep generic conversation titles: source-derived titles could reveal revoked meeting content.
    return readChat(fresh, chatId);
  } catch (error) {
    await run(
      "UPDATE memory_turns SET state='failed',updated_at=? WHERE id=? AND state='pending' AND updated_at=?",
      now(),
      input.requestId,
      timestamp,
    );
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      502,
      'Não foi possível consultar a memória agora. Sua pergunta foi salva; tente novamente.',
    );
  }
}
