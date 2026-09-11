'use client';
/* eslint-disable next/no-html-link-for-pages -- Source links preserve the authorized organization context. */
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ArrowUpRight,
  MessageSquare,
  Plus,
  Presentation,
} from 'lucide-react';
import { api, send, Btn, ErrorNotice, useAction } from './shared';
import type { Common } from './workspace';
import { ProposalEditor } from './planning';
import {
  answerLabels,
  type Answer,
  type MemoryFilters,
  type Source,
} from '@/lib/domain/memory';

type Turn = {
  id: string;
  question: string;
  filters: MemoryFilters | null;
  state: string;
  answer: Answer | null;
  createdAt: string;
};
type Chat = { id: string; title: string; created_at: string };
const kinds = {
  minutes: 'Ata',
  task: 'Tarefa',
  decision: 'Decisão',
  draft: 'Rascunho',
  organization: 'Empresa',
  knowledge: 'Conhecimento da empresa',
  participant: 'Perfil do participante',
};

function SourceCard({ source, quote }: { source: Source; quote?: string }) {
  return (
    <article className="memory-source">
      <div className="memory-source-meta">
        <strong>{kinds[source.kind]}</strong>
        <span>{source.state}</span>
      </div>
      <p className="memory-quote">{quote || source.body}</p>
      <a className="text-link" href={source.href}>
        {source.title}
        {source.date
          ? ' · ' + new Date(source.date).toLocaleDateString('pt-BR')
          : ''}
        <ArrowUpRight size={15} />
      </a>
    </article>
  );
}

function PresentationAction({
  action,
  orgId,
}: {
  action: NonNullable<Answer['action']>;
  orgId: string;
}) {
  const href = action.meetingId
    ? `/reunioes/${action.meetingId}?org=${orgId}&tab=preparacao`
    : action.proposalId
      ? `/reunioes/nova?org=${orgId}&proposal=${action.proposalId}`
      : `/reunioes?org=${orgId}`;
  return (
    <div className="memory-action-card">
      <div>
        <strong>
          <Presentation size={17} /> Preparar apresentação
        </strong>
        <p>{action.reason}</p>
      </div>
      <a className="primary" href={href}>
        {action.meetingId
          ? 'Abrir preparação'
          : action.proposalId
            ? 'Salvar pauta na reunião'
            : 'Escolher reunião'}
        <ArrowUpRight size={15} />
      </a>
    </div>
  );
}

