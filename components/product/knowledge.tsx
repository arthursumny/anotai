'use client';
/* eslint-disable next/no-html-link-for-pages -- Full navigation preserves organization selection and unsaved-change prompts. */
import { useEffect, useState } from 'react';
import { api, send, Btn, ErrorNotice, useAction } from './shared';
type Document = {
  id: string;
  title: string;
  category: string;
  date: string;
  content: string;
  state: string;
  revision: number;
  filename: string | null;
};
const categories = {
  minutes: 'Ata anterior',
  team: 'Equipe e responsabilidades',
  project: 'Projeto',
  process: 'Processo',
  business: 'Negócio',
};
export function CompanyKnowledge({
  orgId,
  admin,
  legacyBusiness,
}: {
  orgId: string;
  admin: boolean;
  legacyBusiness?: string;
}) {
  const [documents, setDocuments] = useState<Document[]>([]),
    [selected, setSelected] = useState<Document | null>(null),
    [reviewed, setReviewed] = useState(false);
  const a = useAction(),
    setError = a.setError;
  async function load() {
    setDocuments(await api<Document[]>('knowledge', {}, orgId));
  }
  useEffect(() => {
    api<Document[]>('knowledge', {}, orgId)
      .then(setDocuments)
      .catch((e) => setError(e.message));
  }, [orgId, setError]);
  return (
    <section className="panel section-gap knowledge-panel">
      <h2>Conhecimento da empresa</h2>
      <p className="muted">
        Atas anteriores, projetos e processos ajudam o assistente a preparar
        reuniões. Somente conteúdo revisado entra nas consultas.
      </p>
      <p className="muted">
        Setores e responsabilidades são cadastrados em{' '}
        <a className="text-link" href="/pessoas">
          Equipe e participantes
        </a>
        .
      </p>
      {legacyBusiness && (
        <details>
          <summary>Informações da empresa cadastradas anteriormente</summary>
          <p className="knowledge-text">{legacyBusiness}</p>
        </details>
      )}
      <ErrorNotice message={a.error} />
      {admin && (
        <details>
          <summary>Adicionar documento ou informação</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const body = new FormData(form);
              void a.act(async () => {
                await api('knowledge', { method: 'POST', body }, orgId);
                form.reset();
                await load();
              }, 'Importado para revisão. Abra o registro abaixo antes de disponibilizar à IA.');
            }}
          >
            <label>
              Título
              <input name="title" required minLength={2} maxLength={200} />
            </label>
            <label>
              Tipo
              <select name="category">
                {Object.entries(categories)
                  .filter(([value]) => value !== 'team')
                  .map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Data de referência
              <input name="date" type="date" />
            </label>
            <label>
              Anexar documento
              <input name="file" type="file" accept=".pdf,.txt,.md" />
            </label>
            <p className="muted">
              PDF com texto, TXT ou Markdown · até 5 MB e 100 páginas. Para
              outros formatos ou documentos digitalizados, cole o texto.
            </p>
            <label>
              Ou escrever o conteúdo
              <textarea
                name="content"
                rows={6}
                maxLength={100000}
                placeholder="Descreva o projeto, processo ou informação relevante sobre a empresa."
              />
            </label>
            <Btn busy={a.busy}>Salvar para revisão</Btn>
          </form>
        </details>
      )}
      {a.notice && <output className="notice">{a.notice}</output>}
      {!documents.length && (
        <p className="muted">Nenhum conhecimento cadastrado.</p>
      )}
      {documents.map((d) => (
        <article key={d.id} id={'knowledge-' + d.id} className="knowledge-row">
          <strong>{d.title}</strong>
          <p className="muted">
            {categories[d.category as keyof typeof categories]} ·{' '}
            {d.state === 'confirmed'
              ? 'Revisado e disponível à empresa'
              : d.state === 'archived'
                ? 'Arquivado'
                : 'Aguardando revisão'}
            {d.date ? ' · ' + d.date : ''}
          </p>
          <Btn
            secondary
            onClick={() => {
              setSelected(d);
              setReviewed(false);
            }}
          >
            {admin ? 'Abrir e revisar' : 'Ler conteúdo'}
          </Btn>
          {d.filename && (
            <a
              className="text-link"
              href={`/api/knowledge/${d.id}?org=${orgId}`}
              target="_blank"
              rel="noreferrer"
            >
              Baixar original
            </a>
          )}
          {!admin && (
            <details>
              <summary>Conteúdo da fonte</summary>
              <p className="knowledge-text">{d.content}</p>
            </details>
          )}
        </article>
      ))}
      {selected && (
        <form
          className="proposal-panel"
          onSubmit={(event) => {
            event.preventDefault();
            void a.act(async () => {
              await send(
                'knowledge/' + selected.id,
                { ...selected, reviewed },
                orgId,
                'PATCH',
              );
              setSelected(null);
              setReviewed(false);
              await load();
            }, 'Conhecimento atualizado.');
          }}
        >
          <h3>{admin ? 'Revisar conhecimento' : 'Conhecimento revisado'}</h3>
          <label>
            Título
            <input
              value={selected.title}
              disabled={!admin}
              required
              onChange={(e) => {
                setSelected({ ...selected, title: e.target.value });
                setReviewed(false);
              }}
            />
          </label>
          <label>
            Conteúdo
            <textarea
              rows={12}
              maxLength={100000}
              value={selected.content}
              readOnly={!admin}
              onChange={(e) => {
                setSelected({ ...selected, content: e.target.value });
                setReviewed(false);
              }}
            />
          </label>
          {admin && (
            <>
              <label>
                Disponibilidade
                <select
                  value={selected.state}
                  onChange={(e) => {
                    setSelected({ ...selected, state: e.target.value });
                    setReviewed(false);
                  }}
                >
                  <option value="draft">
                    Rascunho — somente administradores
                  </option>
                  <option value="confirmed">Disponível à empresa e à IA</option>
                  <option value="archived">
                    Arquivado — fora das consultas
                  </option>
                </select>
              </label>
              {selected.state === 'confirmed' && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  Revisei o texto e autorizo o acesso de todos os membros desta
                  empresa. Este documento não cria tarefas nem registra aceite.
                </label>
              )}
              <Btn
                busy={a.busy}
                disabled={selected.state === 'confirmed' && !reviewed}
              >
                Salvar revisão
              </Btn>
            </>
          )}
          <Btn secondary type="button" onClick={() => setSelected(null)}>
            Fechar
          </Btn>
        </form>
      )}
    </section>
  );
}
