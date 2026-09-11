'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, Pause, Play, Square } from 'lucide-react';
import { api, send, Btn, ErrorNotice } from './shared';

type Phase = 'idle' | 'starting' | 'recording' | 'paused' | 'ready';
export function LongRecorder({
  orgId,
  meetingId,
  onStored,
  onPendingChange,
}: {
  orgId: string;
  meetingId: string;
  onStored: (id: string) => Promise<void>;
  onPendingChange: (pending: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [consent, setConsent] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [saved, setSaved] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState('');
  const [finishing, setFinishing] = useState(false);
  const phaseRef = useRef<Phase>('idle'),
    media = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null);
  const mounted = useRef(true),
    fid = useRef(''),
    requestId = useRef(crypto.randomUUID()),
    next = useRef(0),
    segmentSeconds = useRef(0);
  const pending = useRef<{ sequence: number; file: File }[]>([]),
    uploading = useRef(false),
    ending = useRef(false),
    rotating = useRef(false);
  function transition(value: Phase) {
    phaseRef.current = value;
    if (mounted.current) setPhase(value);
  }
  useEffect(() => {
    onPendingChange(phase !== 'idle');
  }, [phase, onPendingChange]);
  useEffect(() => {
    mounted.current = true;
    const leave = (event: BeforeUnloadEvent) => {
      if (phaseRef.current !== 'idle') {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', leave);
    return () => {
      mounted.current = false;
      window.removeEventListener('beforeunload', leave);
      if (media.current && media.current.state !== 'inactive')
        media.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      onPendingChange(false);
    };
  }, [onPendingChange]);
  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = setInterval(() => {
      setSeconds((value) => value + 1);
      segmentSeconds.current++;
      if (
        segmentSeconds.current >= 300 &&
        media.current?.state === 'recording' &&
        !rotating.current
      ) {
        rotating.current = true;
        media.current.stop();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);
  async function flush() {
    if (uploading.current || !fid.current) return;
    uploading.current = true;
    try {
      while (pending.current.length) {
        const part = pending.current[0],
          form = new FormData();
        form.append('file', part.file);
        await api(
          `meetings/${meetingId}/recordings/${fid.current}/parts/${part.sequence}`,
          { method: 'POST', body: form, signal: AbortSignal.timeout(120000) },
          orgId,
        );
        pending.current.shift();
        if (mounted.current) {
          setSaved((value) => value + 1);
          setPendingCount(pending.current.length);
          setError('');
        }
      }
    } catch {
      if (mounted.current)
        setError(
          'Uma parte ainda não foi salva. Ela permanece neste navegador. Retome o envio antes de fechar a página.',
        );
    } finally {
      uploading.current = false;
    }
  }
  function startSegment(mime: string) {
    if (!mounted.current || ending.current) return;
    if (next.current >= 1000) {
      ending.current = true;
      transition('ready');
      stream.current?.getTracks().forEach((t) => t.stop());
      setError('Encerre esta gravação antes de começar outro encontro.');
      return;
    }
    const recorder = new MediaRecorder(stream.current!, {
      mimeType: mime,
      audioBitsPerSecond: 32000,
    });
    media.current = recorder;
    segmentSeconds.current = 0;
    rotating.current = false;
    const chunks: Blob[] = [];
    let bytes = 0;
    recorder.ondataavailable = (event) => {
      if (event.data.size) {
        chunks.push(event.data);
        bytes += event.data.size;
        if (
          bytes >= 16 * 1024 * 1024 &&
          recorder.state !== 'inactive' &&
          !rotating.current
        ) {
          rotating.current = true;
          recorder.stop();
        }
      }
    };
    recorder.onerror = () => {
      setError(
        'A captura foi interrompida. Confira e salve as partes disponíveis.',
      );
      ending.current = true;
      if (recorder.state !== 'inactive') recorder.stop();
    };
    recorder.onstop = () => {
      if (!mounted.current) return;
      if (bytes) {
        const sequence = next.current++;
        pending.current.push({
          sequence,
          file: new File(
            chunks,
            `parte-${sequence + 1}.${mime.includes('mp4') ? 'm4a' : 'webm'}`,
            { type: recorder.mimeType },
          ),
        });
        setPendingCount(pending.current.length);
        void flush();
      }
      if (ending.current) {
        stream.current?.getTracks().forEach((t) => t.stop());
        transition('ready');
      } else {
        startSegment(mime);
        if (
          phaseRef.current === 'paused' ||
          pending.current.reduce((n, p) => n + p.file.size, 0) >
            32 * 1024 * 1024
        ) {
          media.current?.pause();
          transition('paused');
        }
      }
    };
    recorder.start(1000);
  }
  async function start() {
    if (phaseRef.current !== 'idle') return;
    transition('starting');
    setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw Error(
          'Gravação indisponível neste navegador. Use o envio de arquivo.',
        );
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(
        (value) => MediaRecorder.isTypeSupported(value),
      );
      if (!mime) throw Error('Nenhum formato de gravação compatível.');
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      if (!mounted.current) {
        stream.current.getTracks().forEach((t) => t.stop());
        return;
      }
      fid.current = (
        await send(
          `meetings/${meetingId}/recordings`,
          { requestId: requestId.current },
          orgId,
        )
      ).id;
      if (!mounted.current) {
        stream.current.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current.getAudioTracks().forEach((track) => {
        track.onended = () => {
          ending.current = true;
          if (media.current?.state !== 'inactive') media.current?.stop();
          setError('Microfone desconectado. Salve as partes capturadas.');
        };
      });
      transition('recording');
      startSegment(mime);
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      transition('idle');
      setError((e as Error).message);
    }
  }
  async function finish() {
    setFinishing(true);
    setError('');
    try {
      await flush();
      if (uploading.current || pending.current.length)
        throw Error(
          'Aguarde o envio de todas as partes e tente concluir novamente.',
        );
      await send(
        `meetings/${meetingId}/recordings/${fid.current}/finish`,
        { partCount: next.current },
        orgId,
      );
      // Keep the recorder mounted until the parent has loaded the persisted file.
      await onStored(fid.current);
      if (mounted.current) transition('idle');
      onPendingChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFinishing(false);
    }
  }
  return (
    <div className="recorder">
      <h3>
        <Mic size={20} /> Gravar e salvar em partes
      </h3>
      <p className="muted">
        Partes de aproximadamente cinco minutos são enviadas durante a gravação.
        A reunião continua em uma única ata.
      </p>
      {phase === 'idle' && (
        <>
          <label className="check-label">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            Os participantes estão cientes. Ao iniciar, encerro a preparação e
            autorizo salvar o áudio durante a reunião.
          </label>
          <Btn disabled={!consent} onClick={start}>
            <Mic size={17} />
            Iniciar gravação
          </Btn>
        </>
      )}
      {phase !== 'idle' && (
        <output>
          {Math.floor(seconds / 3600)
            .toString()
            .padStart(2, '0')}
          :{Math.floor(seconds / 60) % 60 < 10 ? '0' : ''}
          {Math.floor(seconds / 60) % 60}:
          {(seconds % 60).toString().padStart(2, '0')} · {saved} partes salvas ·{' '}
          {pendingCount} pendentes
        </output>
      )}
      {['recording', 'paused'].includes(phase) && (
        <div className="button-row">
          <Btn
            secondary
            onClick={() => {
              if (rotating.current) return;
              if (phase === 'recording') {
                media.current?.pause();
                transition('paused');
              } else {
                media.current?.resume();
                transition('recording');
              }
            }}
          >
            {phase === 'paused' ? <Play size={17} /> : <Pause size={17} />}{' '}
            {phase === 'paused' ? 'Retomar' : 'Pausar'}
          </Btn>
          <Btn
            danger
            onClick={() => {
              ending.current = true;
              if (media.current && media.current.state !== 'inactive')
                media.current.stop();
            }}
          >
            <Square size={17} />
            Encerrar captura
          </Btn>
        </div>
      )}
      {pendingCount > 0 && (
        <Btn secondary onClick={() => void flush()}>
          Retomar envios
        </Btn>
      )}
      {phase === 'ready' && (
        <Btn busy={finishing} onClick={finish}>
          Concluir e usar esta gravação
        </Btn>
      )}
      {!!pendingCount && (
        <>
          <p className="muted">
            Não feche a página enquanto houver partes pendentes. Se a conexão
            falhar, a captura pausa quando o áudio pendente atingir o limite de
            memória.
          </p>
          <Btn
            secondary
            onClick={() => {
              for (const part of pending.current) {
                const url = URL.createObjectURL(part.file),
                  link = document.createElement('a');
                link.href = url;
                link.download = part.file.name;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 60000);
              }
            }}
          >
            Baixar cópias das partes pendentes
          </Btn>
        </>
      )}
      <ErrorNotice message={error} />
    </div>
  );
}

export function StoredRecording({
  orgId,
  meetingId,
  fileId,
  canEdit,
  onStored,
}: {
  orgId: string;
  meetingId: string;
  fileId: string;
  canEdit: boolean;
  onStored: (id: string) => Promise<void>;
}) {
  const [data, setData] = useState<{
      complete: boolean;
      parts: { sequence: number; size: number }[];
    } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<typeof data>(`meetings/${meetingId}/recordings/${fileId}`, {}, orgId)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [orgId, meetingId, fileId]);
  return (
    <div className="panel section-gap">
      <h3>Partes da gravação</h3>
      <ErrorNotice message={error} />
      {data?.parts.map((part) => (
        <p key={part.sequence}>
          <a
            className="text-link"
            href={`/api/meetings/${meetingId}/recordings/${fileId}/parts/${part.sequence}?org=${orgId}`}
            target="_blank"
            rel="noreferrer"
          >
            Baixar parte {part.sequence + 1}
          </a>{' '}
          · {(part.size / 1024 / 1024).toFixed(1)} MB
        </p>
      ))}
      {data && !data.complete && canEdit && (
        <>
          <p className="notice">
            Gravação ainda aberta. Se a captura foi interrompida, você pode
            encerrar usando as partes já salvas. Áudio que não foi enviado não
            está disponível aqui.
          </p>
          <Btn
            busy={busy}
            disabled={!data.parts.length}
            onClick={async () => {
              setBusy(true);
              try {
                await send(
                  `meetings/${meetingId}/recordings/${fileId}/finish`,
                  { partCount: data.parts.length },
                  orgId,
                );
                setData({ ...data, complete: true });
                await onStored(fileId);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Encerrar com as partes salvas
          </Btn>
        </>
      )}
    </div>
  );
}
