import { Inngest } from 'inngest';
import { serve } from 'inngest/edge';
import { z } from 'zod';
import {
  all,
  one,
  run,
  id,
  now,
  assert,
  runtime,
  localTest,
  event,
} from './runtime';
import { meetingAccess, type Context } from './security';
import { transcriber, generator, sendDelivery } from './providers';
import { draftSchema } from '../domain/model';
import { knowledgeSources } from './knowledge';
export async function processingParticipants(c: Context, mid: string) {
  await meetingAccess(c, mid, true);
  return all(
    'SELECT p.id,p.name,p.email,p.kind,p.department,p.responsibilities,mp.present FROM participants p JOIN meeting_participants mp ON mp.participant_id=p.id WHERE mp.meeting_id=? AND p.org_id=?',
    mid,
    c.orgId,
  );
}
export function transcriptionContext(context: Record<string, unknown>) {
  const people = (context.participants || []) as {
    name: string;
    department?: string;
  }[];
  return JSON.stringify({
    participants: people.map((p) => ({
      name: p.name,
      department: p.department || '',
    })),
    business: context.business || '',
  }).slice(0, 1500);
}

export async function recordingJobParts(jobId: string) {
  return all<{ id: string }>(
    "SELECT p.id FROM recording_parts p JOIN files f ON f.id=p.file_id JOIN jobs j ON j.org_id=f.org_id AND j.meeting_id=f.meeting_id AND json_extract(j.input,'$.fileId')=f.id WHERE j.id=? ORDER BY p.sequence",
    jobId,
  );
}
export async function transcribeRecordingPart(jobId: string, partId: string) {
  const part = await one(
    "SELECT p.*,r.complete,j.input FROM recording_parts p JOIN recordings r ON r.file_id=p.file_id JOIN files f ON f.id=p.file_id JOIN jobs j ON j.org_id=f.org_id AND j.meeting_id=f.meeting_id AND json_extract(j.input,'$.fileId')=f.id WHERE j.id=? AND p.id=?",
    jobId,
    partId,
  );
  assert(part, 404, 'Parte do processamento indisponível.');
  assert(part.complete, 409, 'Encerre a gravação antes de processar.');
  if (part.transcript) return { id: partId };
  const file = await runtime().FILES.get(part.key);
  assert(file, 404, 'Parte de áudio indisponível.');
  const content = await transcriber.transcribe(
    new Blob([await file.arrayBuffer()], { type: part.mime }),
    `parte-${part.sequence}.${part.mime.includes('mp4') ? 'm4a' : 'webm'}`,
    transcriptionContext(JSON.parse(part.input).context),
  );
  await run(
    'UPDATE recording_parts SET transcript=? WHERE id=? AND transcript IS NULL',
    content,
    partId,
  );
  return { id: partId };
}
const client = () =>
  new Inngest({
    id: 'anota-ai',
    eventKey: runtime().INNGEST_EVENT_KEY,
    signingKey: runtime().INNGEST_SIGNING_KEY,
    isDev: false,
  });
