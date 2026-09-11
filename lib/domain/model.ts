import { z } from 'zod';
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const EMAIL = z.string().trim().toLowerCase().pipe(z.email().max(254));
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    'Data inválida',
  );
export const agendaSchema = z
  .array(
    z.object({
      id: z.string().max(100),
      title: z.string().trim().min(1).max(500),
      taskId: z.string().nullable().default(null),
      origin: z
        .object({ proposalId: z.uuid(), itemId: z.string().min(1).max(200) })
        .optional(),
    }),
  )
  .max(60);
export const meetingSchema = z.object({
  title: z.string().trim().min(3).max(200),
  objective: z.string().max(5000).default(''),
  scheduledAt: z.iso.datetime(),
  duration: z.number().int().min(5).max(480),
  location: z.string().max(500).default(''),
  topic: z.string().max(200).default(''),
  agenda: agendaSchema,
  participantIds: z.array(z.string()).max(100),
});
export const draftSchema = z
  .object({
    summary: z.string().max(20000),
    topics: z.array(z.string().max(5000)).max(100),
    decisions: z
      .array(
        z.object({
          id: z.string().max(100),
          description: z.string().min(1).max(5000),
          evidence: z.string().max(5000),
        }),
      )
      .max(100),
    tasks: z
      .array(
        z.object({
          id: z.string().max(100),
          description: z.string().min(1).max(5000),
          evidence: z.string().max(5000),
          assigneeId: z.string().nullable(),
          dueDate: date.nullable(),
        }),
      )
      .max(100),
    uncertainties: z.array(z.string().max(5000)).max(100),
  })
  .superRefine((d, c) => {
    const ids = [...d.decisions, ...d.tasks].map((x) => x.id);
    if (new Set(ids).size !== ids.length)
      c.addIssue({
        code: 'custom',
        message: 'Identificadores de decisões e tarefas devem ser únicos.',
      });
  });
export type Draft = z.infer<typeof draftSchema>;
export type Agenda = z.infer<typeof agendaSchema>;
export const emptyDraft = (): Draft => ({
  summary: '',
  topics: [],
  decisions: [],
  tasks: [],
  uncertainties: [],
});
export const statusLabels: Record<string, string> = {
  planned: 'Planejada',
  review: 'Em revisão',
  finalized: 'Finalizada',
  awaiting_acceptance: 'Aguardando aceite',
  accepted: 'Aceita',
  changes_requested: 'Ajustes solicitados',
  open: 'Aberta',
  in_progress: 'Em andamento',
  done: 'Concluída',
  cancelled: 'Cancelada',
  pending: 'Pendente',
  sent: 'Enviado',
  failed: 'Falhou',
  queued: 'Na fila',
  running: 'Processando',
  completed: 'Concluído',
  test: 'Teste local',
  dispatch_failed: 'Envio à fila falhou',
};
export function acceptanceStatus(rows: { status: string }[]) {
  return rows.some((x) => x.status === 'changes_requested')
    ? 'changes_requested'
    : rows.length && rows.every((x) => x.status === 'accepted')
      ? 'accepted'
      : 'awaiting_acceptance';
}
export function validateDraftReferences(
  d: Draft,
  participants: { id: string }[],
) {
  const ids = new Set(participants.map((p) => p.id));
  return d.tasks.every((t) => t.assigneeId === null || ids.has(t.assigneeId));
}
export function preserveTaskStatus(
  previous: { id: string; status: string }[],
  next: Draft['tasks'],
) {
  return next.map((t) => ({
    ...t,
    status: previous.find((p) => p.id === t.id)?.status ?? 'open',
  }));
}
