'use client';
/* eslint-disable next/no-html-link-for-pages -- Full document navigation resets organization/session state and preserves unsaved-change prompts. */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Plus,
  Trash2,
  CalendarDays,
  Clock3,
  MapPin,
  Users,
  FileText,
  Mic,
  CheckCheck,
  History,
  Send,
  Printer,
  Sparkles,
  UploadCloud,
  Check,
  RotateCcw,
  Link2,
  FileAudio,
  Eye,
} from 'lucide-react';
import {
  api,
  send,
  Row,
  Btn,
  Badge,
  Empty,
  ErrorNotice,
  Modal,
  dateTime,
  dateOnly,
  useAction,
} from './shared';
import type { Common } from './workspace';
import {
  type Draft,
  type Agenda,
  emptyDraft,
  MAX_AUDIO_BYTES,
} from '@/lib/domain/model';
import { LongRecorder, StoredRecording } from './long-recorder';
import { ProposalEditor } from './planning';
import { MeetingMaterials } from './materials';
import { MeetingPresenter } from './presenter';
import type { AgendaProposal } from '@/lib/domain/planning';
import type { Source } from '@/lib/domain/memory';
function inputDate(iso: string, tz: string) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
  return parts.replace(' ', 'T');
}
function dateInZone(local: string, tz: string) {
  let utc = Date.parse(local + 'Z');
  for (let n = 0; n < 3; n++) {
    const formatted = inputDate(new Date(utc).toISOString(), tz);
    const offset = Date.parse(formatted + 'Z') - Date.parse(local + 'Z');
    if (!offset) break;
    utc -= offset;
  }
  return new Date(utc).toISOString();
}
export function MeetingForm(
  c: Common & { initial?: Row; onSaved?: () => void },
) {
  const m = c.initial;
  const [title, setTitle] = useState(m?.title || ''),
    [objective, setObjective] = useState(m?.objective || ''),
    [scheduled, setScheduled] = useState(() =>
      inputDate(
        m?.scheduled_at || new Date(Date.now() + 86400000).toISOString(),
        c.org.timezone,
      ),
    ),
    [duration, setDuration] = useState(m?.duration || 60),
    [location, setLocation] = useState(m?.location || ''),
    [topic, setTopic] = useState(m?.topic || ''),
    [agenda, setAgenda] = useState<Agenda>(m?.agenda || []),
    [participantIds, setParticipantIds] = useState<string[]>(
      m?.participantIds || [],
    ),
    [people, setPeople] = useState<Row[]>([]),
    [tasks, setTasks] = useState<Row[]>([]);
  const a = useAction();
  useEffect(() => {
    Promise.all([
      api<Row[]>('participants', {}, c.orgId),
      api('work', {}, c.orgId),
    ])
      .then(([p, w]) => {
        setPeople(p);
        setTasks(
          w.tasks.filter((t: Row) => !['done', 'cancelled'].includes(t.status)),
        );
      })
      .catch(a.setError);
  }, [c.orgId, a.setError]);
  const [proposal, setProposal] = useState<AgendaProposal | null>(null);
  const [origins, setOrigins] = useState<
    Record<string, { reason: string; sources: Source[] }>
  >({});
  const [planningBusy, setPlanningBusy] = useState(false);
  const planRequest = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    const proposalId = new URLSearchParams(window.location.search).get(
      'proposal',
    );
    if (proposalId && !m)
      void api<AgendaProposal>('agenda-proposals/' + proposalId, {}, c.orgId)
        .then((value) => {
          setProposal(value);
          setObjective((previous: string) => previous || value.objective);
          setTopic((previous: string) => previous || value.topic);
        })
        .catch(a.setError);
    if (m?.id)
      void api<Record<string, { reason: string; sources: Source[] }>>(
        'meetings/' + m.id + '/agenda-origins',
        {},
        c.orgId,
      )
        .then(setOrigins)
        .catch(a.setError);
  }, [c.orgId, m, a.setError]);
  const readonly = !!m?.version;
  function move(i: number, delta: number) {
    const next = [...agenda];
    const target = i + delta;
    if (target < 0 || target >= next.length) return;
    [next[i], next[target]] = [next[target], next[i]];
    setAgenda(next);
  }
  return (
    <>
      <div className="page-title">
        <div>
          {!m && (
            <a className="back-link" href="/reunioes">
              <ArrowLeft size={15} />
              Reuniões
            </a>
          )}
          <h1>{m ? 'Preparação' : 'Nova reunião'}</h1>
          <p className="muted">
            Uma conversa produtiva começa com um objetivo claro.
          </p>
        </div>
        {m && (
          <a
            className="secondary"
            href={'/imprimir/' + m.id + '?type=agenda'}
            target="_blank"
            rel="noreferrer"
          >
            <Printer size={17} />
            Imprimir pauta
          </a>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void a.act(async () => {
            const d = await send(
              'meetings' + (m ? '/' + m.id : ''),
              {
                title,
                objective,
                scheduledAt: dateInZone(scheduled, c.org.timezone),
                duration: Number(duration),
                location,
                topic,
                agenda,
                participantIds,
                ...(m ? { revision: m.revision } : {}),
              },
              c.orgId,
              m ? 'PATCH' : 'POST',
            );
            if (c.onSaved) c.onSaved();
            else window.location.href = '/reunioes/' + d.id;
          }, 'Preparação salva.');
        }}
      >
        {!m && proposal && (
          <p className="notice">
            Esta é uma proposta do assistente. Confirme o título, a data e os
            participantes; selecione os itens de pauta que deseja incorporar. A
            reunião só será criada ao confirmar o formulário.
          </p>
        )}
        <div className="split-layout meeting-form">
          <section className="panel">
            <div className="section-head">
              <h2>O encontro</h2>
              <CalendarDays size={19} className="muted" />
            </div>
            <fieldset disabled={readonly}>
              <label>
                Título da reunião
                <input
                  required
                  minLength={3}
                  maxLength={200}
                  placeholder="Ex.: Alinhamento comercial da semana"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                Objetivo
                <textarea
                  placeholder="O que precisa estar resolvido ao final da reunião?"
                  value={objective}
                  maxLength={5000}
                  onChange={(e) => setObjective(e.target.value)}
                />
              </label>
              <div className="form-grid">
                <label>
                  Data e horário
                  <input
                    type="datetime-local"
                    required
                    value={scheduled}
                    onChange={(e) => setScheduled(e.target.value)}
                  />
                  <span className="field-help">{c.org.timezone}</span>
                </label>
                <label>
                  Duração (minutos)
                  <input
                    type="number"
                    min={5}
                    max={480}
                    required
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                  />
                </label>
              </div>
              <div className="form-grid">
                <label>
                  Local
                  <input
                    placeholder="Sala de reuniões, endereço ou link"
                    value={location}
                    maxLength={500}
                    onChange={(e) => setLocation(e.target.value)}
                  />
                </label>
                <label>
                  Assunto ou projeto
                  <input
                    placeholder="Ex.: Comercial"
                    value={topic}
                    maxLength={200}
                    onChange={(e) => setTopic(e.target.value)}
                  />
                </label>
              </div>
            </fieldset>
          </section>
          <section className="panel">
            <div className="section-head">
              <h2>Participantes</h2>
              <span className="count">{participantIds.length}</span>
            </div>
            <p className="muted small-copy">
              Selecione quem deve fazer parte desta conversa.
            </p>
            <div className="participant-picker">
              {people.map((p) => (
                <label key={p.id} className="check-label person-option">
                  <input
                    type="checkbox"
                    disabled={readonly}
                    checked={participantIds.includes(p.id)}
                    onChange={(e) =>
                      setParticipantIds(
                        e.target.checked
                          ? [...participantIds, p.id]
                          : participantIds.filter((id) => id !== p.id),
                      )
                    }
                  />
                  <span>
                    <strong>{p.name}</strong>
                    <small>{p.email}</small>
                    {p.department && <small>{p.department}</small>}
                  </span>
                  <em>{p.kind === 'internal' ? 'Equipe' : 'Externo'}</em>
                </label>
              ))}
            </div>
            <a className="text-link" href="/pessoas">
              <Plus size={15} />
              Gerenciar pessoas
            </a>
          </section>
        </div>
        {!readonly && (
          <section className="panel section-gap">
            <div className="section-head">
              <div>
                <h2>Preparar com o histórico</h2>
                <p className="muted">
                  O objetivo e o assunto acima orientam a seleção de pendências
                  e temas anteriores.
                </p>
              </div>
              <Btn
                type="button"
                secondary
                busy={planningBusy}
                disabled={!objective.trim() || a.busy}
                onClick={async () => {
                  setPlanningBusy(true);
                  await a.act(async () => {
                    const key = JSON.stringify({
                      objective,
                      topic,
                      meetingId: m?.id || null,
                    });
                    if (planRequest.current?.key !== key)
                      planRequest.current = { key, id: crypto.randomUUID() };
                    const result = await api<AgendaProposal>(
                      'agenda-proposals',
                      {
                        method: 'POST',
                        body: JSON.stringify({
                          requestId: planRequest.current.id,
                          objective,
                          subject: topic,
                          meetingId: m?.id || null,
                        }),
                      },
                      c.orgId,
                    );
                    setProposal(result);
                  });
                  setPlanningBusy(false);
                }}
              >
                <Sparkles size={17} />
                Sugerir pauta
              </Btn>
            </div>
            {!objective.trim() && (
              <p className="muted">
                Informe o objetivo para solicitar sugestões.
              </p>
            )}
            {proposal && (
              <ProposalEditor
                key={proposal.id}
                proposal={proposal}
                orgId={c.orgId}
                disabled={a.busy || planningBusy}
                onApply={(items, nextTopic, nextObjective) => {
                  const additions = items.filter(
                    (item) =>
                      !agenda.some(
                        (old) =>
                          (old.origin?.proposalId === item.origin?.proposalId &&
                            old.origin?.itemId === item.origin?.itemId) ||
                          (item.taskId && old.taskId === item.taskId),
                      ),
                  );
                  if (agenda.length + additions.length > 60) {
                    a.setError(
                      'A pauta permite até 60 itens. Remova alguns antes de incorporar.',
                    );
                    return;
                  }
                  setAgenda([...agenda, ...additions]);
                  if (nextTopic) setTopic(nextTopic);
                  if (nextObjective) setObjective(nextObjective);
                  setProposal(null);
                }}
              />
            )}
          </section>
        )}
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>Pauta da reunião</h2>
              <p className="muted small-copy">
                Organize a sequência da conversa e retome o que ficou pendente.
              </p>
            </div>
            {!readonly && (
              <Btn
                secondary
                onClick={() =>
                  setAgenda([
                    ...agenda,
                    { id: crypto.randomUUID(), title: '', taskId: null },
                  ])
                }
              >
                <Plus size={16} />
                Adicionar item
              </Btn>
            )}
          </div>
          {!agenda.length && (
            <div className="quiet-empty">
              Adicione os temas que precisam de discussão.
            </div>
          )}
          <div className="agenda-list">
            {agenda.map((item, i) => (
              <div className="agenda-item" key={item.id}>
                <span className="agenda-number">
                  {(i + 1).toString().padStart(2, '0')}
                </span>
                <div>
                  <input
                    required
                    disabled={readonly}
                    aria-label={'Pauta ' + (i + 1)}
                    placeholder="Qual assunto precisa entrar na pauta?"
                    value={item.title}
                    maxLength={500}
                    onChange={(e) =>
                      setAgenda(
                        agenda.map((x, j) =>
                          i === j ? { ...x, title: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  {item.origin && (
                    <div className="origin-link">
                      <Link2 size={12} />
                      Sugestão incorporada explicitamente
                    </div>
                  )}
                  {origins[item.id] && (
                    <details>
                      <summary>Origem da sugestão</summary>
                      <p>{origins[item.id].reason}</p>
                      {origins[item.id].sources.map((source) => (
                        <a
                          className="text-link"
                          key={source.id}
                          href={source.href}
                        >
                          {source.title} · {source.state}
                        </a>
                      ))}
                    </details>
                  )}
                  {item.taskId && (
                    <span className="origin-link">
                      <Link2 size={12} />
                      Retomada de pendência anterior
                    </span>
                  )}
                </div>
                {!readonly && (
                  <div className="agenda-actions">
                    <button
                      type="button"
                      className="icon-btn"
                      disabled={i === 0}
                      aria-label="Mover item para cima"
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      disabled={i === agenda.length - 1}
                      aria-label="Mover item para baixo"
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Remover item de pauta"
                      onClick={() =>
                        setAgenda(agenda.filter((_, j) => j !== i))
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {!readonly && tasks.length > 0 && (
            <label className="resume-pending">
              <span>
                <RotateCcw size={16} />
                Trazer uma pendência para esta reunião
              </span>
              <select
                value=""
                onChange={(e) => {
                  const t = tasks.find((x) => x.id === e.target.value);
                  if (t && !agenda.some((x) => x.taskId === t.id))
                    setAgenda([
                      ...agenda,
                      {
                        id: crypto.randomUUID(),
                        title: t.description,
                        taskId: t.id,
                      },
                    ]);
                }}
              >
                <option value="">Selecione uma pendência anterior…</option>
                {tasks
                  .filter((t) => !agenda.some((x) => x.taskId === t.id))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.description} · {t.meeting_title}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </section>
        <ErrorNotice message={a.error} />
        {a.notice && <output className="notice">{a.notice}</output>}
        {!readonly && (
          <div className="form-footer">
            <span className="muted small-copy">
              Os convites serão enviados quando você escolher.
            </span>
            <Btn type="submit" busy={a.busy} disabled={planningBusy}>
              {m ? 'Salvar preparação' : 'Confirmar e criar reunião'}
              <ArrowRight size={17} />
            </Btn>
          </div>
        )}
      </form>
    </>
  );
}
export function MeetingDetail(c: Common & { meetingId: string }) {
  const [data, setData] = useState<Row | null>(null),
    [tab, setTab] = useState(() =>
      typeof window === 'undefined'
        ? 'preparacao'
        : new URLSearchParams(window.location.search).get('tab') ||
          'preparacao',
    ),
    [draft, setDraft] = useState<Draft>(emptyDraft()),
    [modal, setModal] = useState(''),
    [text, setText] = useState(''),
    [selectedFile, setSelectedFile] = useState(''),
    [recipients, setRecipients] = useState<string[]>([]),
    [candidate, setCandidate] = useState<Row | null>(null),
    [localUrl, setLocalUrl] = useState('');
  const dirty = useRef(false);
  const [isDirty, setIsDirty] = useState(false);
  const [attendanceConfirmed, setAttendanceConfirmed] = useState(false);
  const [capturePending, setCapturePending] = useState(false);
  const a = useAction();
  const fileInput = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    const d = await api('meetings/' + c.meetingId, {}, c.orgId);
    setData(d);
    if (!new URLSearchParams(window.location.search).has('tab')) {
      setTab(
        d.meeting.draft || d.minutes.length
          ? 'ata'
          : d.jobs.length || d.files.length
            ? 'conteudo'
            : 'preparacao',
      );
    }
    if (!dirty.current) setDraft(d.meeting.draft || emptyDraft());
    return d;
  }, [c.meetingId, c.orgId]);
  useEffect(() => {
    // eslint-disable-next-line react/react-compiler -- Fetch persistent state when the meeting identity changes; updates occur after the request resolves.
    load().catch(a.setError);
  }, [load, a.setError]);
  const sourceScrolled = useRef(false);
  useEffect(() => {
    if (!data || sourceScrolled.current || !window.location.hash) return;
    let sourceId = window.location.hash.slice(1);
    try {
      sourceId = decodeURIComponent(sourceId);
    } catch {
      return;
    }
    const target = document.getElementById(sourceId);
    if (target) {
      target.scrollIntoView({ block: 'center' });
      sourceScrolled.current = true;
    }
  }, [data, tab]);
  const processing = data?.jobs.some((j: Row) =>
    ['queued', 'running'].includes(j.state),
  );
  const mailing = data?.deliveries.some((d: Row) => d.status === 'queued');
  useEffect(() => {
    if (!processing && !mailing) return;
    const timer = setInterval(() => load().catch(a.setError), 4000);
    return () => clearInterval(timer);
  }, [processing, mailing, load, a.setError]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault(); /* preventDefault triggers the browser unsaved-change prompt. */
      }
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, []);
  if (!data)
    return (
      <>
        <ErrorNotice message={a.error} />
        <p className="muted">Carregando reunião…</p>
      </>
    );
  const m = data.meeting;
  const editable = data.canEdit;
  const submitted =
    data.jobs.length > 0 ||
    !!m.draft ||
    m.version > 0 ||
    m.status !== 'planned';
  const canCapture = editable && !submitted && data.files.length === 0;
  const canPrepare = canCapture;
  const canSubmit = editable && !submitted;
  const reviewed = !(m.status === 'planned' || m.status === 'review');
  const latest = data.minutes[0];
  const currentAcceptances = data.acceptances.filter(
    (x: Row) => x.minutes_id === latest?.id,
  );
  function changeDraft(next: Draft) {
    dirty.current = true;
    setIsDirty(true);
    setDraft(next);
  }
  function changeTab(value: string) {
    if (capturePending) return;
    setTab(value);
    history.replaceState(null, '', '?org=' + c.orgId + '&tab=' + value);
  }
  async function saveCurrent() {
    const result = await send(
      'meetings/' + m.id + '/draft',
      { draft, revision: m.revision },
      c.orgId,
      'PATCH',
    );
    dirty.current = false;
    setIsDirty(false);
    await load();
    return result;
  }
  async function uploadFile(file: File) {
    return a.act(async () => {
      if (file.size > MAX_AUDIO_BYTES)
        throw Error('Envie um áudio de até 20 MB.');
      const form = new FormData();
      form.append('file', file);
      const r = await api(
        'meetings/' + m.id + '/files',
        { method: 'POST', body: form },
        c.orgId,
      );
      setSelectedFile(r.id);
      await load();
    }, 'Áudio armazenado. Selecione Gerar ata para processar o conteúdo.');
  }
  return (
    <>
      <a className="back-link" href="/reunioes">
        <ArrowLeft size={15} />
        Todas as reuniões
      </a>
      <div className="page-title detail-title">
        <div>
          <div className="title-line">
            <h1>{m.title}</h1>
            <Badge status={m.status} />
          </div>
          <div className="meeting-meta">
            <span>
              <CalendarDays size={15} />
              {dateTime(m.scheduled_at, c.org.timezone)}
            </span>
            <span>
              <Clock3 size={15} />
              {m.duration} min
            </span>
            <span>
              <Users size={15} />
              {data.participants.length} participantes
            </span>
            {m.location && (
              <span>
                <MapPin size={15} />
                {m.location}
              </span>
            )}
          </div>
        </div>
        {canPrepare && (
          <Btn secondary busy={a.busy} onClick={() => setModal('invite')}>
            <Send size={16} />
            Convidar participantes
          </Btn>
        )}
      </div>
      <div className="tabs">
        {[
          { id: 'preparacao', label: 'Preparação', icon: CalendarDays },
          { id: 'conteudo', label: 'Gravação e presença', icon: Mic },
          { id: 'ata', label: 'Ata da reunião', icon: FileText },
          { id: 'acoes', label: 'Decisões e tarefas', icon: CheckCheck },
          { id: 'historico', label: 'Histórico', icon: History },
        ].map((t) => (
          <button
            key={t.id}
            disabled={capturePending && t.id !== tab}
            className={tab === t.id ? 'active' : ''}
            onClick={() => changeTab(t.id)}
          >
            <t.icon size={17} />
            {t.label}
          </button>
        ))}
      </div>
      <ErrorNotice message={a.error} />
      {capturePending && (
        <p className="notice">
          Partes do áudio são salvas durante a captura. Conclua a gravação antes
          de trocar de etapa. Você pode navegar pelos slides normalmente.
        </p>
      )}
      {a.notice && <output className="notice">{a.notice}</output>}
      {tab === 'preparacao' && (
        <>
          <MeetingForm
            {...c}
            initial={{
              ...m,
              version: canPrepare ? 0 : 1,
              participantIds: data.participants.map((p: Row) => p.id),
            }}
            key={m.revision}
            onSaved={() => load()}
          />
          <MeetingMaterials
            key={'materials-' + m.revision}
            orgId={c.orgId}
            meetingId={m.id}
            revision={m.revision}
            canEdit={editable}
            hasAgenda={m.agenda.length > 0}
          />
        </>
      )}
      {tab === 'conteudo' && (
        <>
          {data.participants.length > 0 && (
            <section className="panel section-gap">
              <h2>Presença na reunião</h2>
              <div className="presence-list">
                {data.participants.map((p: Row) => (
                  <label className="check-label" key={p.id}>
                    <input
                      type="checkbox"
                      disabled={!canSubmit || a.busy}
                      checked={!!p.present}
                      onChange={(e) =>
                        a.act(async () => {
                          setAttendanceConfirmed(false);
                          await send(
                            'meetings/' + m.id + '/presence',
                            { participantId: p.id, present: e.target.checked },
                            c.orgId,
                            'PATCH',
                          );
                          await load();
                        })
                      }
                    />
                    {p.name}
                    <span className="muted">
                      {p.present ? 'Presente' : 'Ausente'}
                    </span>
                  </label>
                ))}
              </div>
            </section>
          )}
          {canSubmit && (
            <label className="check-label notice">
              <input
                type="checkbox"
                checked={attendanceConfirmed}
                onChange={(e) => setAttendanceConfirmed(e.target.checked)}
              />
              Conferi a lista de presença. Participantes desmarcados serão
              registrados como ausentes.
            </label>
          )}
          <MeetingPresenter
            orgId={c.orgId}
            meetingId={m.id}
            revision={m.revision}
          >
            {(canCapture || capturePending) && (
              <LongRecorder
                orgId={c.orgId}
                meetingId={m.id}
                onStored={async (id) => {
                  setSelectedFile(id);
                  await load();
                }}
                onPendingChange={setCapturePending}
              />
            )}
          </MeetingPresenter>
          <div className="split-layout">
            <section className="panel">
              <div className="section-head">
                <h2>Áudio da reunião</h2>
                <Mic size={19} />
              </div>
              {canCapture && !capturePending && (
                <div className="upload-area">
                  <UploadCloud size={24} />
                  <h3>Já tem uma gravação?</h3>
                  <p>MP3, MP4, M4A, WAV ou WebM · até 20 MB</p>
                  {editable && (
                    <>
                      <input
                        ref={fileInput}
                        hidden
                        type="file"
                        accept=".mp3,.mp4,.m4a,.wav,.webm,.mpeg,.mpga"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void uploadFile(file);
                          e.target.value = '';
                        }}
                      />
                      <Btn
                        secondary
                        disabled={a.busy}
                        onClick={() => fileInput.current?.click()}
                      >
                        Selecionar arquivo
                      </Btn>
                    </>
                  )}
                </div>
              )}
              {data.files.map((f: Row) => (
                <div className="audio-file" key={f.id}>
                  <label className="check-label">
                    <input
                      type="radio"
                      name="audio-file"
                      disabled={!canSubmit}
                      checked={selectedFile === f.id}
                      onChange={() => setSelectedFile(f.id)}
                    />
                    <FileAudio size={19} />
                    <span>
                      {f.name}
                      <small>{(f.size / 1024 / 1024).toFixed(1)} MB</small>
                    </span>
                  </label>
                  {f.mime !== 'audio/segments' && (
                    <a
                      className="text-link"
                      href={'/api/files/' + f.id + '?org=' + c.orgId}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Ouvir
                    </a>
                  )}
                </div>
              ))}
              {!capturePending &&
                data.files
                  .filter((f: Row) => f.mime === 'audio/segments')
                  .map((f: Row) => (
                    <StoredRecording
                      key={f.id}
                      orgId={c.orgId}
                      meetingId={m.id}
                      fileId={f.id}
                      canEdit={editable}
                      onStored={async (id) => {
                        setSelectedFile(id);
                        await load();
                      }}
                    />
                  ))}
              {selectedFile && canSubmit && (
                <Btn
                  disabled={
                    a.busy ||
                    processing ||
                    !attendanceConfirmed ||
                    capturePending
                  }
                  onClick={() =>
                    a.act(async () => {
                      await send(
                        'meetings/' + m.id + '/process',
                        {
                          fileId: selectedFile,
                          attendanceConfirmed,
                          requestKey: crypto.randomUUID(),
                        },
                        c.orgId,
                      );
                      await load();
                    }, 'Processamento solicitado. O resultado aparecerá abaixo.')
                  }
                >
                  <Sparkles size={17} />
                  Gerar ata a partir do áudio
                </Btn>
              )}
            </section>
            {canSubmit && !capturePending && (
              <section className="panel">
                <div className="section-head">
                  <h2>Usar uma transcrição</h2>
                  <FileText size={19} />
                </div>
                <p className="muted small-copy">
                  Cole o conteúdo da reunião para gerar um rascunho estruturado.
                </p>
                <textarea
                  aria-label="Conteúdo da reunião"
                  rows={12}
                  maxLength={100000}
                  placeholder="Cole aqui a transcrição ou as anotações da conversa…"
                  value={text}
                  disabled={!editable}
                  onChange={(e) => setText(e.target.value)}
                />
                {editable && (
                  <Btn
                    disabled={
                      a.busy ||
                      text.trim().length < 10 ||
                      processing ||
                      !attendanceConfirmed
                    }
                    onClick={() =>
                      a.act(
                        async () => {
                          await send(
                            'meetings/' + m.id + '/process',
                            {
                              text,
                              requestKey: crypto.randomUUID(),
                              attendanceConfirmed,
                            },
                            c.orgId,
                          );
                          await load();
                        },
                        c.integrations.test
                          ? 'Rascunho de teste pronto. Revise e incorpore o resultado.'
                          : 'Processamento solicitado. Você pode sair desta página.',
                      )
                    }
                  >
                    <Sparkles size={17} />
                    {c.integrations.test
                      ? 'Preparar rascunho de teste'
                      : 'Gerar ata a partir do texto'}
                  </Btn>
                )}
                {c.integrations.test && (
                  <p className="field-help">
                    Teste local: o conteúdo é copiado para revisão manual.
                    Nenhuma IA é consultada.
                  </p>
                )}
              </section>
            )}
          </div>
          <section className="panel section-gap">
            <div className="section-head">
              <h2>Processamento</h2>
              <span className="count">{data.jobs.length}</span>
            </div>
            {!data.jobs.length ? (
              <div className="quiet-empty">
                Envie o conteúdo para preparar o primeiro rascunho.
              </div>
            ) : (
              data.jobs.map((j: Row) => (
                <div className="job-row" key={j.id}>
                  <div>
                    <Badge status={j.state} />
                    <p className="small-copy muted">
                      {dateTime(j.created_at, c.org.timezone)} ·{' '}
                      {(
                        {
                          queued: 'Aguardando início',
                          transcription: 'Transcrição',
                          minutes: 'Estruturação da ata',
                          completed: 'Pronto para revisão',
                        } as Row
                      )[j.step] || j.step}
                    </p>
                    {j.error && <p className="error-text">{j.error}</p>}
                  </div>
                  {editable && j.state === 'completed' && !j.applied && (
                    <Btn
                      secondary
                      onClick={() => {
                        setCandidate(j);
                        setModal('candidate');
                      }}
                    >
                      <Eye size={16} />
                      Revisar resultado
                    </Btn>
                  )}
                  {!!j.applied && (
                    <span className="muted small-copy">Incorporado à ata</span>
                  )}
                  {editable &&
                    ['failed', 'dispatch_failed'].includes(j.state) && (
                      <Btn
                        secondary
                        busy={a.busy}
                        onClick={() =>
                          a.act(async () => {
                            await send('jobs/' + j.id + '/retry', {}, c.orgId);
                            await load();
                          })
                        }
                      >
                        <RotateCcw size={15} />
                        Retomar
                      </Btn>
                    )}
                </div>
              ))
            )}
          </section>
          {data.transcripts.length > 0 && (
            <section className="panel section-gap">
              <h2>Transcrições armazenadas</h2>
              {data.transcripts.map((t: Row) => (
                <details key={t.id} className="transcript">
                  <summary>
                    {dateTime(t.created_at, c.org.timezone)} ·{' '}
                    {t.source === 'text' ? 'Texto enviado' : 'Áudio transcrito'}
                  </summary>
                  <p>{t.content}</p>
                </details>
              ))}
            </section>
          )}
        </>
      )}
      {tab === 'ata' && (
        <>
          <div className="section-head">
            <div>
              <h2>{reviewed ? 'Ata finalizada' : 'Rascunho da ata'}</h2>
              <p className="muted small-copy">
                {reviewed
                  ? `Versão ${m.version} preservada no histórico.`
                  : 'Confira os fatos, as decisões e as atribuições antes de finalizar.'}
              </p>
            </div>
            <div className="button-row">
              {latest && (
                <a
                  className="secondary"
                  href={'/imprimir/' + m.id}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Printer size={16} />
                  Imprimir ata
                </a>
              )}
              {editable && reviewed && data.acceptances.length === 0 && (
                <Btn secondary busy={a.busy} onClick={() => setModal('revise')}>
                  <RotateCcw size={16} />
                  Abrir nova revisão
                </Btn>
              )}
              {editable && reviewed && m.status !== 'accepted' && (
                <Btn
                  onClick={() => {
                    setRecipients(data.participants.map((p: Row) => p.id));
                    setModal('send');
                  }}
                >
                  <Send size={16} />
                  Enviar para aceite
                </Btn>
              )}
            </div>
          </div>
          {!m.draft && !latest ? (
            <section className="panel">
              <p>
                A ata será liberada após o processamento do conteúdo da reunião.
              </p>
              <Btn secondary onClick={() => changeTab('conteudo')}>
                Ir para gravação e processamento
              </Btn>
            </section>
          ) : reviewed && latest ? (
            <section className="panel minutes-paper">
              <MinutesBody content={latest.content} />
            </section>
          ) : (
            <>
              <div className="draft-layout">
                <section className="panel">
                  <DraftEditor
                    draft={draft}
                    onChange={changeDraft}
                    participants={data.participants}
                    disabled={!editable || a.busy}
                  />
                </section>
                <aside className="panel reference-panel">
                  <span className="eyebrow">REFERÊNCIA</span>
                  <h3>Conteúdo da reunião</h3>
                  {data.transcripts[0] ? (
                    <p className="transcript-reference">
                      {data.transcripts[0].content}
                    </p>
                  ) : (
                    <p className="muted small-copy">
                      Nenhuma transcrição disponível. Você pode escrever a ata
                      manualmente ou processar o conteúdo da reunião.
                    </p>
                  )}
                  <p className="notice small-copy">
                    Responsáveis e prazos incertos devem ficar a definir.
                    Confirme cada atribuição com a equipe.
                  </p>
                </aside>
              </div>
              {editable && (
                <div className="form-footer">
                  <span className="muted small-copy">
                    {isDirty
                      ? 'Há alterações ainda não salvas.'
                      : 'Rascunho separado do histórico confirmado.'}
                  </span>
                  <div className="button-row">
                    <Btn
                      secondary
                      busy={a.busy}
                      onClick={() => a.act(saveCurrent, 'Rascunho salvo.')}
                    >
                      Salvar rascunho
                    </Btn>
                    <Btn
                      disabled={a.busy || !draft.summary.trim()}
                      onClick={() => setModal('finalize')}
                    >
                      <Check size={17} />
                      Finalizar ata
                    </Btn>
                  </div>
                </div>
              )}
            </>
          )}
          {latest && currentAcceptances.length > 0 && (
            <section className="panel section-gap">
              <div className="section-head">
                <h2>Aceites · versão {latest.number}</h2>
                <span className="small-copy muted">
                  Todos os destinatários são obrigatórios
                </span>
              </div>
              {currentAcceptances.map((v: Row) => (
                <div className="acceptance-row" key={v.id}>
                  <div>
                    <h3>{v.recipient_name}</h3>
                    <p className="muted small-copy">{v.recipient_email}</p>
                    {v.comment && <p className="notice">{v.comment}</p>}
                  </div>
                  <Badge status={v.status} />
                  {editable && v.status === 'pending' && (
                    <Btn
                      secondary
                      busy={a.busy}
                      onClick={() =>
                        a.act(async () => {
                          await send(
                            'acceptances/' + v.id + '/resend',
                            {},
                            c.orgId,
                          );
                          await load();
                        }, 'Novo link preparado. O link anterior deixou de funcionar.')
                      }
                    >
                      Renovar link
                    </Btn>
                  )}
                </div>
              ))}
            </section>
          )}
          {data.minutes.length > 1 && (
            <section className="panel section-gap">
              <h2>Versões anteriores</h2>
              {data.minutes.slice(1).map((v: Row) => (
                <div className="version-row" key={v.id}>
                  <a
                    href={'/imprimir/' + m.id + '?version=' + v.number}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Versão {v.number} · {dateTime(v.created_at, c.org.timezone)}{' '}
                    <Eye size={16} />
                  </a>
                  {data.acceptances
                    .filter((x: Row) => x.minutes_id === v.id)
                    .map((x: Row) => (
                      <p className="small-copy muted" key={x.id}>
                        {x.recipient_name}: <Badge status={x.status} />
                        {x.comment && ' · ' + x.comment}
                      </p>
                    ))}
                </div>
              ))}
            </section>
          )}
        </>
      )}
      {tab === 'acoes' && (
        <>
          <section className="panel">
            <div className="section-head">
              <h2>Decisões confirmadas</h2>
              <span className="count">{data.decisions.length}</span>
            </div>
            {data.decisions.length ? (
              data.decisions.map((d: Row) => (
                <div className="decision-item" key={d.id} id={d.id}>
                  <CheckCheck size={19} />
                  <div>
                    <h3>{d.description}</h3>
                    {d.evidence && <blockquote>{d.evidence}</blockquote>}
                  </div>
                </div>
              ))
            ) : (
              <Empty
                title="Decisões que ficam registradas"
                description="As decisões entram no histórico depois que a ata é revisada e finalizada."
              />
            )}
          </section>
          <section className="panel section-gap">
            <div className="section-head">
              <h2>Tarefas e próximos passos</h2>
              <span className="count">{data.tasks.length}</span>
            </div>
            {m.status !== 'accepted' && data.tasks.length > 0 && (
              <p className="notice">
                As tarefas já podem ser acompanhadas. A ata ainda não recebeu
                todos os aceites.
              </p>
            )}
            {data.tasks.length ? (
              data.tasks.map((t: Row) => (
                <div className="work-row" key={t.id} id={t.id}>
                  <div className="work-main">
                    <h3>{t.description}</h3>
                    <p className="muted small-copy">
                      {t.assignee_name || 'Responsável a definir'} ·{' '}
                      {dateOnly(t.due_date)}
                    </p>
                    {t.evidence && (
                      <details>
                        <summary>Trecho de origem</summary>
                        <blockquote>{t.evidence}</blockquote>
                      </details>
                    )}
                  </div>
                  <select
                    aria-label={'Situação: ' + t.description}
                    disabled={
                      a.busy ||
                      !(
                        editable ||
                        data.participants.find(
                          (p: Row) => p.id === t.assignee_id,
                        )?.email === c.user.email
                      )
                    }
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
                </div>
              ))
            ) : (
              <Empty
                title="O próximo passo começa com um acordo"
                description="As tarefas confirmadas na ata aparecerão aqui com responsáveis e prazos."
              />
            )}
          </section>
        </>
      )}
      {tab === 'historico' && (
        <div className="split-layout">
          <section className="panel">
            <h2>Histórico da reunião</h2>
            <div className="timeline">
              {data.events.map((e: Row) => (
                <div key={e.id}>
                  <i />
                  <h3>{e.action}</h3>
                  <p>
                    {e.actor} · {dateTime(e.created_at, c.org.timezone)}
                  </p>
                </div>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>Convites e documentos enviados</h2>
            {!data.deliveries.length ? (
              <div className="quiet-empty">Nenhum envio registrado.</div>
            ) : (
              data.deliveries.map((d: Row) => (
                <div className="delivery-row" key={d.id}>
                  <div className="section-head">
                    <h3>
                      {d.kind === 'invitation' ? 'Convite' : 'Ata para aceite'}
                    </h3>
                    <Badge status={d.status} />
                  </div>
                  <p className="muted small-copy">
                    {d.recipient} · {dateTime(d.created_at, c.org.timezone)}
                  </p>
                  {d.error && <p className="error-text">{d.error}</p>}
                  {editable && d.status === 'test' && (
                    <button
                      className="text-link"
                      onClick={() =>
                        a.act(async () => {
                          const r = await api(
                            'deliveries/' + d.id + '/local',
                            {},
                            c.orgId,
                          );
                          setLocalUrl(r.url);
                        })
                      }
                    >
                      Obter link deste e-mail de teste <ArrowRight size={14} />
                    </button>
                  )}
                  {editable && d.status === 'failed' && (
                    <Btn
                      secondary
                      busy={a.busy}
                      onClick={() =>
                        a.act(async () => {
                          await send(
                            'deliveries/' + d.id + '/retry',
                            {},
                            c.orgId,
                          );
                          await load();
                        })
                      }
                    >
                      Retomar envio
                    </Btn>
                  )}
                </div>
              ))
            )}
            {localUrl && (
              <div className="local-box">
                <strong>E-mail de teste</strong>
                <p>Este link não foi enviado externamente.</p>
                <a href={localUrl} target="_blank" rel="noreferrer">
                  Abrir link de teste →
                </a>
              </div>
            )}
          </section>
        </div>
      )}
      {modal === 'invite' && (
        <Modal title="Convidar participantes" onClose={() => setModal('')}>
          <p>
            Enviar a pauta, o objetivo e os detalhes da reunião para{' '}
            {data.participants.length} participantes.
          </p>
          <ul className="recipient-list">
            {data.participants.map((p: Row) => (
              <li key={p.id}>
                {p.name}
                <span>{p.email}</span>
              </li>
            ))}
          </ul>
          <Btn
            disabled={!data.participants.length}
            busy={a.busy}
            onClick={() =>
              a.act(
                async () => {
                  await send('meetings/' + m.id + '/invite', {}, c.orgId);
                  setModal('');
                  await load();
                },
                c.integrations.test
                  ? 'Convites disponíveis no histórico como teste local.'
                  : 'Convites encaminhados para envio.',
              )
            }
          >
            <Send size={16} />
            Enviar convites
          </Btn>
        </Modal>
      )}
      {modal === 'finalize' && (
        <Modal
          title="Finalizar esta versão da ata"
          onClose={() => setModal('')}
        >
          <p>
            Esta versão registrará{' '}
            <strong>{draft.decisions.length} decisões</strong> e{' '}
            <strong>{draft.tasks.length} tarefas</strong>. Revisões só poderão
            ser abertas antes do envio para aceite.
          </p>
          {draft.uncertainties.length > 0 && (
            <p className="notice">
              Há {draft.uncertainties.length} pontos de confirmação registrados.
              Eles permanecerão visíveis no documento.
            </p>
          )}
          <div className="button-row">
            <Btn secondary onClick={() => setModal('')}>
              Voltar à revisão
            </Btn>
            <Btn
              busy={a.busy}
              onClick={() =>
                a.act(async () => {
                  const r = await saveCurrent();
                  await send(
                    'meetings/' + m.id + '/finalize',
                    { revision: r.revision },
                    c.orgId,
                  );
                  setModal('');
                  await load();
                }, 'Ata finalizada. Decisões e tarefas registradas.')
              }
            >
              <Check size={16} />
              Conferi e quero finalizar
            </Btn>
          </div>
          <ErrorNotice message={a.error} />
        </Modal>
      )}
      {modal === 'revise' && (
        <Modal title="Abrir nova revisão" onClose={() => setModal('')}>
          <p>
            A versão atual será preservada. As tarefas existentes manterão seu
            progresso.
          </p>
          <Btn
            busy={a.busy}
            onClick={() =>
              a.act(async () => {
                await send(
                  'meetings/' + m.id + '/revise',
                  { revision: m.revision },
                  c.orgId,
                );
                dirty.current = false;
                setIsDirty(false);
                setModal('');
                await load();
              })
            }
          >
            Abrir revisão
          </Btn>
        </Modal>
      )}
      {modal === 'send' && (
        <Modal
          title={'Enviar versão ' + m.version + ' para aceite'}
          onClose={() => setModal('')}
        >
          <p>
            Escolha os destinatários. O aceite de todos os selecionados será
            necessário. Destinatários já incluídos continuam obrigatórios.
          </p>
          <div className="participant-picker">
            {data.participants.map((p: Row) => (
              <label className="check-label" key={p.id}>
                <input
                  type="checkbox"
                  checked={recipients.includes(p.id)}
                  onChange={(e) =>
                    setRecipients(
                      e.target.checked
                        ? [...recipients, p.id]
                        : recipients.filter((x) => x !== p.id),
                    )
                  }
                />
                {p.name}
                <span className="muted">{p.email}</span>
              </label>
            ))}
          </div>
          <Btn
            disabled={!recipients.length}
            busy={a.busy}
            onClick={() =>
              a.act(
                async () => {
                  await send(
                    'meetings/' + m.id + '/send',
                    { participantIds: recipients },
                    c.orgId,
                  );
                  setModal('');
                  await load();
                },
                c.integrations.test
                  ? 'Links de aceite disponíveis no histórico como teste local.'
                  : 'Ata encaminhada para aceite.',
              )
            }
          >
            <Send size={16} />
            Enviar esta versão
          </Btn>
          <ErrorNotice message={a.error} />
        </Modal>
      )}
      {modal === 'candidate' && candidate && (
        <Modal
          title="Conferir resultado do processamento"
          onClose={() => setModal('')}
        >
          <p className="notice">
            Incorporar este resultado substituirá o rascunho atual. Versões
            finalizadas permanecem preservadas. Tarefas com a mesma descrição
            mantêm sua identidade; confira mudanças de redação.
          </p>
          <MinutesBody content={{ draft: JSON.parse(candidate.result) }} />
          {reviewed ? (
            <p className="notice">
              Abra uma nova revisão na aba Ata antes de incorporar este
              resultado.
            </p>
          ) : (
            <Btn
              busy={a.busy}
              onClick={() =>
                a.act(async () => {
                  await send(
                    'jobs/' + candidate.id + '/apply',
                    { revision: m.revision },
                    c.orgId,
                  );
                  dirty.current = false;
                  setIsDirty(false);
                  setModal('');
                  await load();
                  changeTab('ata');
                }, 'Resultado incorporado. Revise antes de finalizar.')
              }
            >
              Incorporar ao rascunho
            </Btn>
          )}
          <ErrorNotice message={a.error} />
        </Modal>
      )}
    </>
  );
}
function DraftEditor({
  draft,
  onChange,
  participants,
  disabled,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  participants: Row[];
  disabled: boolean;
}) {
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    onChange({ ...draft, [key]: value });
  return (
    <fieldset className="draft-editor" disabled={disabled}>
      <label>
        Resumo da reunião
        <textarea
          rows={5}
          value={draft.summary}
          maxLength={20000}
          onChange={(e) => update('summary', e.target.value)}
          placeholder="Registre o contexto e os principais resultados da conversa."
        />
      </label>
      <div>
        <div className="section-head">
          <h3>Assuntos discutidos</h3>
          <Btn
            secondary
            onClick={() => update('topics', [...draft.topics, ''])}
          >
            <Plus size={14} />
            Assunto
          </Btn>
        </div>
        {draft.topics.map((t, i) => (
          <div className="editable-line" key={i}>
            <textarea
              aria-label={'Assunto ' + (i + 1)}
              rows={2}
              value={t}
              onChange={(e) =>
                update(
                  'topics',
                  draft.topics.map((x, j) => (i === j ? e.target.value : x)),
                )
              }
            />
            <button
              className="icon-btn"
              aria-label="Remover assunto"
              onClick={() =>
                update(
                  'topics',
                  draft.topics.filter((_, j) => j !== i),
                )
              }
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <div>
        <div className="section-head">
          <h3>Decisões tomadas</h3>
          <Btn
            secondary
            onClick={() =>
              update('decisions', [
                ...draft.decisions,
                { id: crypto.randomUUID(), description: '', evidence: '' },
              ])
            }
          >
            <Plus size={14} />
            Decisão
          </Btn>
        </div>
        {draft.decisions.map((d, i) => (
          <div className="draft-item" key={d.id}>
            <div className="section-head">
              <span className="eyebrow">DECISÃO {i + 1}</span>
              <button
                className="icon-btn"
                aria-label="Remover decisão"
                onClick={() =>
                  update(
                    'decisions',
                    draft.decisions.filter((x) => x.id !== d.id),
                  )
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
            <label>
              O que foi decidido
              <textarea
                rows={2}
                value={d.description}
                onChange={(e) =>
                  update(
                    'decisions',
                    draft.decisions.map((x) =>
                      x.id === d.id ? { ...x, description: e.target.value } : x,
                    ),
                  )
                }
              />
            </label>
            <label>
              Trecho de origem
              <textarea
                rows={2}
                value={d.evidence}
                placeholder="Trecho da transcrição que sustenta a decisão"
                onChange={(e) =>
                  update(
                    'decisions',
                    draft.decisions.map((x) =>
                      x.id === d.id ? { ...x, evidence: e.target.value } : x,
                    ),
                  )
                }
              />
            </label>
          </div>
        ))}
      </div>
      <div>
        <div className="section-head">
          <h3>Tarefas e pendências</h3>
          <Btn
            secondary
            onClick={() =>
              update('tasks', [
                ...draft.tasks,
                {
                  id: crypto.randomUUID(),
                  description: '',
                  evidence: '',
                  assigneeId: null,
                  dueDate: null,
                },
              ])
            }
          >
            <Plus size={14} />
            Tarefa
          </Btn>
        </div>
        {draft.tasks.map((t, i) => (
          <div className="draft-item" key={t.id}>
            <div className="section-head">
              <span className="eyebrow">TAREFA {i + 1}</span>
              <button
                className="icon-btn"
                aria-label="Remover tarefa"
                onClick={() =>
                  update(
                    'tasks',
                    draft.tasks.filter((x) => x.id !== t.id),
                  )
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
            <label>
              Próximo passo
              <textarea
                rows={2}
                value={t.description}
                onChange={(e) =>
                  update(
                    'tasks',
                    draft.tasks.map((x) =>
                      x.id === t.id ? { ...x, description: e.target.value } : x,
                    ),
                  )
                }
              />
            </label>
            <div className="form-grid">
              <label>
                Responsável
                <select
                  value={t.assigneeId || ''}
                  onChange={(e) =>
                    update(
                      'tasks',
                      draft.tasks.map((x) =>
                        x.id === t.id
                          ? { ...x, assigneeId: e.target.value || null }
                          : x,
                      ),
                    )
                  }
                >
                  <option value="">A definir</option>
                  {participants.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Prazo
                <input
                  type="date"
                  value={t.dueDate || ''}
                  onChange={(e) =>
                    update(
                      'tasks',
                      draft.tasks.map((x) =>
                        x.id === t.id
                          ? { ...x, dueDate: e.target.value || null }
                          : x,
                      ),
                    )
                  }
                />
              </label>
            </div>
            <label>
              Trecho de origem
              <textarea
                rows={2}
                value={t.evidence}
                placeholder="Trecho que confirma a tarefa e a atribuição"
                onChange={(e) =>
                  update(
                    'tasks',
                    draft.tasks.map((x) =>
                      x.id === t.id ? { ...x, evidence: e.target.value } : x,
                    ),
                  )
                }
              />
            </label>
          </div>
        ))}
      </div>
      <div>
        <div className="section-head">
          <h3>Pontos a confirmar</h3>
          <Btn
            secondary
            onClick={() =>
              update('uncertainties', [...draft.uncertainties, ''])
            }
          >
            <Plus size={14} />
            Ponto
          </Btn>
        </div>
        {draft.uncertainties.map((t, i) => (
          <div className="editable-line" key={i}>
            <textarea
              aria-label={'Ponto a confirmar ' + (i + 1)}
              rows={2}
              value={t}
              onChange={(e) =>
                update(
                  'uncertainties',
                  draft.uncertainties.map((x, j) =>
                    i === j ? e.target.value : x,
                  ),
                )
              }
            />
            <button
              className="icon-btn"
              aria-label="Remover ponto a confirmar"
              onClick={() =>
                update(
                  'uncertainties',
                  draft.uncertainties.filter((_, j) => j !== i),
                )
              }
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </fieldset>
  );
}
export function MinutesBody({ content }: { content: Row }) {
  const draft: Draft = content.draft;
  return (
    <article className="minutes-body">
      {content.meeting && (
        <header>
          <span className="eyebrow">ATA DE REUNIÃO</span>
          <h1>{content.meeting.title}</h1>
          <p>
            {content.organization?.name} ·{' '}
            {dateTime(
              content.meeting.scheduledAt,
              content.organization?.timezone,
            )}
          </p>
          {content.meeting.objective && (
            <p>
              <strong>Objetivo:</strong> {content.meeting.objective}
            </p>
          )}
          {content.meeting.location && (
            <p>
              <strong>Local:</strong> {content.meeting.location}
            </p>
          )}
          {content.participants && (
            <p>
              <strong>Participantes:</strong>{' '}
              {content.participants
                .map(
                  (p: Row) =>
                    p.name +
                    (p.present
                      ? ' (presente)'
                      : content.attendanceConfirmed
                        ? ' (ausente)'
                        : ' (presença não confirmada)'),
                )
                .join(', ')}
            </p>
          )}
        </header>
      )}
      <section>
        <h2>Resumo</h2>
        <p>{draft.summary}</p>
      </section>
      <section>
        <h2>Assuntos discutidos</h2>
        {draft.topics.length ? (
          <ul>
            {draft.topics.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nenhum assunto registrado separadamente.</p>
        )}
      </section>
      <section>
        <h2>Decisões</h2>
        {draft.decisions.length ? (
          <ol>
            {draft.decisions.map((d) => (
              <li key={d.id}>
                <strong>{d.description}</strong>
                {d.evidence && <blockquote>{d.evidence}</blockquote>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">Nenhuma decisão registrada.</p>
        )}
      </section>
      <section>
        <h2>Tarefas e próximos passos</h2>
        {draft.tasks.length ? (
          <ol>
            {draft.tasks.map((t) => (
              <li key={t.id}>
                <strong>{t.description}</strong>
                <p>
                  Responsável:{' '}
                  {content.participants?.find((p: Row) => p.id === t.assigneeId)
                    ?.name || 'A definir'}{' '}
                  · Prazo: {dateOnly(t.dueDate || undefined)}
                </p>
                {t.evidence && <blockquote>{t.evidence}</blockquote>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">Nenhuma tarefa registrada.</p>
        )}
      </section>
      {draft.uncertainties.length > 0 && (
        <section>
          <h2>Pontos a confirmar</h2>
          <ul>
            {draft.uncertainties.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
export function PrintView(c: Common & { meetingId: string }) {
  const [data, setData] = useState<Row | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    api('meetings/' + c.meetingId, {}, c.orgId)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [c.orgId, c.meetingId]);
  if (!data)
    return (
      <main className="standalone">
        <ErrorNotice message={error} />
        <p>Preparando documento…</p>
      </main>
    );
  const params = new URLSearchParams(window.location.search);
  const agenda = params.get('type') === 'agenda';
  const v = params.get('version')
    ? data.minutes.find((x: Row) => x.number === Number(params.get('version')))
    : data.minutes[0];
  return (
    <main className="print-page">
      <div className="print-toolbar">
        <a href={'/reunioes/' + c.meetingId}>
          <ArrowLeft size={16} />
          Voltar à reunião
        </a>
        <Btn onClick={() => window.print()}>
          <Printer size={17} />
          Imprimir / Salvar PDF
        </Btn>
      </div>
      <section className="print-paper">
        {agenda ? (
          <>
            <span className="eyebrow">PAUTA DA REUNIÃO</span>
            <h1>{data.meeting.title}</h1>
            <p>
              {c.org.name} ·{' '}
              {dateTime(data.meeting.scheduled_at, c.org.timezone)}
            </p>
            <p>
              <strong>Objetivo:</strong> {data.meeting.objective}
            </p>
            <p>
              <strong>Local:</strong> {data.meeting.location || 'A combinar'} ·{' '}
              {data.meeting.duration} minutos
            </p>
            <p>
              <strong>Participantes:</strong>{' '}
              {data.participants.map((p: Row) => p.name).join(', ')}
            </p>
            <h2>Pauta</h2>
            <ol>
              {data.meeting.agenda.map((x: Row) => (
                <li key={x.id}>
                  {x.title}
                  {x.taskId && ' (retomada de pendência)'}
                </li>
              ))}
            </ol>
          </>
        ) : v ? (
          <>
            <MinutesBody content={v.content} />
            <footer className="print-footer">
              Anota Aí · Versão {v.number} · Finalizada em{' '}
              {dateTime(v.created_at, c.org.timezone)}
              <h3>Manifestações registradas</h3>
              {data.acceptances
                .filter((a: Row) => a.minutes_id === v.id)
                .map((a: Row) => (
                  <p key={a.id}>
                    {a.recipient_name} ·{' '}
                    {a.status === 'accepted'
                      ? 'Aceite simples'
                      : a.status === 'changes_requested'
                        ? 'Ajustes solicitados'
                        : 'Pendente'}
                    {a.responded_at
                      ? ' · ' + dateTime(a.responded_at, c.org.timezone)
                      : ''}
                    {a.comment ? ' · ' + a.comment : ''}
                  </p>
                ))}
            </footer>
          </>
        ) : (
          <p>Esta versão de ata não foi encontrada.</p>
        )}
      </section>
    </main>
  );
}
export function Acceptance() {
  const [data, setData] = useState<Row | null>(null),
    [comment, setComment] = useState('');
  const a = useAction();
  const load = () =>
    api(
      'acceptance?token=' +
        new URLSearchParams(window.location.search).get('token'),
    ).then(setData);
  useEffect(() => {
    load().catch(a.setError);
  }, [a.setError]);
  return (
    <main className="acceptance-page">
      <div className="acceptance-brand">
        <FileText size={22} />
        <strong>Anota Aí</strong>
        <span>Aceite simples de ata</span>
      </div>
      <ErrorNotice message={a.error} />
      {data && (
        <>
          <div className="acceptance-heading">
            <div>
              <span className="eyebrow">DOCUMENTO COMPARTILHADO</span>
              <h2>Olá, {data.recipient}.</h2>
              <p>Leia a versão {data.version} e registre sua manifestação.</p>
            </div>
            <Badge status={data.status} />
          </div>
          {data.superseded && (
            <p className="notice">
              Existe uma versão mais recente desta ata. Solicite ao organizador
              um link atualizado.
            </p>
          )}
          <section className="panel minutes-paper">
            <MinutesBody content={data.content} />
          </section>
          {data.status === 'pending' && !data.superseded ? (
            <section className="panel section-gap">
              <h2>Sua manifestação</h2>
              <p className="muted small-copy">
                Seu aceite ficará associado a esta versão. Abrir o documento não
                registra uma resposta.
              </p>
              <label>
                Comentário ou ajustes solicitados
                <textarea
                  value={comment}
                  maxLength={5000}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Descreva aqui se algo precisa ser corrigido."
                />
              </label>
              <div className="button-row">
                <Btn
                  secondary
                  disabled={!comment.trim()}
                  busy={a.busy}
                  onClick={() =>
                    a.act(async () => {
                      await send(
                        'acceptance?token=' +
                          new URLSearchParams(window.location.search).get(
                            'token',
                          ),
                        { status: 'changes_requested', comment },
                      );
                      await load();
                    })
                  }
                >
                  Solicitar ajustes
                </Btn>
                <Btn
                  busy={a.busy}
                  onClick={() =>
                    a.act(async () => {
                      await send(
                        'acceptance?token=' +
                          new URLSearchParams(window.location.search).get(
                            'token',
                          ),
                        { status: 'accepted', comment },
                      );
                      await load();
                    })
                  }
                >
                  <Check size={17} />
                  Li e aceito esta versão
                </Btn>
              </div>
            </section>
          ) : (
            data.respondedAt && (
              <p className="notice">
                Manifestação registrada em{' '}
                {dateTime(
                  data.respondedAt,
                  data.content.organization?.timezone,
                )}
                .{data.comment && ' Comentário: ' + data.comment}
              </p>
            )
          )}
        </>
      )}
      <footer>Aceite simples · O acesso a este documento é individual.</footer>
    </main>
  );
}
