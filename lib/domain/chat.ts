import { fold, type MemoryFilters } from './memory';

export type ChatIntent = 'history' | 'agenda' | 'presentation';

export function isMeetingRequest(question: string) {
  return /^(?:(?:por favor[, ]*|(?:voce )?(?:pode|poderia)|quero|gostaria de)\s*)?(?:crie|criar|prepare|preparar|monte|montar|organize|organizar|agende|agendar)\s+(?:uma |a |nova |uma nova )?reuniao\b/.test(
    fold(question).trim(),
  );
}

export function isPresentationRequest(question: string) {
  const text = fold(question).trim();
  return (
    /\b(apresentacao|slides?|material(?: de apoio)?)\b/.test(text) &&
    /\b(crie|criar|gere|gerar|prepare|preparar|monte|montar|faca|fazer|produza|produzir)\b/.test(
      text,
    )
  );
}

export function isNextMeetingTopicsRequest(question: string) {
  const text = fold(question).trim();
  return (
    /\b(proxim[ao]|seguinte)\s+reuniao\b/.test(text) &&
    /\b(assunto|assuntos|tema|temas|ponto|pontos|discuss|entrar|incluir)\b/.test(
      text,
    )
  );
}

function dateValue(value: string) {
  const date = new Date(value + 'T12:00:00Z');
  return Number.isNaN(date.getTime()) ? undefined : value;
}

export function inferChatFilters(question: string): MemoryFilters {
  const text = fold(question);
  const filters = {
    subject: '',
    from: undefined as string | undefined,
    to: undefined as string | undefined,
    assignee: '',
    status: 'all' as MemoryFilters['status'],
    includeDrafts: false,
  };
  if (/\b(vencid|atrasad)\w*/.test(text)) filters.status = 'overdue';
  else if (/\b(em aberto|pendenc|pendente)\w*/.test(text))
    filters.status = 'open';
  else if (/\b(em andamento)\b/.test(text)) filters.status = 'in_progress';
  else if (/\b(conclu|finalizad)\w*/.test(text)) filters.status = 'done';
  else if (/\b(cancelad)\w*/.test(text)) filters.status = 'cancelled';
  else if (/\brascunho\w*/.test(text)) filters.status = 'draft';

  const range = text.match(
    /\b(?:de|entre)\s+(\d{4}-\d{2}-\d{2})\s+(?:a|e|ate)\s+(\d{4}-\d{2}-\d{2})\b/,
  );
  if (range) {
    filters.from = dateValue(range[1]);
    filters.to = dateValue(range[2]);
  }
  const single = text.match(/\b(?:em|depois de|apos)\s+(\d{4}-\d{2}-\d{2})\b/);
  if (single && !filters.from) filters.from = dateValue(single[1]);

  const owner = question.match(
    /(?:\brespons[aá]vel(?:\s+(?:é|foi|ficou))?\s*[:-]?|\b(?:tarefas?|pend[eê]ncias?)\b[^?.!,;]*?\bda)\s*([A-ZÀ-Ý][\wÀ-ÿ]*(?:\s+[A-ZÀ-Ý][\wÀ-ÿ]*){0,2})/,
  );
  if (owner) filters.assignee = owner[1].trim().slice(0, 120);

  const subject = question.match(
    /\b(?:sobre|acerca de|do projeto|da iniciativa|assunto)\s+([^?.!,;]+?)(?:\s+(?:na|no|em|da|do)\s+(?:última|ultima|próxima|proxima|reunião|reuniao)|[?.!,;]|$)/i,
  );
  if (subject) {
    const candidate = subject[1].trim();
    if (!/^(este|esta|esse|essa|determinado|tal)\b/i.test(candidate))
      filters.subject = candidate.slice(0, 160);
  }
  return filters;
}

export function classifyChat(question: string): ChatIntent {
  if (isPresentationRequest(question)) return 'presentation';
  if (
    isMeetingRequest(question) ||
    isNextMeetingTopicsRequest(question) ||
    (/\b(pauta|agenda)\b/.test(fold(question)) &&
      /\b(crie|criar|prepare|preparar|monte|montar|sugira|sugerir|gere|gerar)\b/.test(
        fold(question),
      ))
  )
    return 'agenda';
  return 'history';
}
