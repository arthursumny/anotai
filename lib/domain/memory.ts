import { z } from 'zod';
import type { AgendaProposal } from './planning';
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v),
  );
export const memoryFilters = z
  .object({
    subject: z.string().trim().max(160).default(''),
    from: day.optional(),
    to: day.optional(),
    assignee: z.string().trim().max(120).default(''),
    status: z
      .enum([
        'all',
        'open',
        'in_progress',
        'done',
        'cancelled',
        'overdue',
        'pending',
        'confirmed',
        'draft',
      ])
      .default('all'),
    includeDrafts: z.boolean().default(false),
  })
  .refine((f) => !f.from || !f.to || f.from <= f.to, 'Período inválido.');
export const memoryQuery = z.object({
  query: z.string().trim().max(2000).default(''),
  filters: memoryFilters.default(() => memoryFilters.parse({})),
});
export type MemoryFilters = z.infer<typeof memoryFilters>;
export type Source = {
  id: string;
  kind:
    | 'minutes'
    | 'decision'
    | 'task'
    | 'draft'
    | 'organization'
    | 'participant'
    | 'knowledge';
  meetingId: string | null;
  title: string;
  date: string;
  topic: string;
  body: string;
  state: string;
  href: string;
  assignee: string;
  status: string;
  dueDate?: string | null;
};
export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
const stop = new Set(
  'o a os as um uma de da do das dos em na no nas nos e ou que qual quais quem como por para sobre este esta esse essa isto isso projeto assunto tarefa tarefas reuniao reunioes ultima ultimo ficou ficaram pendente pendentes decisoes decisao tomadas tomado foram foi feitas feito responsavel resuma resumo discutimos discutido tudo ja nossa nosso com tem mais crie pauta proxima semana'.split(
    ' ',
  ),
);
export function queryTerms(query: string) {
  return [...new Set(fold(query).match(/[a-z0-9]+/g) || [])]
    .filter((t) => t.length > 2 && !stop.has(t))
    .slice(0, 12)
    .map((t) => (t.length > 5 && t.endsWith('s') ? t.slice(0, -1) : t));
}
export const citationSchema = z.object({
  sourceId: z.string(),
  quote: z.string().min(1).max(1800),
});
export const selectionSchema = z.object({
  outcome: z.enum(['evidence', 'insufficient', 'ambiguous']),
  excerpts: z
    .array(
      z.object({ sourceId: z.string(), quote: z.string().min(1).max(1800) }),
    )
    .max(12),
  // Optional keeps persisted answers from the first memory release readable.
  summary: z.string().max(4000).optional(),
  citations: z.array(citationSchema).max(12).optional(),
});
export const modelSelectionSchema = z.object({
  outcome: z.enum(['evidence', 'insufficient', 'ambiguous']),
  summary: z.string().max(4000),
  citations: z.array(citationSchema).max(12),
});
export type Answer = z.infer<typeof selectionSchema> & {
  mode: 'ai' | 'local' | 'search';
  sources: Source[];
  limited: boolean;
  proposal?: AgendaProposal;
  action?: ChatAction;
};
export type ChatAction = {
  kind: 'presentation';
  meetingId: string | null;
  proposalId?: string;
  reason: string;
};
// Summary text is model output, but all factual references must be literal citations from authorized rows.
export function validateSelection(value: unknown, sources: Source[]) {
  const parsed = selectionSchema.parse(value);
  const citations = parsed.citations?.length
    ? parsed.citations
    : parsed.excerpts;
  for (const e of citations) {
    const source = sources.find((s) => s.id === e.sourceId);
    if (!source || !e.quote.trim() || !source.body.includes(e.quote))
      throw new Error('Invalid evidence');
  }
  if (!citations.length) parsed.outcome = 'insufficient';
  return {
    ...parsed,
    summary: citations.length ? parsed.summary : '',
    citations,
    excerpts: parsed.excerpts.length ? parsed.excerpts : citations,
  };
}
export const answerLabels = {
  evidence:
    'Encontrei evidências nos registros autorizados. Confira as referências para o contexto completo.',
  insufficient:
    'Não encontrei evidência suficiente nos registros autorizados para responder com segurança.',
  ambiguous:
    'Encontrei mais de uma possibilidade. Especifique a reunião, tarefa ou assunto para eu continuar.',
};
