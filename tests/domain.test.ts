import { describe, it, expect } from 'vitest';
import {
  draftSchema,
  emptyDraft,
  validateDraftReferences,
  acceptanceStatus,
  preserveTaskStatus,
  meetingSchema,
} from '../lib/domain/model';
describe('Ata estruturada', () => {
  it('aceita responsável e prazo não mencionados como null', () => {
    const d = {
      ...emptyDraft(),
      summary: 'Discussão comercial',
      tasks: [
        {
          id: 't1',
          description: 'Rever proposta',
          evidence: 'Rever proposta',
          assigneeId: null,
          dueDate: null,
        },
      ],
    };
    expect(draftSchema.parse(d).tasks[0].dueDate).toBeNull();
    expect(validateDraftReferences(d, [])).toBe(true);
  });
  it('rejeita responsável de fora da reunião', () => {
    expect(
      validateDraftReferences(
        {
          ...emptyDraft(),
          tasks: [
            {
              id: 't1',
              description: 'Ação',
              evidence: '',
              assigneeId: 'outra-pessoa',
              dueDate: null,
            },
          ],
        },
        [{ id: 'participante' }],
      ),
    ).toBe(false);
  });
  it('rejeita datas inexistentes e IDs duplicados', () => {
    expect(
      draftSchema.safeParse({
        ...emptyDraft(),
        tasks: [
          {
            id: 't1',
            description: 'Ação',
            evidence: '',
            assigneeId: null,
            dueDate: '2026-02-30',
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      draftSchema.safeParse({
        ...emptyDraft(),
        decisions: [
          { id: 'same', description: 'Uma decisão', evidence: '' },
          { id: 'same', description: 'Outra decisão', evidence: '' },
        ],
      }).success,
    ).toBe(false);
  });
  it('mantém andamento da tarefa quando muda a descrição', () => {
    const next = [
      {
        id: 't1',
        description: 'Descrição corrigida',
        evidence: '',
        assigneeId: null,
        dueDate: null,
      },
    ];
    expect(
      preserveTaskStatus([{ id: 't1', status: 'done' }], next)[0].status,
    ).toBe('done');
  });
});
describe('Aceite e preparação', () => {
  it('exige todos os aceites e prioriza solicitação de ajustes', () => {
    expect(acceptanceStatus([])).toBe('awaiting_acceptance');
    expect(
      acceptanceStatus([{ status: 'accepted' }, { status: 'pending' }]),
    ).toBe('awaiting_acceptance');
    expect(
      acceptanceStatus([{ status: 'accepted' }, { status: 'accepted' }]),
    ).toBe('accepted');
    expect(
      acceptanceStatus([
        { status: 'accepted' },
        { status: 'changes_requested' },
      ]),
    ).toBe('changes_requested');
  });
  it('exige título, data com fuso e duração válida', () => {
    expect(
      meetingSchema.safeParse({
        title: '',
        scheduledAt: '2026-09-05T10:00',
        duration: 0,
        agenda: [],
        participantIds: [],
      }).success,
    ).toBe(false);
  });
});