export async function transcribeJob(jobId: string) {
  const job = await one('SELECT * FROM jobs WHERE id=?', jobId);
  assert(job, 404, 'Processamento não encontrado.');
  const existing = await one('SELECT id FROM transcripts WHERE id=?', jobId);
  if (existing) return { transcriptId: existing.id };
  await run(
    "UPDATE jobs SET state='running',step='transcription',attempts=attempts+1,updated_at=? WHERE id=?",
    now(),
    jobId,
  );
  const input = JSON.parse(job.input);
  let content = input.text as string | undefined;
  if (input.fileId) {
    const f = await one(
      'SELECT * FROM files WHERE id=? AND org_id=? AND meeting_id=?',
      input.fileId,
      job.org_id,
      job.meeting_id,
    );
    assert(f, 404, 'Arquivo de origem indisponível.');
    if (f.mime === 'audio/segments') {
      const recording = await one(
        'SELECT complete FROM recordings WHERE file_id=?',
        f.id,
      );
      assert(
        recording?.complete,
        409,
        'Encerre a gravação antes de processar.',
      );
      const parts = await recordingJobParts(jobId);
      for (const part of parts) await transcribeRecordingPart(jobId, part.id);
      const texts = await all<{ transcript: string }>(
        'SELECT transcript FROM recording_parts WHERE file_id=? ORDER BY sequence',
        f.id,
      );
      content = texts.map((t) => t.transcript).join('\n\n');
    } else {
      const file = await runtime().FILES.get(f.key);
      assert(file, 404, 'Arquivo de origem indisponível.');
      content = await transcriber.transcribe(
        new Blob([await file.arrayBuffer()], { type: f.mime }),
        f.name,
        transcriptionContext(input.context),
      );
    }
  }
  assert(content?.trim(), 422, 'Não há conteúdo para processar.');
  await run(
    'INSERT INTO transcripts (id,org_id,meeting_id,file_id,content,source,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
    jobId,
    job.org_id,
    job.meeting_id,
    input.fileId || null,
    content,
    input.fileId ? 'audio' : 'text',
    now(),
  );
  return { transcriptId: jobId };
}
export async function generateJob(jobId: string) {
  const job = await one('SELECT * FROM jobs WHERE id=?', jobId);
  assert(job, 404, 'Processamento não encontrado.');
  if (job.result) return { jobId };
  const t = await one('SELECT content FROM transcripts WHERE id=?', jobId);
  assert(t, 409, 'A transcrição ainda não está pronta.');
  await run(
    "UPDATE jobs SET step='minutes',state='running',updated_at=? WHERE id=?",
    now(),
    jobId,
  );
  const draft = await generator.generate(
    t.content,
    JSON.parse(job.input).context,
  );
  await run(
    "UPDATE jobs SET result=?,state='completed',step='completed',error=NULL,updated_at=? WHERE id=?",
    JSON.stringify(draft),
    now(),
    jobId,
  );
  await event(
    job.org_id,
    job.meeting_id,
    localTest() ? 'Serviço de teste' : 'Assistente de IA',
    'Novo rascunho disponível para revisão',
  );
  return { jobId };
}
export async function dispatchJob(jobId: string, retry = false) {
  if (localTest()) {
    try {
      await transcribeJob(jobId);
      await generateJob(jobId);
    } catch (e) {
      await run(
        "UPDATE jobs SET state='failed',error=?,updated_at=? WHERE id=?",
        (e as Error).message,
        now(),
        jobId,
      );
    }
    return;
  }
  const env = runtime();
  assert(
    env.INNGEST_EVENT_KEY && env.INNGEST_SIGNING_KEY,
    503,
    'Processamento em segundo plano ainda não configurado.',
  );
  try {
    await client().send({
      id: retry ? `${jobId}/retry/${id()}` : jobId,
      name: 'anota/meeting.process',
      data: { jobId },
    });
    await run(
      "UPDATE jobs SET state='queued',error=NULL,updated_at=? WHERE id=? AND state IN ('dispatch_failed','failed')",
      now(),
      jobId,
    );
  } catch (e) {
    await run(
      "UPDATE jobs SET state='dispatch_failed',error='Não foi possível enviar à fila. Tente novamente.',updated_at=? WHERE id=?",
      now(),
      jobId,
    );
    throw e;
  }
}
export async function startJob(c: Context, mid: string, request: Request) {
  const m = await meetingAccess(c, mid, true);
  const d = z
    .object({
      requestKey: z.string().min(8).max(100),
      attendanceConfirmed: z.literal(true),
      text: z.string().min(10).max(100000).optional(),
      fileId: z.string().optional(),
    })
    .refine((x) => !!x.text !== !!x.fileId, 'Escolha áudio ou texto.')
    .parse(await request.json());
  if (!localTest()) {
    const e = runtime();
    assert(
      e.OPENAI_API_KEY && e.INNGEST_EVENT_KEY && e.INNGEST_SIGNING_KEY,
      503,
      'Configure IA e processamento em segundo plano para gerar a ata.',
    );
  }
  if (d.fileId) {
    const f = await one(
      'SELECT id,mime FROM files WHERE id=? AND meeting_id=? AND org_id=?',
      d.fileId,
      mid,
      c.orgId,
    );
    assert(f, 400, 'Arquivo inválido.');
    if (f.mime === 'audio/segments') {
      const recording = await one(
        'SELECT complete FROM recordings WHERE file_id=?',
        f.id,
      );
      assert(
        recording?.complete,
        409,
        'Encerre e salve todas as partes da gravação antes de gerar a ata.',
      );
    }
    assert(
      !localTest(),
      503,
      'Áudio armazenado. Para testar a ata sem IA, cole uma transcrição.',
    );
  }
  const existing = await one(
    'SELECT id,state FROM jobs WHERE meeting_id=? AND request_key=?',
    mid,
    d.requestKey,
  );
  if (existing) return existing;
  const participants = await processingParticipants(c, mid);
  const jobId = id();
  const input = {
    text: d.text,
    fileId: d.fileId,
    context: {
      title: m.title,
      objective: m.objective,
      agenda: JSON.parse(m.agenda),
      scheduledAt: m.scheduled_at,
      timezone: c.org.timezone,
      business: c.org.business,
      knowledge: await knowledgeSources(
        c,
        [m.title, m.topic, m.objective].join(' '),
      ),
      participants,
      attendanceConfirmed: true,
    },
  };
  await run(
    "INSERT INTO jobs (id,org_id,meeting_id,request_key,state,step,input,base_revision,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM meetings WHERE id=? AND revision=? AND status='planned' AND draft IS NULL) AND NOT EXISTS(SELECT 1 FROM jobs WHERE meeting_id=?) ON CONFLICT(meeting_id,request_key) DO NOTHING",
    jobId,
    c.orgId,
    mid,
    d.requestKey,
    'queued',
    'queued',
    JSON.stringify(input),
    m.revision,
    now(),
    now(),
    mid,
    m.revision,
    mid,
  );
  const stored = (await one(
    'SELECT id,state FROM jobs WHERE meeting_id=? AND request_key=?',
    mid,
    d.requestKey,
  ))!;
  assert(
    stored,
    409,
    'Esta reunião já foi enviada. Acompanhe ou retome o processamento existente.',
  );
  if (stored.id === jobId) await dispatchJob(jobId);
  return await one('SELECT id,state FROM jobs WHERE id=?', stored.id);
}
export async function applyJob(c: Context, jobId: string, request: Request) {
  const job = await one(
    'SELECT * FROM jobs WHERE id=? AND org_id=?',
    jobId,
    c.orgId,
  );
  assert(job, 404, 'Processamento não encontrado.');
  const m = await meetingAccess(c, job.meeting_id, true);
  const { revision } = z
    .object({ revision: z.number().int() })
    .parse(await request.json());
  assert(
    job.state === 'completed' && job.result,
    409,
    'Rascunho ainda indisponível.',
  );
  assert(!job.applied, 409, 'Este resultado já foi incorporado.');
  assert(
    m.status === 'planned' || m.status === 'review',
    409,
    'Abra uma revisão antes de incorporar um novo resultado.',
  );
  const draft = draftSchema.parse(JSON.parse(job.result));
  const previous = m.draft ? draftSchema.parse(JSON.parse(m.draft)) : null;
  if (previous) {
    for (const t of draft.tasks) {
      const old = previous.tasks.find(
        (x) =>
          x.description.trim().toLowerCase() ===
          t.description.trim().toLowerCase(),
      );
      if (old) t.id = old.id;
    }
    for (const d of draft.decisions) {
      const old = previous.decisions.find(
        (x) =>
          x.description.trim().toLowerCase() ===
          d.description.trim().toLowerCase(),
      );
      if (old) d.id = old.id;
    }
  }
  const results = await runtime().DB.batch([
    runtime()
      .DB.prepare(
        "UPDATE meetings SET draft=?,status='review',revision=revision+1,finalization_token=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND applied=0)",
      )
      .bind(JSON.stringify(draft), jobId, job.meeting_id, revision, jobId),
    runtime()
      .DB.prepare(
        'UPDATE jobs SET applied=1 WHERE id=? AND EXISTS(SELECT 1 FROM meetings WHERE id=? AND finalization_token=?)',
      )
      .bind(jobId, job.meeting_id, jobId),
  ]);
  assert(
    results[0].meta.changes,
    409,
    'A ata foi alterada. Recarregue para comparar o resultado.',
  );
  await event(
    c.orgId,
    job.meeting_id,
    c.user.name,
    'Resultado do processamento incorporado ao rascunho',
  );
  return { ok: true };
}
export async function dispatchEmail(deliveryId: string, retry = false) {
  if (localTest()) return sendDelivery(deliveryId);
  assert(
    runtime().INNGEST_EVENT_KEY && runtime().INNGEST_SIGNING_KEY,
    503,
    'Fila de envio ainda não configurada.',
  );
  await client().send({
    id: retry ? `email/${deliveryId}/retry/${id()}` : `email/${deliveryId}`,
    name: 'anota/email.send',
    data: { deliveryId },
  });
}
export async function inngestHandler(request: Request) {
  assert(!localTest(), 503, 'Integração externa desativada no modo de teste.');
  assert(
    runtime().INNGEST_SIGNING_KEY,
    503,
    'Processamento em segundo plano ainda não configurado.',
  );
  const inngest = client();
  const processMeeting = inngest.createFunction(
    {
      id: 'process-meeting',
      triggers: { event: 'anota/meeting.process' },
      retries: 3,
      concurrency: { limit: 1, key: 'event.data.jobId' },
      onFailure: async ({ event: ev }) => {
        const jobId = ev.data.event.data.jobId;
        await run(
          "UPDATE jobs SET state='failed',error='O processamento falhou após novas tentativas. Retome a partir da etapa salva.',updated_at=? WHERE id=? AND state!='completed'",
          now(),
          jobId,
        );
      },
    },
    async ({ event: ev, step }) => {
      const parts = await step.run('recording-parts', () =>
        recordingJobParts(ev.data.jobId),
      );
      for (const part of parts)
        await step.run(
          'transcribe-part-' + part.id.replace(/[^a-zA-Z0-9_-]/g, '-'),
          () => transcribeRecordingPart(ev.data.jobId, part.id),
        );
      await step.run('transcribe', () => transcribeJob(ev.data.jobId));
      return await step.run('generate-minutes', () =>
        generateJob(ev.data.jobId),
      );
    },
  );
  const email = inngest.createFunction(
    { id: 'send-email', triggers: { event: 'anota/email.send' }, retries: 3 },
    async ({ event: ev, step }) => {
      await step.run('send', () => sendDelivery(ev.data.deliveryId));
      return { ok: true };
    },
  );
  const recover = inngest.createFunction(
    { id: 'recover-outbox', triggers: { cron: '*/5 * * * *' } },
    async ({ step }) => {
      const pending = await step.run('find-pending', () =>
        all(
          "SELECT id FROM deliveries WHERE status='queued' AND created_at>? LIMIT 100",
          new Date(Date.now() - 23 * 3600000).toISOString(),
        ),
      );
      for (const d of pending)
        await step.run('deliver-' + d.id, () => sendDelivery(d.id));
      const jobs = await step.run('find-jobs', () =>
        all(
          "SELECT id FROM jobs WHERE state IN ('queued','dispatch_failed') AND updated_at<? LIMIT 50",
          new Date(Date.now() - 5 * 60000).toISOString(),
        ),
      );
      for (const j of jobs)
        await step.sendEvent('recover-' + j.id, {
          id: 'recovery/' + j.id,
          name: 'anota/meeting.process',
          data: { jobId: j.id },
        });
      return { ok: true };
    },
  );
  return serve({
    client: inngest,
    functions: [processMeeting, email, recover],
  })(request);
}
