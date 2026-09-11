import { z } from 'zod';
import { all, one, run, stmt, batch, now, assert, runtime } from './runtime';
import { meetingAccess, type Context } from './security';
import { MAX_AUDIO_BYTES } from '../domain/model';

export async function recordingAccess(
  c: Context,
  mid: string,
  fid: string,
  edit = false,
) {
  await meetingAccess(c, mid, edit);
  const row = await one(
    'SELECT r.*,f.org_id,f.meeting_id FROM recordings r JOIN files f ON f.id=r.file_id WHERE f.id=? AND f.org_id=? AND f.meeting_id=?',
    fid,
    c.orgId,
    mid,
  );
  assert(row, 404, 'Gravação não encontrada.');
  return row;
}
export async function beginRecording(
  c: Context,
  mid: string,
  request: Request,
) {
  await meetingAccess(c, mid, true);
  const { requestId } = z
    .object({ requestId: z.uuid() })
    .parse(await request.json());
  const existing = await one('SELECT id FROM files WHERE id=?', requestId);
  if (existing) {
    await recordingAccess(c, mid, requestId, true);
    return { id: requestId };
  }
  await batch([
    stmt(
      "INSERT INTO files(id,org_id,meeting_id,key,name,mime,size,created_at) SELECT ?,?,?,?,'Gravação em partes','audio/segments',0,? WHERE EXISTS(SELECT 1 FROM meetings WHERE id=? AND status='planned' AND draft IS NULL) AND NOT EXISTS(SELECT 1 FROM files WHERE meeting_id=?) AND NOT EXISTS(SELECT 1 FROM jobs WHERE meeting_id=?) ON CONFLICT(id) DO NOTHING",
      requestId,
      c.orgId,
      mid,
      `${c.orgId}/${mid}/${requestId}/manifest`,
      now(),
      mid,
      mid,
      mid,
    ),
    stmt(
      'INSERT INTO recordings(file_id) SELECT id FROM files WHERE id=? AND org_id=? AND meeting_id=? ON CONFLICT(file_id) DO NOTHING',
      requestId,
      c.orgId,
      mid,
    ),
  ]);
  const stored = await one(
    'SELECT r.file_id FROM recordings r JOIN files f ON f.id=r.file_id WHERE r.file_id=? AND f.org_id=? AND f.meeting_id=?',
    requestId,
    c.orgId,
    mid,
  );
  assert(
    stored,
    409,
    'Esta reunião já tem conteúdo. Retome a gravação existente.',
  );
  return { id: requestId };
}
export async function recordingStatus(c: Context, mid: string, fid: string) {
  const row = await recordingAccess(c, mid, fid);
  return {
    id: fid,
    complete: !!row.complete,
    parts: await all(
      'SELECT sequence,size,mime FROM recording_parts WHERE file_id=? ORDER BY sequence',
      fid,
    ),
  };
}
export async function uploadPart(
  c: Context,
  mid: string,
  fid: string,
  sequence: number,
  request: Request,
) {
  const row = await recordingAccess(c, mid, fid, true);
  z.number().int().min(0).max(999).parse(sequence);
  assert(
    Number(request.headers.get('content-length') || 0) <=
      MAX_AUDIO_BYTES + 10000,
    413,
    'Parte de áudio excedeu 20 MB.',
  );
  const file = (await request.formData()).get('file');
  assert(
    file instanceof File && file.size > 0 && file.size <= MAX_AUDIO_BYTES,
    400,
    'Parte de áudio inválida.',
  );
  assert(
    /^(audio\/(webm|mp4)|video\/(webm|mp4))(;|$)/.test(file.type),
    415,
    'Formato de gravação inválido.',
  );
  const bytes = await file.arrayBuffer();
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (x) => x.toString(16).padStart(2, '0'),
  ).join('');
  const previous = await one(
    'SELECT digest FROM recording_parts WHERE file_id=? AND sequence=?',
    fid,
    sequence,
  );
  if (previous) {
    assert(
      previous.digest === digest,
      409,
      'Esta parte já foi armazenada com outro conteúdo.',
    );
    return { ok: true };
  }
  assert(!row.complete, 409, 'A gravação já foi encerrada.');
  // Content-addressed keys prevent concurrent retries from replacing a saved part.
  const key = `${c.orgId}/${mid}/${fid}/${sequence}-${digest}`;
  await runtime().FILES.put(key, bytes, {
    httpMetadata: { contentType: file.type },
  });
  await run(
    'INSERT INTO recording_parts(id,file_id,sequence,key,mime,size,digest) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM recordings WHERE file_id=? AND complete=0) ON CONFLICT(file_id,sequence) DO NOTHING',
    `${fid}:${sequence}`,
    fid,
    sequence,
    key,
    file.type,
    file.size,
    digest,
    fid,
  );
  const saved = await one(
    'SELECT digest FROM recording_parts WHERE file_id=? AND sequence=?',
    fid,
    sequence,
  );
  if (saved?.digest !== digest) await runtime().FILES.delete(key);
  assert(
    saved?.digest === digest,
    409,
    'A gravação mudou; confira as partes armazenadas.',
  );
  return { ok: true };
}
export async function finishRecording(
  c: Context,
  mid: string,
  fid: string,
  request: Request,
) {
  const row = await recordingAccess(c, mid, fid, true);
  const { partCount } = z
    .object({ partCount: z.number().int().min(1).max(1000) })
    .parse(await request.json());
  if (row.complete) {
    assert(
      row.part_count === partCount,
      409,
      'Gravação já encerrada com outra quantidade de partes.',
    );
    return { id: fid };
  }
  const result = await run(
    'UPDATE recordings SET complete=1,part_count=? WHERE file_id=? AND complete=0 AND (SELECT count(*) FROM recording_parts WHERE file_id=?)=? AND (SELECT min(sequence) FROM recording_parts WHERE file_id=?)=0 AND (SELECT max(sequence) FROM recording_parts WHERE file_id=?)=?',
    partCount,
    fid,
    fid,
    partCount,
    fid,
    fid,
    partCount - 1,
  );
  assert(
    result.meta.changes,
    409,
    'Ainda faltam partes do áudio. Retome os envios antes de encerrar.',
  );
  await run(
    'UPDATE files SET size=(SELECT coalesce(sum(size),0) FROM recording_parts WHERE file_id=?) WHERE id=?',
    fid,
    fid,
  );
  return { id: fid };
}
export async function getRecordingPart(
  c: Context,
  mid: string,
  fid: string,
  sequence: number,
) {
  await recordingAccess(c, mid, fid);
  const part = await one(
    'SELECT * FROM recording_parts WHERE file_id=? AND sequence=?',
    fid,
    sequence,
  );
  assert(part, 404, 'Parte indisponível.');
  const object = await runtime().FILES.get(part.key);
  assert(object, 404, 'Áudio indisponível.');
  return new Response(object.body, {
    headers: {
      'Content-Type': part.mime,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `attachment; filename="parte-${sequence + 1}.${part.mime.includes('mp4') ? 'm4a' : 'webm'}"`,
    },
  });
}