export function Memory({ orgId }: Common) {
  const [query, setQuery] = useState('');
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatId, setChatId] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(true);
  const [moreChats, setMoreChats] = useState(false);
  const [moreTurns, setMoreTurns] = useState(false);
  const [outgoing, setOutgoing] = useState<Turn | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const messages = useRef<HTMLElement>(null);
  const sending = useRef(false);
  const scrollToEnd = useRef(true);
  const a = useAction();
  const setError = a.setError;

  useEffect(() => {
    if (scrollToEnd.current && messages.current) {
      messages.current.scrollTop = messages.current.scrollHeight;
    }
  }, [turns, outgoing]);

  useEffect(() => {
    api<Chat[]>('memory/chats', {}, orgId)
      .then((data) => {
        setChats(data);
        setMoreChats(data.length === 100);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [orgId, setError]);

  async function openChat(cid: string, before?: string) {
    await a.act(async () => {
      const data = await api<{ turns: Turn[]; hasMore: boolean }>(
        'memory/chats/' + cid + (before ? '?before=' + before : ''),
        {},
        orgId,
      );
      setChatId(cid);
      setOutgoing(null);
      scrollToEnd.current = !before;
      setTurns((previous) =>
        before ? [...data.turns, ...previous] : data.turns,
      );
      setMoreTurns(data.hasMore);
    });
  }

  async function ask(
    question = query,
    requestId = crypto.randomUUID(),
    retryFilters?: MemoryFilters | null,
  ) {
    question = question.trim();
    if (!question || sending.current || a.busy) return;
    sending.current = true;
    scrollToEnd.current = true;
    setOutgoing({
      id: requestId,
      question,
      filters: retryFilters || null,
      state: 'pending',
      answer: null,
      createdAt: new Date().toISOString(),
    });
    setQuery('');
    await a.act(async () => {
      let cid = chatId;
      try {
        if (!cid) {
          cid = (await send('memory/chats', {}, orgId)).id;
          setChatId(cid);
          setChats(await api<Chat[]>('memory/chats', {}, orgId));
        }
        const data = await send(
          'memory/chats/' + cid + '/messages',
          {
            question,
            requestId,
            ...(retryFilters ? { filters: retryFilters } : {}),
          },
          orgId,
        );
        setTurns(data.turns);
        setMoreTurns(data.hasMore);
        setOutgoing(null);
      } catch (error) {
        setOutgoing((previous) =>
          previous ? { ...previous, state: 'failed' } : null,
        );
        if (cid) {
          const data = await api<{ turns: Turn[]; hasMore: boolean }>(
            'memory/chats/' + cid,
            {},
            orgId,
          ).catch(() => null);
          if (data) {
            setTurns(data.turns);
            setMoreTurns(data.hasMore);
            if (data.turns.some((turn) => turn.id === requestId))
              setOutgoing(null);
          }
        }
        throw error;
      }
    });
    sending.current = false;
    composer.current?.focus();
  }

  return (
    <>
      <div className="page-title memory-title">
        <div>
          <h1>Assistente de reuniões</h1>
        </div>
      </div>
      <div className="memory-layout">
        <aside className="panel memory-conversations">
          <div className="section-head">
            <h2>Suas conversas</h2>
            <Btn
              secondary
              disabled={a.busy}
              aria-label="Nova conversa"
              onClick={() => {
                setChatId('');
                setTurns([]);
                setMoreTurns(false);
                setQuery('');
                setOutgoing(null);
                setError('');
                composer.current?.focus();
              }}
            >
              <Plus size={17} />
              Nova conversa
            </Btn>
          </div>
          <p className="muted">Visíveis somente para você nesta empresa.</p>
          {loading ? (
            <output>Carregando conversas…</output>
          ) : chats.length === 0 ? (
            <p className="muted">Sua primeira pergunta inicia uma conversa.</p>
          ) : (
            chats.map((chat) => (
              <button
                className={
                  'memory-chat-link ' + (chat.id === chatId ? 'selected' : '')
                }
                key={chat.id}
                disabled={a.busy}
                onClick={() => openChat(chat.id)}
              >
                <MessageSquare size={17} />
                <span>
                  Conversa
                  <small>
                    {new Date(chat.created_at).toLocaleString('pt-BR')}
                  </small>
                </span>
              </button>
            ))
          )}
          {moreChats && (
            <Btn
              secondary
              disabled={a.busy}
              onClick={() =>
                a.act(async () => {
                  const data = await api<Chat[]>(
                    'memory/chats?before=' + chats.at(-1)!.id,
                    {},
                    orgId,
                  );
                  setChats((previous) => [...previous, ...data]);
                  setMoreChats(data.length === 100);
                })
              }
            >
              Conversas anteriores
            </Btn>
          )}
        </aside>
        <div className="memory-main">
          <section
            className="memory-messages"
            ref={messages}
            onScroll={(event) => {
              const el = event.currentTarget;
              scrollToEnd.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 100;
            }}
            aria-label="Conversa persistida"
            aria-live="polite"
          >
            <div className="section-head">
              <h2>Conversa</h2>
              {chatId && (
                <Btn
                  secondary
                  disabled={a.busy}
                  onClick={() => openChat(chatId)}
                >
                  Atualizar
                </Btn>
              )}
            </div>
            {!turns.length && !outgoing && (
              <div className="memory-examples">
                <h2>O que vamos preparar hoje?</h2>
                <p className="muted">
                  Pergunte, retome uma pendência ou planeje sua próxima reunião.
                </p>
                {[
                  'O que ficou pendente da última reunião?',
                  'Quais decisões foram tomadas sobre este assunto?',
                  'Quem ficou responsável por esta tarefa?',
                  'Quais assuntos deveriam entrar na próxima reunião?',
                  'Resuma tudo que já foi discutido sobre este projeto.',
                  'Crie uma pauta para a reunião comercial da próxima semana',
                  'Gere uma apresentação para essa pauta.',
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => {
                      setQuery(q);
                      composer.current?.focus();
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            {moreTurns && (
              <Btn
                secondary
                disabled={a.busy}
                onClick={() => openChat(chatId, turns[0].id)}
              >
                Mensagens anteriores
              </Btn>
            )}
            {[
              ...turns,
              ...(outgoing && !turns.some((turn) => turn.id === outgoing.id)
                ? [outgoing]
                : []),
            ].map((t) => (
              <article key={t.id} className="memory-turn">
                <div className="memory-user">
                  <strong>Você</strong>
                  <p>{t.question}</p>
                  <small>{new Date(t.createdAt).toLocaleString('pt-BR')}</small>
                </div>
                {t.state === 'restricted' ? (
                  <p className="notice">
                    O acesso às fontes desta resposta mudou. O conteúdo foi
                    ocultado.
                  </p>
                ) : t.answer?.proposal ? (
                  <ProposalEditor
                    key={t.answer.proposal.id}
                    proposal={t.answer.proposal}
                    orgId={orgId}
                  />
                ) : t.answer ? (
                  <div className="memory-answer">
                    <h3>Anota Aí</h3>
                    {(!t.answer.summary || t.answer.outcome !== 'evidence') && (
                      <p>{answerLabels[t.answer.outcome]}</p>
                    )}
                    {t.answer.summary && (
                      <p className="memory-summary">{t.answer.summary}</p>
                    )}
                    {t.answer.mode === 'local' && (
                      <p className="notice">
                        Consulta local de teste: a resposta foi montada sem
                        chamar uma IA.
                      </p>
                    )}
                    {t.answer.limited && (
                      <p className="notice">
                        O histórico usado foi limitado a uma seleção autorizada.
                      </p>
                    )}
                    {t.answer.action && (
                      <PresentationAction
                        action={t.answer.action}
                        orgId={orgId}
                      />
                    )}
                    {(t.answer.citations || t.answer.excerpts).length > 0 && (
                      <details className="memory-references">
                        <summary>
                          Ver fontes e trechos (
                          {(t.answer.citations || t.answer.excerpts).length})
                        </summary>
                        <p className="muted">
                          Situações e aceites podem ter mudado desde esta
                          resposta.
                        </p>
                        {(t.answer.citations || t.answer.excerpts).map(
                          (excerpt, i) => {
                            const source = t.answer!.sources.find(
                              (s) => s.id === excerpt.sourceId,
                            );
                            return source ? (
                              <SourceCard
                                key={i}
                                source={source}
                                quote={excerpt.quote}
                              />
                            ) : null;
                          },
                        )}
                      </details>
                    )}
                  </div>
                ) : (
                  <div className="memory-answer">
                    <output>
                      {a.busy && outgoing?.id === t.id
                        ? 'Preparando resposta…'
                        : t.state === 'failed'
                          ? 'Não foi possível responder. A pergunta foi preservada.'
                          : 'Resposta em processamento. Atualize a conversa; se a solicitação foi interrompida, tente novamente após dois minutos.'}
                    </output>
                    {!(a.busy && outgoing?.id === t.id) && (
                      <Btn
                        secondary
                        disabled={a.busy}
                        onClick={() => ask(t.question, t.id, t.filters)}
                      >
                        Tentar novamente
                      </Btn>
                    )}
                  </div>
                )}
              </article>
            ))}
          </section>
          <div className="memory-chat-composer">
            <ErrorNotice message={a.error} />
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void ask();
              }}
            >
              <textarea
                ref={composer}
                aria-label="Mensagem para o assistente"
                rows={2}
                maxLength={2000}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void ask();
                  }
                }}
                placeholder="Pergunte ou peça ajuda para preparar uma reunião…"
              />
              <Btn
                type="submit"
                busy={a.busy}
                disabled={!query.trim()}
                aria-label="Enviar mensagem"
              >
                <ArrowUp size={20} />
              </Btn>
            </form>
            <p className="muted memory-footnote">
              Enter para enviar · Shift+Enter para nova linha. Confira as fontes
              das respostas.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
