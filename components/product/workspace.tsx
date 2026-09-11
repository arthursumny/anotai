'use client';
import { CompanyKnowledge } from './knowledge';
/* eslint-disable next/no-html-link-for-pages -- Full document navigation resets organization/session state and preserves unsaved-change prompts. */
import { useEffect, useState, useCallback } from 'react';
import {
  LayoutDashboard,
  CalendarDays,
  CheckCheck,
  Users,
  Building2,
  Layers3,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Clock3,
  FileCheck2,
  CircleAlert,
  LogOut,
  Menu,
  Search,
} from 'lucide-react';
import { Access } from './access';
import { Memory } from './memory';
import {
  api,
  send,
  Row,
  Btn,
  Badge,
  Empty,
  ErrorNotice,
  dateOnly,
  initials,
  useAction,
} from './shared';
import { MeetingForm, MeetingDetail, PrintView, Acceptance } from './meeting';
export function Workspace({ path = '/' }: { path?: string }) {
  const [session, setSession] = useState<Row | null>(null),
    [orgId, setOrgId] = useState(''),
    [error, setError] = useState(''),
    [menu, setMenu] = useState(false);
  useEffect(() => {
    api('me')
      .then((s) => {
        setSession(s);
        const saved =
          new URLSearchParams(window.location.search).get('org') ||
          sessionStorage.getItem('anota-organization');
        const selected =
          s.organizations.find((o: Row) => o.id === saved)?.id ||
          s.organizations[0]?.id ||
          '';
        if (selected) sessionStorage.setItem('anota-organization', selected);
        setOrgId(selected);
      })
      .catch((e) => setError(e.message));
  }, []);
  if (path === '/entrar') return <Verify />;
  if (path === '/aceite') return <Acceptance />;
  if (error)
    return (
      <main className="standalone">
        <ErrorNotice message={error} />
        <a href="/">Tentar novamente</a>
      </main>
    );
  if (!session)
    return (
      <div className="loading-page">
        <Layers3 size={30} />
        <p>Preparando seu espaço…</p>
      </div>
    );
  if (!session.user)
    return (
      <Access ready={session.integrations.test || session.integrations.email} />
    );
  if (!orgId) return <Onboarding user={session.user} />;
  const org = session.organizations.find((o: Row) => o.id === orgId);
  const c = {
    orgId,
    org,
    user: session.user,
    integrations: session.integrations,
  };
  if (path.startsWith('/imprimir/'))
    return <PrintView {...c} meetingId={path.split('/')[2]} />;
  const nav = [
    { href: '/', label: 'Visão geral', icon: LayoutDashboard },
    { href: '/reunioes', label: 'Reuniões', icon: CalendarDays },
    { href: '/pendencias', label: 'Pendências e decisões', icon: CheckCheck },
    { href: '/memoria', label: 'Assistente de reuniões', icon: Search },
    { href: '/pessoas', label: 'Equipe e participantes', icon: Users },
    { href: '/organizacao', label: 'Organização', icon: Building2 },
  ];
  const active = nav.find((n) =>
    n.href === '/' ? path === '/' : path.startsWith(n.href),
  );
  return (
    <div className={'workspace ' + (menu ? 'menu-open' : '')}>
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-icon">
            <Layers3 size={22} />
          </span>
          Anota Aí<span className="brand-dot">.</span>
        </a>
        <div className="org-switch">
          <span className="org-avatar">{initials(org.name)}</span>
          <div>
            <span className="micro">ESPAÇO DE TRABALHO</span>
            <select
              aria-label="Organização ativa"
              value={orgId}
              onChange={(e) => {
                sessionStorage.setItem('anota-organization', e.target.value);
                window.location.href = '/';
              }}
            >
              {session.organizations.map((o: Row) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <span className="nav-caption">GERENCIAR</span>
        <nav>
          {nav.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className={active?.href === n.href ? 'active' : ''}
            >
              <n.icon size={19} />
              {n.label}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="continuity">
            <span className="brand-icon small">
              <Layers3 size={16} />
            </span>
            <strong>Cada reunião conta.</strong>
            <p>
              Decisões registradas hoje.
              <br />
              Clareza para o próximo passo.
            </p>
          </div>
          <div className="user-block">
            <span className="avatar">{initials(session.user.name)}</span>
            <div>
              <strong>{session.user.name}</strong>
              <span>{org.role === 'admin' ? 'Administrador' : 'Membro'}</span>
            </div>
            <button
              className="icon-btn"
              aria-label="Sair"
              onClick={async () => {
                await send('auth/logout', {});
                window.location.href = '/';
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <button
            className="icon-btn mobile-menu"
            aria-label="Abrir menu"
            onClick={() => setMenu(!menu)}
          >
            <Menu size={22} />
          </button>
          <div className="breadcrumbs">
            Espaço de trabalho<span>/</span>
            <strong>{active?.label || 'Reunião'}</strong>
          </div>
          <span className="topbar-date">
            {new Date().toLocaleDateString('pt-BR', {
              day: 'numeric',
              month: 'long',
              timeZone: org.timezone,
            })}
          </span>
          <span className="avatar small">{initials(session.user.name)}</span>
        </header>
        {session.integrations.test && (
          <div className="environment-bar">
            Ambiente local de teste · IA e e-mails externos desativados
          </div>
        )}
        <main className="content" key={orgId}>
          {path === '/' ? (
            <Dashboard {...c} />
          ) : path === '/reunioes' ? (
            <MeetingList {...c} />
          ) : path === '/reunioes/nova' ? (
            <MeetingForm {...c} />
          ) : path.startsWith('/reunioes/') ? (
            <MeetingDetail {...c} meetingId={path.split('/')[2]} />
          ) : path === '/pendencias' ? (
            <Work {...c} />
          ) : path === '/memoria' ? (
            <Memory {...c} />
          ) : path === '/pessoas' ? (
            <People {...c} />
          ) : path === '/organizacao' ? (
            <Organization {...c} />
          ) : (
            <Empty
              title="Página não encontrada"
              description="Volte para seu espaço de trabalho."
              href="/"
              action="Voltar ao início"
            />
          )}
        </main>
      </div>
    </div>
  );
}
export type Common = { orgId: string; org: Row; user: Row; integrations: Row };
function Verify() {
  const action = useAction();
  return (
    <main className="standalone">
      <a className="brand" href="/">
        <span className="brand-icon">
          <Layers3 />
        </span>
        Anota Aí
      </a>
      <div className="panel">
        <h1>Confirme seu acesso</h1>
        <p className="muted">Este link pode ser utilizado uma única vez.</p>
        <ErrorNotice message={action.error} />
        <Btn
          busy={action.busy}
          onClick={() =>
            action.act(async () => {
              const result = await send('auth/verify', {
                token: new URLSearchParams(window.location.search).get('token'),
              });
              window.location.href = result.orgId
                ? '/?org=' + encodeURIComponent(result.orgId)
                : '/';
            })
          }
        >
          Entrar no meu espaço <ArrowRight size={18} />
        </Btn>
        <a className="text-link" href="/">
          Solicitar outro link
        </a>
      </div>
    </main>
  );
}
function Onboarding({ user }: { user: Row }) {
  const [name, setName] = useState('');
  const a = useAction();
  return (
    <main className="standalone">
      <a className="brand" href="/">
        <span className="brand-icon">
          <Layers3 />
        </span>
        Anota Aí
      </a>
      <div className="panel">
        <span className="eyebrow">CONTA CONFIRMADA · CADASTRE SUA EMPRESA</span>
        <h1>Cadastre sua empresa</h1>
        <p className="muted">
          Olá, {user.name.split(' ')[0]}. Você será o administrador e poderá
          adicionar membros internos e participantes externos.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void a.act(async () => {
              await send('organizations', {
                name,
                timezone: 'America/Sao_Paulo',
              });
              window.location.href = '/pessoas';
            });
          }}
        >
          <label>
            Nome da empresa
            <input
              required
              minLength={2}
              maxLength={150}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Horizonte Consultoria"
            />
          </label>
          <p className="muted">
            Foi convidado para uma empresa? Use o mesmo e-mail do convite para
            entrar. Não crie outro espaço.
          </p>
          <ErrorNotice message={a.error} />
          <Btn type="submit" busy={a.busy}>
            Criar empresa <ArrowRight size={18} />
          </Btn>
        </form>
        <button
          className="text-link"
          onClick={async () => {
            await send('auth/logout', {});
            window.location.href = '/';
          }}
        >
          Sair e entrar com outro e-mail
        </button>
      </div>
    </main>
  );
}
function PageTitle({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {children}
    </div>
  );
}
export function MeetingRows({ rows, tz }: { rows: Row[]; tz: string }) {
  return (
    <div className="meeting-rows">
      {rows.map((m) => (
        <a href={'/reunioes/' + m.id} className="meeting-row" key={m.id}>
          <div className="date-tile">
            <span>
              {new Date(m.scheduled_at)
                .toLocaleDateString('pt-BR', { timeZone: tz, month: 'short' })
                .replace('.', '')}
            </span>
            <strong>
              {new Date(m.scheduled_at).toLocaleDateString('pt-BR', {
                timeZone: tz,
                day: '2-digit',
              })}
            </strong>
          </div>
          <div className="meeting-row-main">
            <h3>{m.title}</h3>
            <p>
              <Clock3 size={13} />
              {new Date(m.scheduled_at).toLocaleTimeString('pt-BR', {
                timeZone: tz,
                hour: '2-digit',
                minute: '2-digit',
              })}
              <span>·</span>
              {m.duration} min
              {m.topic && (
                <>
                  <span>·</span>
                  {m.topic}
                </>
              )}
            </p>
          </div>
          <Badge status={m.status} />
          <ArrowUpRight className="row-arrow" size={19} />
        </a>
      ))}
    </div>
  );
}
function Dashboard(c: Common) {
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([api<Row[]>('meetings', {}, c.orgId), api('work', {}, c.orgId)])
      .then(([meetings, work]) => setData({ meetings, ...work }))
      .catch((e) => setError(e.message));
  }, [c.orgId]);
  if (!data) return <ErrorNotice message={error} />;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: c.org.timezone,
  }).format(new Date());
  const upcoming = data.meetings
    .filter((m: Row) => m.scheduled_at >= new Date().toISOString())
    .sort((a: Row, b: Row) => a.scheduled_at.localeCompare(b.scheduled_at));
  const late = data.tasks.filter(
    (t: Row) =>
      t.due_date &&
      t.due_date < today &&
      !['done', 'cancelled'].includes(t.status),
  );
  const review = data.meetings.filter((m: Row) =>
    ['review', 'changes_requested'].includes(m.status),
  );
  const open = data.tasks.filter(
    (t: Row) => !['done', 'cancelled'].includes(t.status),
  );
  return (
    <>
      <PageTitle
        eyebrow="SEU PANORAMA"
        title={`Olá, ${c.user.name.split(' ')[0]}.`}
        description="Tudo o que foi combinado, e o que vem a seguir."
      >
        <a className="primary" href="/reunioes/nova">
          <Plus size={18} />
          Nova reunião
        </a>
      </PageTitle>
      <div className="metrics">
        {[
          {
            label: 'Próximas reuniões',
            value: upcoming.length,
            icon: CalendarDays,
            description: 'Na sua agenda',
            href: '/reunioes',
            color: 'blue',
          },
          {
            label: 'Atas para revisar',
            value: review.length,
            icon: FileCheck2,
            description: 'Precisam da sua atenção',
            href: '/reunioes',
            color: 'violet',
          },
          {
            label: 'Pendências em aberto',
            value: open.length,
            icon: CheckCheck,
            description: 'Próximos passos registrados',
            href: '/pendencias',
            color: 'teal',
          },
          {
            label: 'Tarefas vencidas',
            value: late.length,
            icon: CircleAlert,
            description: late.length
              ? 'Hora de retomar o assunto'
              : 'Tudo dentro do prazo',
            href: '/pendencias',
            color: 'amber',
          },
        ].map((s) => (
          <a className="metric" key={s.label} href={s.href}>
            <div className="metric-label">
              {s.label}
              <span className={'metric-icon ' + s.color}>
                <s.icon size={19} />
              </span>
            </div>
            <strong>{s.value.toString().padStart(2, '0')}</strong>
            <span>{s.description}</span>
          </a>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">PLANEJAMENTO</span>
              <h2>Próximas reuniões</h2>
            </div>
            <a className="text-link" href="/reunioes">
              Ver todas <ArrowRight size={15} />
            </a>
          </div>
          {upcoming.length ? (
            <MeetingRows rows={upcoming.slice(0, 4)} tz={c.org.timezone} />
          ) : (
            <Empty
              title="Abra espaço para a próxima conversa"
              description="Defina o objetivo, organize a pauta e reúna as pessoas certas."
              href="/reunioes/nova"
            />
          )}
        </section>
        <section className="panel attention-panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">CONTINUIDADE</span>
              <h2>Precisa de atenção</h2>
            </div>
            <span className="count">{late.length + review.length}</span>
          </div>
          {!late.length && !review.length ? (
            <div className="calm-state">
              <CheckCheck size={30} />
              <h3>Espaço para seguir em frente</h3>
              <p>Atas para revisar e pendências vencidas aparecerão aqui.</p>
            </div>
          ) : (
            <div className="attention-list">
              {review.slice(0, 3).map((m: Row) => (
                <a href={'/reunioes/' + m.id + '?tab=ata'} key={m.id}>
                  <span className="attention-dot violet" />
                  <div>
                    <h3>{m.title}</h3>
                    <p>Ata aguardando revisão</p>
                  </div>
                  <ArrowUpRight size={16} />
                </a>
              ))}
              {late.slice(0, 3).map((t: Row) => (
                <a href={'/reunioes/' + t.meeting_id + '?tab=acoes'} key={t.id}>
                  <span className="attention-dot amber" />
                  <div>
                    <h3>{t.description}</h3>
                    <p>Prazo: {dateOnly(t.due_date)}</p>
                  </div>
                  <ArrowUpRight size={16} />
                </a>
              ))}
            </div>
          )}
        </section>
      </div>
      <section className="panel recent-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">MEMÓRIA DA EMPRESA</span>
            <h2>Reuniões recentes</h2>
          </div>
          <a className="text-link" href="/pendencias">
            Consultar decisões <ArrowRight size={15} />
          </a>
        </div>
        {data.meetings.length ? (
          <MeetingRows rows={data.meetings.slice(0, 3)} tz={c.org.timezone} />
        ) : (
          <div className="quiet-empty">
            As reuniões e suas decisões passam a fazer parte da memória da
            empresa a partir daqui.
          </div>
        )}
      </section>
    </>
  );
}
function MeetingList(c: Common) {
  const [rows, setRows] = useState<Row[]>([]),
    [loaded, setLoaded] = useState(false),
    [q, setQ] = useState(''),
    [status, setStatus] = useState(''),
    [from, setFrom] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    api<Row[]>('meetings', {}, c.orgId)
      .then((d) => {
        setRows(d);
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, [c.orgId]);
  const filtered = rows.filter(
    (m) =>
      (m.title + ' ' + m.topic).toLowerCase().includes(q.toLowerCase()) &&
      (!status || m.status === status) &&
      (!from || m.scheduled_at >= from),
  );
  return (
    <>
      <PageTitle
        title="Reuniões"
        description="Prepare conversas melhores. Mantenha cada decisão por perto."
      >
        <a className="primary" href="/reunioes/nova">
          <Plus size={18} />
          Nova reunião
        </a>
      </PageTitle>
      <ErrorNotice message={error} />
      <section className="panel">
        <div className="filters">
          <div className="search-field">
            <Search size={18} />
            <input
              aria-label="Buscar reuniões"
              placeholder="Buscar por reunião ou assunto…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select
            aria-label="Filtrar situação"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Todas as situações</option>
            {[
              'planned',
              'review',
              'finalized',
              'awaiting_acceptance',
              'accepted',
              'changes_requested',
            ].map((s) => (
              <option key={s} value={s}>
                {
                  (
                    {
                      planned: 'Planejadas',
                      review: 'Em revisão',
                      finalized: 'Finalizadas',
                      awaiting_acceptance: 'Aguardando aceite',
                      accepted: 'Aceitas',
                      changes_requested: 'Ajustes solicitados',
                    } as Row
                  )[s]
                }
              </option>
            ))}
          </select>
          <input
            aria-label="Reuniões a partir de"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="list-heading">
          <span>{filtered.length} reuniões</span>
          <span>DATA · SITUAÇÃO</span>
        </div>
        {filtered.length ? (
          <MeetingRows rows={filtered} tz={c.org.timezone} />
        ) : (
          loaded && (
            <Empty
              title={
                rows.length
                  ? 'Nenhuma reunião com esses filtros'
                  : 'Sua primeira reunião começa aqui'
              }
              description={
                rows.length
                  ? 'Ajuste os filtros para encontrar outras reuniões.'
                  : 'Crie uma pauta, convide sua equipe e registre os próximos passos.'
              }
              href={rows.length ? undefined : '/reunioes/nova'}
            />
          )
        )}
      </section>
    </>
  );
}
function Work(c: Common) {
  const [data, setData] = useState<Row>({ tasks: [], decisions: [] }),
    [q, setQ] = useState(''),
    [tab, setTab] = useState('tasks'),
    [status, setStatus] = useState(''),
    [assignee, setAssignee] = useState('');
  const a = useAction();
  const load = useCallback(
    () => api('work', {}, c.orgId).then(setData),
    [c.orgId],
  );
  useEffect(() => {
    load().catch(a.setError);
  }, [load, a.setError]);
  const rows = (data[tab] as Row[]).filter(
    (x) =>
      (x.description + ' ' + x.meeting_title + ' ' + x.topic)
        .toLowerCase()
        .includes(q.toLowerCase()) &&
      (!status || tab !== 'tasks' || x.status === status) &&
      (!assignee || tab !== 'tasks' || x.assignee_id === assignee),
  );
  const people = Array.from(
    new Map(
      data.tasks
        .filter((t: Row) => t.assignee_id)
        .map((t: Row) => [t.assignee_id, t.assignee_name]),
    ).entries(),
  );
  return (
    <>
      <PageTitle
        title="Pendências e decisões"
        description="A conversa termina. O acompanhamento continua."
      />
      <div className="tabs">
        <button
          className={tab === 'tasks' ? 'active' : ''}
          onClick={() => setTab('tasks')}
        >
          Pendências <span>{data.tasks.length}</span>
        </button>
        <button
          className={tab === 'decisions' ? 'active' : ''}
          onClick={() => setTab('decisions')}
        >
          Decisões <span>{data.decisions.length}</span>
        </button>
      </div>
      <ErrorNotice message={a.error} />
      <section className="panel">
        <div className="filters">
          <div className="search-field">
            <Search size={18} />
            <input
              aria-label="Buscar pendências e decisões"
              placeholder="Buscar por assunto, projeto ou reunião…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {tab === 'tasks' && (
            <>
              <select
                aria-label="Filtrar tarefas por situação"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">Todas as situações</option>
                <option value="open">Abertas</option>
                <option value="in_progress">Em andamento</option>
                <option value="done">Concluídas</option>
                <option value="cancelled">Canceladas</option>
              </select>
              <select
                aria-label="Filtrar responsável"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">Todos os responsáveis</option>
                {people.map(([id, name]) => (
                  <option key={String(id)} value={String(id)}>
                    {String(name)}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
        {rows.length ? (
          <div className="work-list">
            {rows.map((t) => (
              <div className="work-row" key={t.id}>
                <span
                  className={
                    'task-indicator ' + (t.status === 'done' ? 'done' : '')
                  }
                >
                  <CheckCheck size={19} />
                </span>
                <div className="work-main">
                  <h3>{t.description}</h3>
                  <a href={'/reunioes/' + t.meeting_id + '?tab=acoes'}>
                    {t.meeting_title}
                    <ArrowUpRight size={13} />
                  </a>
                  {t.evidence && (
                    <details>
                      <summary>Trecho de origem</summary>
                      <blockquote>{t.evidence}</blockquote>
                    </details>
                  )}
                </div>
                {tab === 'tasks' && (
                  <>
                    <div className="task-person">
                      <strong>{t.assignee_name || 'A definir'}</strong>
                      <span>{dateOnly(t.due_date)}</span>
                    </div>
                    <select
                      aria-label={'Situação: ' + t.description}
                      disabled={!t.canEdit || a.busy}
                      value={t.status}
                      onChange={(e) =>
                        a.act(async () => {
                          await send(
                            'tasks/' + t.id,
                            { status: e.target.value },
                            c.orgId,
                            'PATCH',
                          );
                          await load();
                        })
                      }
                    >
                      <option value="open">Aberta</option>
                      <option value="in_progress">Em andamento</option>
                      <option value="done">Concluída</option>
                      <option value="cancelled">Cancelada</option>
                    </select>
                  </>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Empty
            title={
              tab === 'tasks'
                ? 'Nenhuma pendência por aqui'
                : 'Decisões com contexto, sempre'
            }
            description={
              tab === 'tasks'
                ? 'As tarefas confirmadas nas atas aparecerão aqui, com responsáveis e prazos.'
                : 'As decisões confirmadas ficam registradas com a reunião e o trecho de origem.'
            }
          />
        )}
      </section>
    </>
  );
}
function People(c: Common) {
  const [rows, setRows] = useState<Row[]>([]),
    [editing, setEditing] = useState<Row | null>(null),
    [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [kind, setKind] = useState('external'),
    [role, setRole] = useState('member'),
    [department, setDepartment] = useState(''),
    [responsibilities, setResponsibilities] = useState(''),
    [inviteLink, setInviteLink] = useState('');
  const a = useAction();
  const load = useCallback(
    () => api<Row[]>('participants', {}, c.orgId).then(setRows),
    [c.orgId],
  );
  useEffect(() => {
    load().catch(a.setError);
  }, [load, a.setError]);
  const clear = () => {
    setEditing(null);
    setName('');
    setEmail('');
    setKind('external');
    setRole('member');
    setDepartment('');
    setResponsibilities('');
  };
  return (
    <>
      <PageTitle
        title="Equipe e participantes"
        description="Cadastre as pessoas e escolha quem participa de cada reunião. Setor e responsabilidades ajudam a IA a compreender o contexto."
      />
      <ErrorNotice message={a.error} />
      <div
        className={c.org.role === 'admin' ? 'split-layout' : 'single-layout'}
      >
        <section className="panel">
          <div className="section-head">
            <h2>Participantes</h2>
            <span className="count">{rows.length}</span>
          </div>
          {rows.map((p) => (
            <div className="person-row" key={p.id} id={'participant-' + p.id}>
              <span className="avatar">{initials(p.name)}</span>
              <div>
                <h3>{p.name}</h3>
                <p>{p.email}</p>
                {p.department && <p>{p.department}</p>}
                <p className="muted">
                  {p.access_state === 'active'
                    ? 'Acesso ao sistema liberado'
                    : p.kind === 'internal'
                      ? 'Primeiro acesso pendente'
                      : 'Aceite por link · sem acesso ao sistema'}
                </p>
                {p.responsibilities && (
                  <p className="muted">{p.responsibilities}</p>
                )}
              </div>
              <span className="person-kind">
                {p.kind === 'internal'
                  ? p.role === 'admin'
                    ? 'Administrador'
                    : 'Membro'
                  : 'Externo'}
              </span>
              {c.org.role === 'admin' && (
                <button
                  className="text-link"
                  onClick={() => {
                    setEditing(p);
                    setName(p.name);
                    setEmail(p.email);
                    setKind(p.kind);
                    setRole(p.role);
                    setDepartment(p.department || '');
                    setResponsibilities(p.responsibilities || '');
                  }}
                >
                  Editar
                </button>
              )}
              {c.org.role === 'admin' &&
                p.kind === 'internal' &&
                p.email !== c.user.email && (
                  <Btn
                    secondary
                    busy={a.busy}
                    onClick={() =>
                      a.act(
                        async () => {
                          setInviteLink('');
                          const result = await send(
                            `participants/${p.id}/invite`,
                            {},
                            c.orgId,
                          );
                          setInviteLink(result.localLink || '');
                        },
                        c.integrations.test
                          ? 'Convite de acesso gerado em teste local.'
                          : 'Convite de acesso enviado por e-mail.',
                      )
                    }
                  >
                    Convidar para acessar
                  </Btn>
                )}
            </div>
          ))}
        </section>
        {c.org.role === 'admin' && (
          <section className="panel">
            <h2>
              {editing ? 'Editar participante' : 'Adicionar participante'}
            </h2>
            <p className="muted small-copy">
              Internos acessam o sistema e podem criar suas reuniões e atas.
              Externos recebem convites e dão aceite por link, sem login.
              Administradores gerenciam a empresa e os acessos.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void a.act(
                  async () => {
                    await send(
                      'participants' + (editing ? '/' + editing.id : ''),
                      { name, email, kind, role, department, responsibilities },
                      c.orgId,
                      editing ? 'PATCH' : 'POST',
                    );
                    clear();
                    await load();
                  },
                  kind === 'internal'
                    ? 'Membro salvo. Use Convidar para acessar para enviar o e-mail de entrada.'
                    : 'Participante externo salvo. Selecione-o nas reuniões para enviar convites e atas.',
                );
              }}
            >
              <label>
                Nome
                <input
                  required
                  value={name}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                E-mail
                <input
                  required
                  type="email"
                  disabled={!!editing}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Setor
                <input
                  value={department}
                  maxLength={150}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder="Ex.: Comercial"
                />
              </label>
              <label>
                Responsabilidades
                <textarea
                  value={responsibilities}
                  maxLength={3000}
                  rows={3}
                  onChange={(e) => setResponsibilities(e.target.value)}
                  placeholder="Ex.: acompanhar propostas e negociações com clientes"
                />
              </label>
              <label>
                Tipo de acesso
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="external">
                    Externo — aceite por link, sem login
                  </option>
                  <option value="internal">Interno — acesso ao sistema</option>
                </select>
              </label>
              {kind === 'internal' && (
                <label>
                  Permissão
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                  >
                    <option value="member">Membro</option>
                    <option value="admin">Administrador</option>
                  </select>
                </label>
              )}
              <Btn type="submit" busy={a.busy}>
                {editing ? 'Salvar alterações' : 'Adicionar pessoa'}
              </Btn>
              {editing && (
                <Btn secondary onClick={clear}>
                  Cancelar edição
                </Btn>
              )}
              {a.notice && <output className="notice">{a.notice}</output>}
              {inviteLink && (
                <a className="text-link" href={inviteLink}>
                  Abrir convite local (nenhum e-mail enviado)
                </a>
              )}
            </form>
          </section>
        )}
      </div>
    </>
  );
}
function Organization(c: Common) {
  const [name, setName] = useState(c.org.name);
  const a = useAction();
  return (
    <>
      <PageTitle
        title="Organização"
        description="O contexto da empresa ajuda a dar sentido a cada reunião."
      />
      <div className="split-layout">
        <section className="panel">
          <h2>Sobre a empresa</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void a.act(async () => {
                await send('organization', { name }, c.orgId, 'PATCH');
              }, 'Informações atualizadas.');
            }}
          >
            <label>
              Nome
              <input
                required
                disabled={c.org.role !== 'admin'}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Fuso horário
              <input disabled value={c.org.timezone} />
            </label>
            <ErrorNotice message={a.error} />
            {a.notice && <output className="notice">{a.notice}</output>}
            {c.org.role === 'admin' && (
              <Btn type="submit" busy={a.busy}>
                Salvar informações
              </Btn>
            )}
          </form>
        </section>
      </div>
      <CompanyKnowledge
        orgId={c.orgId}
        admin={c.org.role === 'admin'}
        legacyBusiness={c.org.business}
      />
    </>
  );
}
