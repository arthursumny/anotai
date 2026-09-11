import { ZodError } from 'zod';
import {
  checkOrigin,
  context,
  meetingAccess,
  visibleMeetings,
} from './security';
import { all, one, run, assert, event } from './runtime';
import * as meetings from './meetings';
import * as memory from './memory';
import * as recordings from './recordings';
import * as knowledge from './knowledge';
import * as planning from './planning';
import * as materials from './materials';
import * as communication from './communication';
import {
  startJob,
  applyJob,
  dispatchJob,
  inngestHandler,
  dispatchEmail,
} from './jobs';
import { HttpError } from './runtime';
import { authRequest, authVerify, logout, me } from './auth';
import { inviteMember } from './auth';
export async function handle(request: Request) {
  try {
    const path = new URL(request.url).pathname.replace(/^\/api\/?/, '');
    if (path === 'inngest') return await inngestHandler(request);
    checkOrigin(request);
    let data: unknown;
    if (path === 'auth/request' && request.method === 'POST')
      data = await authRequest(request);
    else if (path === 'auth/verify' && request.method === 'POST')
      return await authVerify(request);
    else if (path === 'auth/logout' && request.method === 'POST')
      return await logout(request);
    else if (path === 'me' && request.method === 'GET')
      data = await me(request);
    else if (path === 'acceptance' && ['GET', 'POST'].includes(request.method))
      data = await communication.publicAcceptance(request);
    else if (path === 'organizations' && request.method === 'POST')
      data = await meetings.createOrganization(request);
    else {
      const c = await context(request);
      const parts = path.split('/');
      const method = request.method;
      if (path === 'agenda-proposals' && method === 'POST')
        data = await planning.createProposal(c, await request.json(), request);
      else if (
        parts[0] === 'agenda-proposals' &&
        parts.length === 2 &&
        method === 'GET'
      )
        data = await planning.getProposal(c, parts[1]);
      else if (path === 'knowledge' && method === 'GET')
        data = await knowledge.listKnowledge(c);
      else if (path === 'knowledge' && method === 'POST')
        data = await knowledge.createKnowledge(c, request);
      else if (parts[0] === 'knowledge' && parts[1] && method === 'PATCH')
        data = await knowledge.updateKnowledge(c, parts[1], request);
      else if (parts[0] === 'knowledge' && parts[1] && method === 'GET')
        return await knowledge.downloadKnowledge(c, parts[1]);
      else if (path === 'memory/search' && method === 'POST')
        data = await memory.retrieve(c, await request.json());
      else if (path === 'memory/chats' && method === 'GET')
        data = await memory.listChats(
          c,
          new URL(request.url).searchParams.get('before'),
        );
      else if (path === 'memory/chats' && method === 'POST')
        data = await memory.createChat(c);
      else if (
        parts[0] === 'memory' &&
        parts[1] === 'chats' &&
        parts[2] &&
        parts.length === 3 &&
        method === 'GET'
      )
        data = await memory.readChat(
          c,
          parts[2],
          new URL(request.url).searchParams.get('before'),
        );
      else if (
        parts[0] === 'memory' &&
        parts[1] === 'chats' &&
        parts[2] &&
        parts[3] === 'messages' &&
        parts.length === 4 &&
        method === 'POST'
      )
        data = await memory.ask(c, parts[2], request);
      else if (path === 'organization' && method === 'PATCH')
        data = await meetings.updateOrganization(c, request);
      else if (path === 'participants' && method === 'GET')
        data = await all(
          `SELECT p.*,CASE WHEN p.kind='external' THEN 'external' WHEN EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=p.org_id AND u.email=p.email) THEN 'active' ELSE 'pending' END AS access_state FROM participants p WHERE p.org_id=? ORDER BY p.name`,
          c.orgId,
        );
      else if (path === 'participants' && method === 'POST')
        data = await meetings.saveParticipant(c, request);
      else if (
        parts[0] === 'participants' &&
        parts[2] === 'invite' &&
        parts.length === 3 &&
        method === 'POST'
      )
        data = await inviteMember(c, parts[1], request);
      else if (parts[0] === 'participants' && parts[1] && method === 'PATCH')
        data = await meetings.saveParticipant(c, request, parts[1]);
      else if (path === 'meetings' && method === 'GET')
        data = await visibleMeetings(c);
      else if (path === 'meetings' && method === 'POST')
        data = await meetings.saveMeeting(c, request);
      else if (path === 'work' && method === 'GET')
        data = await meetings.listWork(c);
      else if (parts[0] === 'tasks' && parts[1] && method === 'PATCH')
        data = await meetings.updateTask(c, parts[1], request);
      else if (parts[0] === 'files' && parts[1] && method === 'GET')
        return await meetings.getFile(c, parts[1]);
      else if (
        parts[0] === 'acceptances' &&
        parts[2] === 'resend' &&
        method === 'POST'
      )
        data = await communication.resendAcceptance(c, parts[1], request);
      else if (
        parts[0] === 'deliveries' &&
        parts[2] === 'local' &&
        method === 'GET'
      )
        data = await communication.localMail(c, parts[1]);
      else if (
        parts[0] === 'deliveries' &&
        parts[2] === 'retry' &&
        method === 'POST'
      ) {
        const d = await one(
          'SELECT * FROM deliveries WHERE id=? AND org_id=?',
          parts[1],
          c.orgId,
        );
        assert(d && d.meeting_id, 404, 'Envio não encontrado.');
        await meetingAccess(c, d.meeting_id, true);
        assert(
          d.status === 'failed' || d.status === 'queued',
          409,
          'Este envio já foi concluído.',
        );
        await dispatchEmail(d.id, true);
        data = { ok: true };
      } else if (parts[0] === 'jobs' && parts[1]) {
        const job = await one(
          'SELECT * FROM jobs WHERE id=? AND org_id=?',
          parts[1],
          c.orgId,
        );
        assert(job, 404, 'Processamento não encontrado.');
        await meetingAccess(c, job.meeting_id, method !== 'GET');
        if (method === 'GET')
          data = {
            id: job.id,
            state: job.state,
            step: job.step,
            result: job.result,
            error: job.error,
          };
        else if (parts[2] === 'apply' && method === 'POST')
          data = await applyJob(c, job.id, request);
        else if (parts[2] === 'retry' && method === 'POST') {
          assert(
            ['failed', 'dispatch_failed'].includes(job.state),
            409,
            'O processamento não precisa ser retomado.',
          );
          await dispatchJob(job.id, true);
          data = { ok: true };
        } else throw new HttpError(404, 'Recurso não encontrado.');
      } else if (parts[0] === 'meetings' && parts[1]) {
        const mid = parts[1],
          action = parts[2];
        if (action === 'recordings' && parts.length === 3 && method === 'POST')
          data = await recordings.beginRecording(c, mid, request);
        else if (
          action === 'recordings' &&
          parts.length === 4 &&
          method === 'GET'
        )
          data = await recordings.recordingStatus(c, mid, parts[3]);
        else if (
          action === 'recordings' &&
          parts[4] === 'finish' &&
          method === 'POST'
        )
          data = await recordings.finishRecording(c, mid, parts[3], request);
        else if (
          action === 'recordings' &&
          parts[4] === 'parts' &&
          parts.length === 6 &&
          method === 'POST'
        )
          data = await recordings.uploadPart(
            c,
            mid,
            parts[3],
            Number(parts[5]),
            request,
          );
        else if (
          action === 'recordings' &&
          parts[4] === 'parts' &&
          parts.length === 6 &&
          method === 'GET'
        )
          return await recordings.getRecordingPart(
            c,
            mid,
            parts[3],
            Number(parts[5]),
          );
        else if (
          action === 'materials' &&
          parts.length === 3 &&
          method === 'GET'
        )
          data = await materials.listMaterials(c, mid);
        else if (
          action === 'materials' &&
          parts.length === 3 &&
          method === 'POST'
        )
          data = await materials.createMaterial(c, mid, request);
        else if (
          action === 'materials' &&
          parts.length === 4 &&
          method === 'GET'
        )
          return await materials.getMaterial(c, mid, parts[3], request);
        else if (action === 'agenda-origins' && method === 'GET')
          data = await planning.agendaOrigins(c, mid);
        else if (!action && method === 'GET')
          data = await meetings.meetingDetail(c, mid);
        else if (!action && method === 'PATCH')
          data = await meetings.saveMeeting(c, request, mid);
        else if (action === 'draft' && method === 'PATCH')
          data = await meetings.saveDraft(c, mid, request);
        else if (action === 'revise' && method === 'POST')
          data = await meetings.revise(c, mid, request);
        else if (action === 'finalize' && method === 'POST')
          data = await meetings.finalize(c, mid, request);
        else if (action === 'files' && method === 'POST')
          data = await meetings.upload(c, mid, request);
        else if (action === 'process' && method === 'POST')
          data = await startJob(c, mid, request);
        else if (action === 'invite' && method === 'POST')
          data = await communication.invite(c, mid, request);
        else if (action === 'send' && method === 'POST')
          data = await communication.sendMinutes(c, mid, request);
        else if (action === 'presence' && method === 'PATCH') {
          await meetingAccess(c, mid, true);
          const d = (await request.json()) as {
            participantId: string;
            present: boolean;
          };
          assert(
            typeof d.present === 'boolean' &&
              typeof d.participantId === 'string',
            400,
            'Presença inválida.',
          );
          const changed = await run(
            "UPDATE meeting_participants SET present=? WHERE meeting_id=? AND participant_id=? AND EXISTS(SELECT 1 FROM meetings WHERE id=meeting_participants.meeting_id AND status='planned' AND draft IS NULL) AND NOT EXISTS(SELECT 1 FROM jobs WHERE meeting_id=meeting_participants.meeting_id)",
            d.present ? 1 : 0,
            mid,
            d.participantId,
          );
          assert(
            changed.meta.changes,
            409,
            'Presença encerrada para edição ou participante não encontrado.',
          );
          await event(c.orgId, mid, c.user.name, 'Presença atualizada');
          data = { ok: true };
        } else throw new HttpError(404, 'Recurso não encontrado.');
      } else throw new HttpError(404, 'Recurso não encontrado.');
    }
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status =
      error instanceof HttpError
        ? error.status
        : error instanceof ZodError
          ? 400
          : 500;
    const message =
      error instanceof HttpError
        ? error.message
        : error instanceof ZodError
          ? 'Confira os campos informados: ' +
            error.issues
              .map((x) => x.path.join('.') + ': ' + x.message)
              .join('; ')
          : 'Não foi possível concluir a operação. Tente novamente.';
    if (status === 500) console.error('api_failure', error);
    return Response.json(
      { error: message },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
