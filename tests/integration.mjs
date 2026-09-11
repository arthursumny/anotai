import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const origin = process.env.TEST_BASE_URL || 'http://localhost:3000';
let assertions = 0;
function check(value, message) {
  assert.ok(value, message);
  assertions++;
}
async function call(
  path,
  { method = 'GET', body, cookie, org, expected = 200, raw = false, ip } = {},
) {
  const headers = {
    Origin: origin,
    ...(cookie ? { Cookie: cookie } : {}),
    ...(org ? { 'x-organization-id': org } : {}),
    ...(ip ? { 'cf-connecting-ip': ip } : {}),
  };
  if (body !== undefined && !(body instanceof FormData))
    headers['Content-Type'] = 'application/json';
  // eslint-disable-next-line unicorn/no-invalid-fetch-options -- GET requests pass an undefined body; mutations supply JSON or FormData.
  const r = await fetch(origin + '/api/' + path, {
    method,
    headers,
    // eslint-disable-next-line unicorn/no-invalid-fetch-options -- The helper passes undefined on GET.
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  const responseText = raw ? null : await r.text();
  let data;
  if (raw) data = await r.arrayBuffer();
  else {
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { error: responseText };
    }
  }
  assert.equal(
    r.status,
    expected,
    `${method} ${path.split('?')[0]}: ${JSON.stringify(data)}`,
  );
  assertions++;
  return { data, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
async function login(tag) {
  const email = `${tag}-${randomUUID()}@example.test`;
  const ip = `test-${randomUUID()}`;
  const { data } = await call('auth/request', {
    method: 'POST',
    body: { email, name: tag },
    ip,
  });
  const token = new URL(data.localLink).searchParams.get('token');
  const { cookie } = await call('auth/verify', {
    method: 'POST',
    body: { token },
  });
  const returning = await call('auth/request', {
    method: 'POST',
    body: { email },
    ip,
  });
  check(!!returning.data.localLink, 'Existing user logs in with email only');
  return { email, cookie, token };
}
function localSql(sql) {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
  execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'DB',
      '--local',
      '--config',
      'wrangler.local.json',
      '--command',
      sql,
    ],
    { stdio: 'pipe' },
  );
}
async function main() {
  const mode = (await call('me')).data;
  assert.equal(
    mode.integrations.test,
    true,
    'Integration tests require a LOCAL test environment.',
  );
  const alice = await login('Ana'),
    bob = await login('Bruno');
  await call('auth/verify', {
    method: 'POST',
    body: { token: alice.token },
    expected: 410,
  });
  await call('auth/verify', {
    method: 'POST',
    body: { token: 'a'.repeat(64) },
    expected: 410,
  });
  await call('meetings', { expected: 401 });
  const orgA = (
    await call('organizations', {
      method: 'POST',
      cookie: alice.cookie,
      body: {
        name: 'Piloto A · teste automatizado',
        business: 'Consultoria de gestão',
      },
    })
  ).data.id;
  const orgB = (
    await call('organizations', {
      method: 'POST',
      cookie: bob.cookie,
      body: { name: 'Piloto B · isolamento', business: 'Outra empresa' },
    })
  ).data.id;
  const A = { cookie: alice.cookie, org: orgA };
  const B = { cookie: bob.cookie, org: orgB };
  await call('meetings', { cookie: alice.cookie, org: orgB, expected: 409 });
  const pA = (await call('participants', A)).data[0];
  const pB = (await call('participants', B)).data[0];
  const guest = (
    await call('participants', {
      ...A,
      method: 'POST',
      body: {
        name: 'Convidada externa',
        email: `guest-${randomUUID()}@example.test`,
        kind: 'external',
        role: 'member',
      },
    })
  ).data.id;
  const meeting = {
    title: 'Alinhamento comercial',
    objective: 'Decidir proposta e acompanhar retorno',
    scheduledAt: '2026-09-10T13:00:00.000Z',
    duration: 60,
    location: 'Sala 1',
    topic: 'Comercial',
    agenda: [{ id: randomUUID(), title: 'Revisar proposta', taskId: null }],
    participantIds: [pA.id, guest],
  };
  await call('meetings', {
    ...A,
    method: 'POST',
    body: { ...meeting, participantIds: [pB.id] },
    expected: 400,
  });
  const mid = (await call('meetings', { ...A, method: 'POST', body: meeting }))
    .data.id;
  await call('meetings/' + mid, { ...B, expected: 404 });
  const first = (await call('meetings/' + mid, A)).data;
  check(first.participants.length === 2, 'Persist participants');
  await call('meetings/' + mid + '/invite', { ...A, method: 'POST', body: {} });
  await call('meetings/' + mid + '/invite', { ...A, method: 'POST', body: {} });
  check(
    (await call('meetings/' + mid, A)).data.deliveries.length === 2,
    'Deduplicate invitations',
  );
  const text =
    'Decidimos aprovar a proposta comercial. Ana vai retornar ao cliente. Ainda não foi definido um prazo.';
  const key = randomUUID();
  await call('meetings/' + mid + '/process', {
    ...A,
    method: 'POST',
    body: { requestKey: randomUUID(), text },
    expected: 400,
  });
  await call('meetings/' + mid + '/presence', {
    ...A,
    method: 'PATCH',
    body: { participantId: pA.id, present: true },
  });
  const job = (
    await call('meetings/' + mid + '/process', {
      ...A,
      method: 'POST',
      body: { requestKey: key, text, attendanceConfirmed: true },
    })
  ).data;
  check(job.state === 'completed', 'Local text processing completes honestly');
  const same = (
    await call('meetings/' + mid + '/process', {
      ...A,
      method: 'POST',
      body: { requestKey: key, text, attendanceConfirmed: true },
    })
  ).data;
  check(same.id === job.id, 'Deduplicate processing');
  await call('meetings/' + mid + '/process', {
    ...A,
    method: 'POST',
    body: { requestKey: randomUUID(), text, attendanceConfirmed: true },
    expected: 409,
  });
  await call('meetings/' + mid, {
    ...A,
    method: 'PATCH',
    body: { ...meeting, revision: 0 },
    expected: 409,
  });
  await call('meetings/' + mid + '/presence', {
    ...A,
    method: 'PATCH',
    body: { participantId: pA.id, present: false },
    expected: 409,
  });

  await call('jobs/' + job.id, { ...B, expected: 404 });
  await call('jobs/' + job.id + '/apply', {
    ...A,
    method: 'POST',
    body: { revision: 0 },
  });
  await call('jobs/' + job.id + '/apply', {
    ...A,
    method: 'POST',
    body: { revision: 1 },
    expected: 409,
  });
  const taskId = randomUUID(),
    decisionId = randomUUID();
  const draft = {
    summary: 'A equipe aprovou a proposta comercial.',
    topics: ['Proposta comercial'],
    decisions: [
      {
        id: decisionId,
        description: 'Aprovar a proposta',
        evidence: 'Decidimos aprovar a proposta comercial.',
      },
    ],
    tasks: [
      {
        id: taskId,
        description: 'Retornar ao cliente',
        evidence: 'Ana vai retornar ao cliente.',
        assigneeId: pA.id,
        dueDate: null,
      },
    ],
    uncertainties: ['Prazo não definido na reunião.'],
  };
  await call('meetings/' + mid + '/draft', {
    ...A,
    method: 'PATCH',
    body: {
      revision: 1,
      draft: { ...draft, tasks: [{ ...draft.tasks[0], assigneeId: pB.id }] },
    },
    expected: 400,
  });
  const edit = (
    await call('meetings/' + mid + '/draft', {
      ...A,
      method: 'PATCH',
      body: { revision: 1, draft },
    })
  ).data;
  await call('meetings/' + mid + '/draft', {
    ...A,
    method: 'PATCH',
    body: { revision: 1, draft },
    expected: 409,
  });
  const _v1 = (
    await call('meetings/' + mid + '/finalize', {
      ...A,
      method: 'POST',
      body: { revision: edit.revision },
    })
  ).data;
  await call('meetings/' + mid + '/finalize', {
    ...A,
    method: 'POST',
    body: { revision: edit.revision },
    expected: 409,
  });
  const work = (await call('work', A)).data;
  check(
    work.tasks.length === 1 && work.decisions.length === 1,
    'Finalization creates decisions and tasks',
  );
  check(
    (await call('work', B)).data.tasks.length === 0,
    'Isolate institutional memory',
  );
  await call('tasks/' + taskId, {
    ...B,
    method: 'PATCH',
    body: { status: 'done' },
    expected: 404,
  });
  await call('tasks/' + taskId, {
    ...A,
    method: 'PATCH',
    body: { status: 'done' },
  });
  let detail = (await call('meetings/' + mid, A)).data;
  await call('meetings/' + mid + '/revise', {
    ...A,
    method: 'POST',
    body: { revision: detail.meeting.revision },
  });
  detail = (await call('meetings/' + mid, A)).data;
  draft.summary = 'Resumo corrigido e confirmado.';
  draft.tasks[0].description = 'Retornar ao cliente com a proposta aprovada';
  const saved = (
    await call('meetings/' + mid + '/draft', {
      ...A,
      method: 'PATCH',
      body: { revision: detail.meeting.revision, draft },
    })
  ).data;
  await call('meetings/' + mid + '/finalize', {
    ...A,
    method: 'POST',
    body: { revision: saved.revision },
  });
  detail = (await call('meetings/' + mid, A)).data;
  check(detail.minutes.length === 2, 'Preserve version history');
  check(
    detail.minutes[1].content.draft.summary ===
      'A equipe aprovou a proposta comercial.',
    'Finalized content is immutable',
  );
  check(
    detail.tasks.length === 1 && detail.tasks[0].status === 'done',
    'Keep task identity and progress',
  );
  await call('meetings/' + mid + '/send', {
    ...A,
    method: 'POST',
    body: { participantIds: [pA.id, guest] },
  });
  await call('meetings/' + mid + '/send', {
    ...A,
    method: 'POST',
    body: { participantIds: [pA.id, guest] },
  });
  detail = (await call('meetings/' + mid, A)).data;
  check(detail.acceptances.length === 2, 'Deduplicate acceptance requests');
  check(
    detail.meeting.status === 'awaiting_acceptance',
    'Await all required recipients',
  );
  const deliveries = detail.deliveries.filter((x) => x.kind === 'minutes');
  const links = [];
  for (const d of deliveries) {
    const { data } = await call('deliveries/' + d.id + '/local', A);
    links.push(new URL(data.url).searchParams.get('token'));
    await call('deliveries/' + d.id + '/local', { ...B, expected: 404 });
  }
  const before = await call('acceptance?token=' + links[0]);
  check(before.data.status === 'pending', 'GET does not accept');
  check(!('token_hash' in before.data), 'Do not disclose token hashes');
  await call('acceptance?token=' + links[0], {
    method: 'POST',
    body: { status: 'accepted', comment: '' },
  });
  check(
    (await call('meetings/' + mid, A)).data.meeting.status ===
      'awaiting_acceptance',
    'One acceptance does not complete the cycle',
  );
  await call('acceptance?token=' + links[0], {
    method: 'POST',
    body: { status: 'accepted' },
    expected: 409,
  });
  await call('acceptance?token=' + links[1], {
    method: 'POST',
    body: { status: 'changes_requested', comment: '' },
    expected: 400,
  });
  await call('meetings/' + mid + '/revise', {
    ...A,
    method: 'POST',
    body: { revision: detail.meeting.revision },
    expected: 409,
  });
  detail = (await call('meetings/' + mid, A)).data;
  const pending = detail.acceptances.find(
    (x) => x.minutes_id === detail.minutes[0].id && x.status === 'pending',
  );
  const oldDelivery = detail.deliveries.find(
    (x) => x.kind === 'minutes' && x.recipient === pending.recipient_email,
  );
  const oldLink = (await call('deliveries/' + oldDelivery.id + '/local', A))
    .data.url;
  await call('acceptances/' + pending.id + '/resend', {
    ...A,
    method: 'POST',
    body: {},
  });
  await call('acceptance?token=' + new URL(oldLink).searchParams.get('token'), {
    expected: 404,
  });
  detail = (await call('meetings/' + mid, A)).data;
  const newLink = (
    await call('deliveries/' + detail.deliveries[0].id + '/local', A)
  ).data.url;
  await call('acceptance?token=' + new URL(newLink).searchParams.get('token'), {
    method: 'POST',
    body: { status: 'accepted', comment: '' },
  });
  check(
    (await call('meetings/' + mid, A)).data.meeting.status === 'accepted',
    'All required acceptances finalize the cycle',
  );
  await call('meetings/' + mid + '/send', {
    ...A,
    method: 'POST',
    body: { participantIds: [pA.id, guest] },
    expected: 409,
  });
  await call('meetings/' + mid + '/revise', {
    ...A,
    method: 'POST',
    body: { revision: detail.meeting.revision },
    expected: 409,
  });
  await call('acceptances/' + pending.id + '/resend', {
    ...A,
    method: 'POST',
    body: {},
    expected: 409,
  });
  const next = (
    await call('meetings', {
      ...A,
      method: 'POST',
      body: {
        ...meeting,
        title: 'Próxima reunião comercial',
        agenda: [
          { id: randomUUID(), title: 'Retomar contato com cliente', taskId },
        ],
      },
    })
  ).data.id;
  check(
    (await call('meetings/' + next, A)).data.meeting.agenda[0].taskId ===
      taskId,
    'Link next meeting to institutional memory',
  );
  const audioMeeting = (
    await call('meetings', { ...A, method: 'POST', body: meeting })
  ).data.id;
  const fd = new FormData();
  const wav = new Uint8Array(48);
  wav.set(new TextEncoder().encode('RIFF'), 0);
  wav.set(new TextEncoder().encode('WAVE'), 8);
  fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'teste.wav');
  const fid = (
    await call('meetings/' + audioMeeting + '/files', {
      ...A,
      method: 'POST',
      body: fd,
    })
  ).data.id;
  await call('meetings/' + mid + '/files', {
    ...A,
    method: 'POST',
    body: fd,
    expected: 409,
  });
  await call('meetings/' + audioMeeting + '/files', {
    ...A,
    method: 'POST',
    body: fd,
    expected: 409,
  });
  await call('meetings/' + audioMeeting, {
    ...A,
    method: 'PATCH',
    body: { ...meeting, revision: 0 },
    expected: 409,
  });
  await call('files/' + fid, { ...B, expected: 404 });
  await call('files/' + fid, { ...A, raw: true });
  await call('meetings/' + audioMeeting + '/process', {
    ...A,
    method: 'POST',
    body: { requestKey: randomUUID(), fileId: fid, attendanceConfirmed: true },
    expected: 503,
  });
  const big = new FormData();
  big.append(
    'file',
    new Blob([new Uint8Array(21 * 1024 * 1024)], { type: 'audio/wav' }),
    'grande.wav',
  );
  await call('meetings/' + mid + '/files', {
    ...A,
    method: 'POST',
    body: big,
    expected: 413,
  });
  await call('meetings/' + mid + '/files', {
    ...B,
    method: 'POST',
    body: new FormData(),
    expected: 404,
  });
  const evil = await fetch(origin + '/api/meetings', {
    method: 'POST',
    headers: {
      Origin: 'https://other.test',
      Cookie: alice.cookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(meeting),
  });
  check(evil.status === 403, 'Reject cross-origin mutations');
  // A member sees only participating/organized meetings, and cannot manage people.
  const staff = await login('Membro');
  const staffId = (
    await call('participants', {
      ...A,
      method: 'POST',
      body: {
        name: 'Membro',
        email: staff.email,
        kind: 'internal',
        role: 'member',
      },
    })
  ).data.id;
  const S = { cookie: staff.cookie, org: orgA };
  check(
    (await call('meetings', S)).data.length === 0,
    'A member cannot list unshared meetings',
  );
  await call('meetings/' + mid, { ...S, expected: 403 });
  await call('participants', {
    ...S,
    method: 'POST',
    body: {
      name: 'Pessoa',
      email: 'no-access@example.test',
      kind: 'external',
      role: 'member',
    },
    expected: 403,
  });
  const shared = (
    await call('meetings', {
      ...A,
      method: 'POST',
      body: {
        ...meeting,
        title: 'Reunião compartilhada com membro',
        participantIds: [pA.id, staffId],
      },
    })
  ).data.id;
  const sharedData = (await call('meetings/' + shared, S)).data;
  check(
    sharedData.canEdit === false,
    'Participation does not grant edit rights',
  );
  await call('meetings/' + shared + '/draft', {
    ...S,
    method: 'PATCH',
    body: { revision: 0, draft },
    expected: 403,
  });
  // Institutional memory: real HTTP + local D1, with external AI disabled.
  await call('memory/chats', { expected: 401 });
  const search = (
    await call('memory/search', {
      ...A,
      method: 'POST',
      body: { query: 'comercial' },
    })
  ).data;
  check(
    search.sources.some((x) => x.id === 'task:' + taskId),
    'Search returns confirmed tasks',
  );
  check(
    search.sources.every(
      (x) => !x.href.startsWith('http') && x.href.includes('org=' + orgA),
    ),
    'Source URLs are server-owned and organization-scoped',
  );
  check(
    (
      await call('memory/search', {
        ...B,
        method: 'POST',
        body: { query: 'comercial' },
      })
    ).data.sources.length === 0,
    'Search isolates companies',
  );
  check(
    (
      await call('memory/search', {
        ...S,
        method: 'POST',
        body: { query: 'comercial' },
      })
    ).data.sources.length === 0,
    'Search hides unshared confirmed meetings',
  );
  const taskSearch = (
    await call('memory/search', {
      ...A,
      method: 'POST',
      body: {
        filters: {
          assignee: 'Ana',
          status: 'done',
          from: '2026-09-01',
          to: '2026-09-30',
        },
      },
    })
  ).data;
  check(
    taskSearch.sources.length === 1 &&
      taskSearch.sources[0].id === 'task:' + taskId,
    'Search filters owner, date and task state',
  );
  await call('memory/search', {
    ...A,
    method: 'POST',
    body: { filters: { from: '2026-02-30' } },
    expected: 400,
  });
  const chat = (await call('memory/chats', { ...A, method: 'POST', body: {} }))
    .data;
  const message = {
    requestId: randomUUID(),
    question: 'Quem ficou responsável por esta tarefa?',
    filters: { assignee: 'Ana' },
  };
  const answer = (
    await call('memory/chats/' + chat.id + '/messages', {
      ...A,
      method: 'POST',
      body: message,
    })
  ).data;
  check(
    answer.turns[0].answer.mode === 'local',
    'Local chat identifies that no AI was called',
  );
  check(
    answer.turns[0].answer.excerpts.some((x) => x.quote.includes('Ana')),
    'Answer cites stored owner',
  );
  await call('memory/chats/' + chat.id + '/messages', {
    ...A,
    method: 'POST',
    body: message,
  });
  check(
    (await call('memory/chats/' + chat.id, A)).data.turns.length === 1,
    'Retry does not duplicate saved messages',
  );
  await call('memory/chats/' + chat.id, { ...B, expected: 404 });
  await call('memory/chats/' + chat.id, { ...S, expected: 404 });
  await call('memory/chats/' + chat.id + '/messages', {
    ...S,
    method: 'POST',
    body: message,
    expected: 404,
  });
  check(
    (await call('memory/chats', S)).data.length === 0,
    'Private chat cannot be listed by another member',
  );
  const noEvidence = (
    await call('memory/chats/' + chat.id + '/messages', {
      ...A,
      method: 'POST',
      body: { requestId: randomUUID(), question: 'Projeto inexistente xzq999' },
    })
  ).data;
  check(
    noEvidence.turns.at(-1).answer.outcome === 'insufficient',
    'Unknown subject returns insufficient evidence',
  );
  // A staff-owned conversation loses access to the entire derived answer on revocation.
  const staffJob = (
    await call('meetings/' + shared + '/process', {
      ...A,
      method: 'POST',
      body: { requestKey: randomUUID(), text, attendanceConfirmed: true },
    })
  ).data;
  await call('jobs/' + staffJob.id + '/apply', {
    ...A,
    method: 'POST',
    body: { revision: 0 },
  });
  const localDrafts = (
    await call('memory/search', {
      ...S,
      method: 'POST',
      body: { filters: { includeDrafts: true } },
    })
  ).data;
  check(
    localDrafts.sources.length === 1 && localDrafts.sources[0].kind === 'draft',
    'Drafts are labeled and require opt-in',
  );
  check(
    (await call('memory/search', { ...S, method: 'POST', body: {} })).data
      .sources.length === 0,
    'Drafts are excluded by default',
  );
  const staffChat = (
    await call('memory/chats', { ...S, method: 'POST', body: {} })
  ).data;
  await call('memory/chats/' + staffChat.id + '/messages', {
    ...S,
    method: 'POST',
    body: {
      requestId: randomUUID(),
      question: 'Resuma o que discutimos',
      filters: { includeDrafts: true },
    },
  });
  localSql(
    `DELETE FROM meeting_participants WHERE meeting_id='${shared}' AND participant_id='${staffId}'`,
  );
  const revoked = (await call('memory/chats/' + staffChat.id, S)).data;
  check(
    revoked.turns[0].state === 'restricted' && revoked.turns[0].answer === null,
    'Revoked sources hide persisted answers',
  );
  const memoryOrigin = await fetch(origin + '/api/memory/chats', {
    method: 'POST',
    headers: {
      Origin: 'https://other.test',
      Cookie: A.cookie,
      'x-organization-id': orgA,
    },
  });
  check(
    memoryOrigin.status === 403,
    'Memory mutations reject cross-origin requests',
  );

  // Agenda proposals are separate from saved preparation until explicit application.
  const beforePlan = (await call('meetings/' + next, A)).data.meeting;
  const planInput = {
    requestId: randomUUID(),
    meetingId: next,
    objective: 'Revisar proposta comercial',
    subject: 'Comercial',
  };
  const plan = (
    await call('agenda-proposals', { ...A, method: 'POST', body: planInput })
  ).data;
  check(
    plan.mode === 'local' && plan.items.length > 1,
    'Local planning is labeled and uses authorized history',
  );
  check(
    JSON.stringify((await call('meetings/' + next, A)).data.meeting.agenda) ===
      JSON.stringify(beforePlan.agenda),
    'Generating does not mutate the agenda',
  );
  check(
    (await call('agenda-proposals', { ...A, method: 'POST', body: planInput }))
      .data.id === plan.id,
    'Proposal retry is idempotent',
  );
  await call('agenda-proposals/' + plan.id, { ...B, expected: 404 });
  await call('agenda-proposals/' + plan.id, { ...S, expected: 404 });
  const suggestion = plan.items.find((item) => item.taskId === taskId);
  check(!!suggestion, 'Proposal preserves source task identity');
  const selected = {
    id: randomUUID(),
    title: 'Retomar proposta aprovada — pauta revisada',
    taskId,
    origin: { proposalId: plan.id, itemId: suggestion.id },
  };
  await call('meetings/' + next, {
    ...A,
    method: 'PATCH',
    body: {
      ...meeting,
      revision: beforePlan.revision,
      agenda: [
        { ...selected, origin: { ...selected.origin, itemId: 'forged' } },
      ],
    },
    expected: 400,
  });
  await call('meetings/' + next, {
    ...A,
    method: 'PATCH',
    body: { ...meeting, revision: beforePlan.revision, agenda: [selected] },
  });
  const applied = (await call('meetings/' + next, A)).data;
  check(
    applied.meeting.agenda[0].origin.proposalId === plan.id,
    'Explicit save persists proposal provenance',
  );
  check(
    (await call('meetings/' + next + '/agenda-origins', A)).data[
      selected.id
    ].sources.some((source) => source.id === 'task:' + taskId),
    'Saved suggestions expose authorized origin links',
  );
  check(
    (await call('work', A)).data.tasks.find((task) => task.id === taskId)
      .status === 'done',
    'Proposal application preserves task progress',
  );
  await call('agenda-proposals', {
    ...A,
    method: 'POST',
    body: { ...planInput, requestId: randomUUID(), meetingId: audioMeeting },
    expected: 409,
  });
  await call('agenda-proposals', {
    ...A,
    method: 'POST',
    body: { ...planInput, requestId: randomUUID(), meetingId: mid },
    expected: 409,
  });
  const countBefore = (await call('meetings', A)).data.length;
  const chatPlan = (
    await call('memory/chats/' + chat.id + '/messages', {
      ...A,
      method: 'POST',
      body: {
        requestId: randomUUID(),
        question: 'Crie uma pauta para a reunião comercial da próxima semana',
      },
    })
  ).data;
  check(
    !!chatPlan.turns.at(-1).answer.proposal,
    'Chat produces a reviewable agenda proposal',
  );
  check(
    (await call('meetings', A)).data.length === countBefore,
    'Chat proposal does not create a meeting',
  );

  // Supporting slides persist in private R2 and require both target and source access.
  const materialInput = {
    requestId: randomUUID(),
    revision: applied.meeting.revision,
    agendaReviewed: true,
  };
  await call('meetings/' + next + '/materials', {
    ...A,
    method: 'POST',
    body: { ...materialInput, agendaReviewed: false },
    expected: 400,
  });
  const material = (
    await call('meetings/' + next + '/materials', {
      ...A,
      method: 'POST',
      body: materialInput,
    })
  ).data;
  check(
    (
      await call('meetings/' + next + '/materials', {
        ...A,
        method: 'POST',
        body: materialInput,
      })
    ).data.id === material.id,
    'Material generation deduplicates a retry',
  );
  check(
    (await call('meetings/' + next + '/materials', A)).data.length === 1,
    'Material remains linked to meeting',
  );
  const downloaded = await call(
    'meetings/' + next + '/materials/' + material.id + '?download=1',
    { ...A, raw: true },
  );
  const deck = new TextDecoder().decode(downloaded.data);
  check(
    deck.includes('Retomar proposta aprovada') &&
      deck.includes('Fonte:') &&
      deck.includes('Questões para discussão'),
    'HTML deck contains reviewed agenda, sources and discussion prompts',
  );
  check(
    !deck.includes('OPENAI') &&
      !deck.includes('Resend') &&
      !deck.includes('<script'),
    'Deck excludes provider details and executable content',
  );
  const snapshot = (
    await call(
      'meetings/' + next + '/materials/' + material.id + '?format=json',
      A,
    )
  ).data;
  check(
    snapshot.sources.some((source) => source.id === 'task:' + taskId),
    'Material snapshot preserves source task',
  );
  await call('meetings/' + next + '/materials/' + material.id, {
    ...B,
    expected: 404,
    raw: true,
  });
  await call('meetings/' + next + '/materials/' + material.id, {
    ...S,
    expected: 403,
    raw: true,
  });
  await call('meetings/' + next + '/materials', {
    ...A,
    method: 'POST',
    body: { ...materialInput, requestId: randomUUID(), revision: 999 },
    expected: 409,
  });
  // Sharing target meeting alone must not reveal private source content.
  localSql(
    `INSERT INTO meeting_participants(meeting_id,participant_id,present) VALUES('${next}','${staffId}',1)`,
  );
  check(
    (await call('meetings/' + next + '/materials', S)).data.length === 0,
    'Material list hides inaccessible source snapshots',
  );
  await call('meetings/' + next + '/materials/' + material.id, {
    ...S,
    expected: 403,
    raw: true,
  });

  // Validate expiration in the actual D1-backed endpoint.
  const expiredEmail = 'expired-' + randomUUID() + '@example.test';
  const expired = (
    await call('auth/request', {
      method: 'POST',
      body: { email: expiredEmail, name: 'Expired' },
    })
  ).data;
  localSql(
    `UPDATE auth_tokens SET expires_at='2000-01-01T00:00:00.000Z' WHERE email='${expiredEmail}'`,
  );
  await call('auth/verify', {
    method: 'POST',
    body: { token: new URL(expired.localLink).searchParams.get('token') },
    expected: 410,
  });
  localSql(
    `UPDATE acceptances SET expires_at='2000-01-01T00:00:00.000Z' WHERE id='${pending.id}'`,
  );
  await call('acceptance?token=' + new URL(newLink).searchParams.get('token'), {
    expected: 410,
  });
  const invalidAudio = new FormData();
  invalidAudio.append(
    'file',
    new Blob(['not audio'], { type: 'text/html' }),
    'fake.wav',
  );
  await call('meetings/' + mid + '/files', {
    ...A,
    method: 'POST',
    body: invalidAudio,
    expected: 415,
  });
  const nearlyMax = new FormData();
  const bytes = new Uint8Array(19 * 1024 * 1024);
  bytes.set(wav);
  nearlyMax.append(
    'file',
    new Blob([bytes], { type: 'audio/wav' }),
    '19mb.wav',
  );
  const largeMeeting = (
    await call('meetings', { ...A, method: 'POST', body: meeting })
  ).data.id;
  await call('meetings/' + largeMeeting + '/files', {
    ...A,
    method: 'POST',
    body: nearlyMax,
  });
  const raceMeeting = (
    await call('meetings', { ...A, method: 'POST', body: meeting })
  ).data.id;
  const outcomes = await Promise.all(
    [1, 2].map(() =>
      fetch(origin + '/api/meetings/' + raceMeeting + '/process', {
        method: 'POST',
        headers: {
          Origin: origin,
          Cookie: A.cookie,
          'x-organization-id': A.org,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestKey: randomUUID(),
          text,
          attendanceConfirmed: true,
        }),
      }),
    ),
  );
  check(
    outcomes
      .map((r) => r.status)
      .sort((a, b) => a - b)
      .join(',') === '200,409',
    'Concurrent submissions start exactly one job',
  );
  check(
    (await call('meetings/' + raceMeeting, A)).data.jobs.length === 1,
    'No duplicate job persisted',
  );
  await call('meetings/' + mid + '/invite', {
    ...A,
    method: 'POST',
    body: {},
    expected: 409,
  });
  const unknown = await call('auth/request', {
    method: 'POST',
    body: { email: 'unknown-' + randomUUID() + '@example.test' },
    ip: `test-${randomUUID()}`,
  });
  check(!unknown.data.localLink, 'Login does not register an unknown user');
  const oldIdentity = (await call('me', A)).data.user;
  const duplicateSignup = await call('auth/request', {
    method: 'POST',
    body: { email: alice.email, name: 'Nome diferente' },
    ip: `test-${randomUUID()}`,
  });
  const duplicateSession = await call('auth/verify', {
    method: 'POST',
    body: {
      token: new URL(duplicateSignup.data.localLink).searchParams.get('token'),
    },
  });
  const sameIdentity = (await call('me', { cookie: duplicateSession.cookie }))
    .data.user;
  check(
    sameIdentity.id === oldIdentity.id &&
      sameIdentity.name === oldIdentity.name,
    'Sign up with existing email preserves identity and name',
  );
  for (const kind of ['internal', 'external']) {
    const email = kind + '-' + randomUUID() + '@example.test';
    const added = await call('participants', {
      ...A,
      method: 'POST',
      body: {
        name: 'Convidado ' + kind,
        email,
        kind,
        role: 'member',
        department: 'Comercial',
        responsibilities: 'Acompanhar propostas',
      },
    });
    const pid = added.data.id;
    const profile = (await call('participants', A)).data.find(
      (p) => p.id === pid,
    );
    check(
      profile.department === 'Comercial' &&
        profile.responsibilities === 'Acompanhar propostas',
      'Participant profile persisted',
    );
    await call(`participants/${pid}/invite`, {
      ...B,
      method: 'POST',
      body: {},
      expected: 404,
    });
    const invitation = await call(`participants/${pid}/invite`, {
      ...A,
      method: 'POST',
      body: {},
      expected: kind === 'internal' ? 200 : 404,
    });
    const entry = await call('auth/request', {
      method: 'POST',
      body: kind === 'internal' ? { email } : { email, name: 'Convidado' },
      ip: `test-${randomUUID()}`,
    });
    check(
      !!entry.data.localLink,
      'Internal first access accepts only the invited email; independent signup still works',
    );
    const verified = await call('auth/verify', {
      method: 'POST',
      body: {
        token: new URL(
          kind === 'internal'
            ? invitation.data.localLink
            : entry.data.localLink,
        ).searchParams.get('token'),
      },
    });
    const identity = (await call('me', { cookie: verified.cookie })).data;
    check(
      identity.organizations.some((o) => o.id === A.org) ===
        (kind === 'internal'),
      'Only an internal invitation grants organization membership',
    );
    if (kind === 'external')
      await call('meetings', {
        cookie: verified.cookie,
        org: A.org,
        expected: 409,
      });
    else {
      const member = { cookie: verified.cookie, org: A.org };
      check(verified.data.orgId === A.org, 'Invitation opens its own company');
      await call('auth/verify', {
        method: 'POST',
        body: {
          token: new URL(invitation.data.localLink).searchParams.get('token'),
        },
        expected: 410,
      });
      await call(`participants/${pA.id}/invite`, {
        ...member,
        method: 'POST',
        body: {},
        expected: 403,
      });
      const ownMeeting = (
        await call('meetings', {
          ...member,
          method: 'POST',
          body: {
            ...meeting,
            title: 'Reunião criada pelo membro',
            participantIds: [pid],
          },
        })
      ).data.id;
      await call(`meetings/${ownMeeting}/process`, {
        ...member,
        method: 'POST',
        body: {
          requestKey: randomUUID(),
          attendanceConfirmed: true,
          text: 'O membro conduziu a reunião e registrou as informações para revisão.',
        },
      });
      const revokable = await call(`participants/${pid}/invite`, {
        ...A,
        method: 'POST',
        body: {},
      });
      await call(`participants/${pid}`, {
        ...A,
        method: 'PATCH',
        body: { ...profile, kind: 'external' },
      });
      await call('auth/verify', {
        method: 'POST',
        body: {
          token: new URL(revokable.data.localLink).searchParams.get('token'),
        },
        expected: 410,
      });
      await call('meetings', { ...member, expected: 409 });
      check(
        !(
          await call('me', { cookie: verified.cookie })
        ).data.organizations.some((o) => o.id === A.org),
        'Internal-to-external change removes access for an existing session',
      );
    }
  }
  await call('organization', {
    ...A,
    method: 'PATCH',
    body: { name: 'Empresa renomeada' },
  });
  check(
    (await call('me', A)).data.organizations.find((o) => o.id === A.org)
      .business === 'Consultoria de gestão',
    'Removing the business field from the form does not erase previous context',
  );
  const longMeeting = (
    await call('meetings', {
      ...A,
      method: 'POST',
      body: {
        title: 'Reunião longa',
        objective: 'Validar armazenamento em partes',
        scheduledAt: '2026-10-01T12:00:00Z',
        duration: 180,
        location: '',
        topic: '',
        agenda: [],
        participantIds: [],
      },
    })
  ).data.id;
  const recordingId = randomUUID();
  const recordingPath = 'meetings/' + longMeeting + '/recordings';
  await call(recordingPath, {
    ...A,
    method: 'POST',
    body: { requestId: recordingId },
  });
  await call(recordingPath, {
    ...A,
    method: 'POST',
    body: { requestId: recordingId },
  });
  await call(recordingPath, {
    ...A,
    method: 'POST',
    body: { requestId: randomUUID() },
    expected: 409,
  });
  await call(recordingPath + '/' + recordingId, { ...B, expected: 404 });
  const part = (text) => {
    const form = new FormData();
    form.set('file', new File([text], 'parte.webm', { type: 'audio/webm' }));
    return form;
  };
  await call(recordingPath + '/' + recordingId + '/parts/0', {
    ...A,
    method: 'POST',
    body: part('primeira parte'),
  });
  await call(recordingPath + '/' + recordingId + '/parts/0', {
    ...A,
    method: 'POST',
    body: part('primeira parte'),
  });
  await call(recordingPath + '/' + recordingId + '/parts/0', {
    ...A,
    method: 'POST',
    body: part('outro conteúdo'),
    expected: 409,
  });
  await call(recordingPath + '/' + recordingId + '/finish', {
    ...A,
    method: 'POST',
    body: { partCount: 2 },
    expected: 409,
  });
  await call('meetings/' + longMeeting + '/process', {
    ...A,
    method: 'POST',
    body: {
      requestKey: randomUUID(),
      fileId: recordingId,
      attendanceConfirmed: true,
    },
    expected: 409,
  });
  await call(recordingPath + '/' + recordingId + '/parts/1', {
    ...A,
    method: 'POST',
    body: part('segunda parte'),
  });
  await call(recordingPath + '/' + recordingId + '/finish', {
    ...A,
    method: 'POST',
    body: { partCount: 2 },
  });
  await call(recordingPath + '/' + recordingId + '/finish', {
    ...A,
    method: 'POST',
    body: { partCount: 2 },
  });
  await call(recordingPath + '/' + recordingId + '/parts/2', {
    ...A,
    method: 'POST',
    body: part('terceira parte'),
    expected: 409,
  });
  const savedParts = (await call(recordingPath + '/' + recordingId, A)).data;
  check(
    savedParts.complete && savedParts.parts.length === 2,
    'One recording contains ordered persistent parts',
  );
  const audioPart = await call(recordingPath + '/' + recordingId + '/parts/1', {
    ...A,
    raw: true,
  });
  check(
    new TextDecoder().decode(audioPart.data) === 'segunda parte',
    'R2 part contents preserved',
  );
  const pdfText = 'Texto da ata antiga para revisao';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const pdfStream = `BT /F1 12 Tf 30 700 Td (${pdfText}) Tj ET`;
  objects.push(
    `<< /Length ${pdfStream.length} >>\nstream\n${pdfStream}\nendstream`,
  );
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n')
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const pdfForm = new FormData();
  pdfForm.set('title', 'Ata em PDF');
  pdfForm.set('category', 'minutes');
  pdfForm.set('file', new File([pdf], 'ata.pdf', { type: 'application/pdf' }));
  const importedPdf = (
    await call('knowledge', { ...A, method: 'POST', body: pdfForm })
  ).data.id;
  check(
    (await call('knowledge', A)).data
      .find((d) => d.id === importedPdf)
      .content.includes(pdfText),
    'PDF text extraction runs in the local Worker before review',
  );
  const documentForm = new FormData();
  documentForm.set('title', 'Projeto Horizonte');
  documentForm.set('category', 'project');
  documentForm.set(
    'file',
    new File(
      ['Horizonte usa entregas semanais. Marina coordena o projeto.'],
      'contexto.txt',
      { type: 'text/plain' },
    ),
  );
  const documentId = (
    await call('knowledge', { ...A, method: 'POST', body: documentForm })
  ).data.id;
  check(
    (await call('knowledge', B)).data.length === 0,
    'Knowledge isolated across organizations',
  );
  const document = (await call('knowledge', A)).data.find(
    (d) => d.id === documentId,
  );
  await call('knowledge/' + documentId, {
    ...A,
    method: 'PATCH',
    body: { ...document, state: 'confirmed', reviewed: false },
    expected: 400,
  });
  await call('knowledge/' + documentId, {
    ...A,
    method: 'PATCH',
    body: { ...document, state: 'confirmed', reviewed: true },
  });
  const knowledgeSearch = (
    await call('memory/search', {
      ...A,
      method: 'POST',
      body: { query: 'Horizonte' },
    })
  ).data;
  check(
    knowledgeSearch.sources.some((s) => s.kind === 'knowledge'),
    'Reviewed document is retrieved with a source',
  );
  await call('knowledge/' + documentId, { ...B, expected: 404 });
  const original = await call('knowledge/' + documentId, { ...A, raw: true });
  check(
    new TextDecoder().decode(original.data).includes('Horizonte'),
    'Original knowledge attachment stored in R2',
  );
  await call('knowledge/' + documentId, {
    ...A,
    method: 'PATCH',
    body: { ...document, revision: 1, state: 'archived', reviewed: false },
  });
  check(
    !(
      await call('memory/search', {
        ...A,
        method: 'POST',
        body: { query: 'Horizonte' },
      })
    ).data.sources.some((s) => s.kind === 'knowledge'),
    'Archived knowledge is excluded from retrieval',
  );
  await call('auth/logout', { ...A, method: 'POST', body: {} });
  await call('meetings', { ...A, expected: 401 });
  console.log(
    `PASS: ${assertions} assertions · cycle, tenancy, versions, links, files, concurrency, idempotency.`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
