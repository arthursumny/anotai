import { z } from 'zod';
import { fold, type Source } from './memory';
import {
  isMeetingRequest,
  isNextMeetingTopicsRequest,
  isPresentationRequest,
} from './chat';
export const planningInput = z.object({
  requestId: z.uuid(),
  objective: z.string().trim().min(3).max(2000),
  subject: z.string().trim().max(160).default(''),
  meetingId: z.uuid().nullable().default(null),
});
export const planningSelection = z.object({
  selections: z
    .array(
      z.object({ sourceId: z.string(), quote: z.string().min(1).max(1800) }),
    )
    .max(10),
});
export type ProposalItem = {
  id: string;
  title: string;
  taskId: string | null;
  category: 'objective' | 'pending' | 'overdue' | 'recurring' | 'context';
  reason: string;
  sourceIds: string[];
};
export type AgendaProposal = {
  id: string;
  objective: string;
  topic: string;
  meetingId: string | null;
  mode: 'ai' | 'local' | 'objective';
  items: ProposalItem[];
  sources: Source[];
  limited: boolean;
  createdAt: string;
};
export function isAgendaRequest(question: string) {
  const text = fold(question).trim();
  if (isPresentationRequest(question)) return false;
  return (
    isMeetingRequest(question) ||
    isNextMeetingTopicsRequest(question) ||
    (/\b(pauta|agenda)\b/.test(text) &&
      /^(?:(?:por favor[, ]*|(?:voce )?(?:pode|poderia)|quero|gostaria de)\s*)?(crie|criar|prepare|preparar|monte|montar|sugira|sugerir|gere|gerar)\b/.test(
        text,
      ))
  );
}
// Suggestions are discussion prompts. All factual wording is copied from authorized rows.
export function proposalItems(
  objective: string,
  sources: Source[],
  selected: unknown,
  today: string,
): ProposalItem[] {
  const selection = planningSelection.parse(selected);
  const items: ProposalItem[] = [
    {
      id: 'objective',
      title: ('Alinhar o objetivo: ' + objective).slice(0, 500),
      taskId: null,
      category: 'objective',
      reason:
        'Objetivo informado por você. Proposta para discussão; não é uma decisão tomada.',
      sourceIds: [],
    },
  ];
  const seen = new Set<string>();
  for (const item of selection.selections) {
    const source = sources.find((s) => s.id === item.sourceId);
    if (!source || !source.body.includes(item.quote) || !item.quote.trim())
      throw new Error('Origem da sugestão inválida.');
    if (seen.has(source.id)) continue;
    seen.add(source.id);
    const description =
      source.kind === 'participant'
        ? source.body.split('Responsabilidades: ')[1] || source.title
        : source.body.split('\n')[0].replace(/^Resumo: /, '');
    const pending =
      source.kind === 'task' && ['open', 'in_progress'].includes(source.status);
    const overdue = pending && !!source.dueDate && source.dueDate < today;
    items.push({
      id: source.id,
      title: (
        (source.kind === 'participant'
          ? 'Alinhar responsabilidades: '
          : pending
            ? 'Acompanhar: '
            : source.kind === 'decision'
              ? 'Rever desdobramentos: '
              : 'Discutir contexto: ') + description
      ).slice(0, 500),
      taskId: source.kind === 'task' ? source.id.slice(5) : null,
      category: overdue ? 'overdue' : pending ? 'pending' : 'context',
      reason: overdue
        ? `Tarefa em aberto com prazo registrado em ${source.dueDate}. Confira a situação atual.`
        : pending
          ? 'Pendência confirmada em reunião anterior.'
          : `Contexto registrado em “${source.title}” (${source.state}).`,
      sourceIds: [source.id],
    });
  }
  const topics = new Map<string, Source[]>();
  for (const source of sources.filter(
    (s) => seen.has(s.id) && s.topic.trim(),
  )) {
    const key = fold(source.topic.trim());
    const group = topics.get(key) || [];
    if (!group.some((s) => s.meetingId === source.meetingId))
      group.push(source);
    topics.set(key, group);
  }
  for (const group of topics.values())
    if (group.length > 1 && items.length < 13)
      items.push({
        id: 'recurring:' + group[0].id,
        title: ('Retomar tema recorrente: ' + group[0].topic).slice(0, 500),
        taskId: null,
        category: 'recurring',
        reason: `Assunto presente em ${group.length} reuniões entre as fontes selecionadas.`,
        sourceIds: group.map((s) => s.id),
      });
  return items.sort(
    (a, b) =>
      ({ objective: 0, overdue: 1, pending: 2, recurring: 3, context: 4 })[
        a.category
      ] -
      { objective: 0, overdue: 1, pending: 2, recurring: 3, context: 4 }[
        b.category
      ],
  );
}
