'use client';
/* eslint-disable next/no-html-link-for-pages -- Source links preserve the organization context. */
import { useState } from 'react';
import { ArrowUpRight, Check, Sparkles } from 'lucide-react';
import type { AgendaProposal } from '@/lib/domain/planning';
import type { Agenda } from '@/lib/domain/model';
import { Btn } from './shared';
const categoryLabels = {
  objective: 'Objetivo',
  pending: 'Pendência',
  overdue: 'Tarefa vencida',
  recurring: 'Tema recorrente',
  context: 'Contexto',
};
export function ProposalEditor({
  proposal,
  orgId,
  onApply,
  disabled = false,
}: {
  proposal: AgendaProposal;
  orgId: string;
  onApply?: (items: Agenda, topic: string, objective: string) => void;
  disabled?: boolean;
}) {
  const [items, setItems] = useState(
    proposal.items.map((item) => ({ ...item, selected: false })),
  );
  const [useTopic, setUseTopic] = useState(false),
    [useObjective, setUseObjective] = useState(false);
  const [topic, setTopic] = useState(proposal.topic),
    [objective, setObjective] = useState(proposal.objective);
  const chosen = items.filter((item) => item.selected);
  return (
    <section className="proposal-panel">
      <div className="section-head">
        <div>
          <h3>
            <Sparkles size={17} /> Proposta de pauta
          </h3>
          <p className="muted">
            Sugestões para discussão. Nenhuma decisão ou tarefa será criada.
          </p>
        </div>
      </div>
      {proposal.mode === 'local' && (
        <p className="notice">
          Proposta local de teste, montada a partir dos registros. Nenhuma IA
          foi consultada.
        </p>
      )}
      {proposal.mode === 'objective' && (
        <p className="notice">
          Não encontrei histórico autorizado relevante. Este ponto de partida
          usa apenas o objetivo informado, sem consulta à IA.
        </p>
      )}
      {proposal.mode === 'ai' && proposal.sources.length === 0 && (
        <p className="notice">
          A consulta não encontrou fontes relevantes para sugerir continuidade.
          Revise o objetivo.
        </p>
      )}
      {proposal.limited && (
        <p className="notice">
          O histórico foi limitado a uma seleção de registros. Refine o objetivo
          ou o assunto para buscar outras fontes.
        </p>
      )}
      <p className="muted">
        Gerada em {new Date(proposal.createdAt).toLocaleString('pt-BR')}.
        Situações e prazos devem ser conferidos nas fontes.
      </p>
      {onApply && (
        <div className="proposal-fields">
          <label>
            <span className="proposal-choice">
              <input
                type="checkbox"
                checked={useObjective}
                onChange={(e) => setUseObjective(e.target.checked)}
              />
              Usar este objetivo
            </span>
            <textarea
              value={objective}
              maxLength={2000}
              onChange={(e) => setObjective(e.target.value)}
            />
          </label>
          <label>
            <span className="proposal-choice">
              <input
                type="checkbox"
                checked={useTopic}
                onChange={(e) => setUseTopic(e.target.checked)}
              />
              Usar este assunto
            </span>
            <input
              value={topic}
              maxLength={160}
              onChange={(e) => setTopic(e.target.value)}
            />
          </label>
        </div>
      )}
      <div className="proposal-items">
        {items.map((item, index) => (
          <article key={item.id} className="proposal-item">
            <label className="proposal-choice">
              {onApply && (
                <input
                  type="checkbox"
                  checked={item.selected}
                  disabled={disabled}
                  onChange={(e) =>
                    setItems(
                      items.map((x, i) =>
                        i === index ? { ...x, selected: e.target.checked } : x,
                      ),
                    )
                  }
                />
              )}
              <strong>{categoryLabels[item.category]}</strong>
            </label>
            {onApply ? (
              <input
                aria-label={'Sugestão ' + (index + 1)}
                value={item.title}
                maxLength={500}
                disabled={disabled}
                onChange={(e) =>
                  setItems(
                    items.map((x, i) =>
                      i === index ? { ...x, title: e.target.value } : x,
                    ),
                  )
                }
              />
            ) : (
              <p>{item.title}</p>
            )}
            <p className="muted">{item.reason}</p>
            {item.sourceIds.map((sid) => {
              const source = proposal.sources.find((s) => s.id === sid);
              return source ? (
                <details key={sid}>
                  <summary>
                    {source.title} · {source.state}
                  </summary>
                  <blockquote>{source.body}</blockquote>
                  <a className="text-link" href={source.href}>
                    Consultar registro <ArrowUpRight size={14} />
                  </a>
                </details>
              ) : null;
            })}
          </article>
        ))}
      </div>
      {onApply ? (
        <Btn
          type="button"
          disabled={
            disabled ||
            (!chosen.length && !useTopic && !useObjective) ||
            chosen.some((x) => !x.title.trim()) ||
            (useObjective && !objective.trim())
          }
          onClick={() =>
            onApply(
              chosen.map((item) => ({
                id: crypto.randomUUID(),
                title: item.title,
                taskId: item.taskId,
                origin: { proposalId: proposal.id, itemId: item.id },
              })),
              useTopic ? topic : '',
              useObjective ? objective : '',
            )
          }
        >
          <Check size={17} />
          Incorporar seleção ao formulário
        </Btn>
      ) : (
        <a
          className="primary"
          href={'/reunioes/nova?org=' + orgId + '&proposal=' + proposal.id}
        >
          Confirmar dados de uma nova reunião <ArrowUpRight size={17} />
        </a>
      )}
      {onApply && (
        <p className="muted">
          Depois de incorporar, revise a ordem e salve a preparação para
          confirmar.
        </p>
      )}
    </section>
  );
}
