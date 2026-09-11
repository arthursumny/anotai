'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, Pause, Play, Square, Download, UploadCloud } from 'lucide-react';
import { Btn, ErrorNotice } from './shared';
import { MAX_AUDIO_BYTES } from '@/lib/domain/model';
export function Recorder({
  onFile,
  disabled,
  onPendingChange,
}: {
  onFile: (file: File) => void;
  disabled: boolean;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [state, setState] = useState<'idle' | 'recording' | 'paused' | 'ready'>(
      'idle',
    ),
    [consent, setConsent] = useState(false),
    [error, setError] = useState(''),
    [seconds, setSeconds] = useState(0),
    [url, setUrl] = useState(''),
    [file, setFile] = useState<File | null>(null);
  const [starting, setStarting] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    chunks = useRef<Blob[]>([]),
    size = useRef(0),
    elapsed = useRef(0),
    blobUrl = useRef(''),
    mounted = useRef(true);
  useEffect(() => {
    onPendingChange?.(starting || state !== 'idle');
    return () => onPendingChange?.(false);
  }, [state, starting, onPendingChange]);
  useEffect(() => {
    mounted.current = true;
    const leave = (e: BeforeUnloadEvent) => {
      if (
        (recorder.current?.state !== 'inactive' && recorder.current) ||
        blobUrl.current
      ) {
        e.preventDefault(); /* preventDefault prompts before discarding the recording. */
      }
    };
    window.addEventListener('beforeunload', leave);
    return () => {
      mounted.current = false;
      window.removeEventListener('beforeunload', leave);
      if (recorder.current && recorder.current.state !== 'inactive')
        recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    };
  }, []);
  useEffect(() => {
    if (state !== 'recording') return;
    const timer = setInterval(() => {
      elapsed.current++;
      setSeconds(elapsed.current);
    }, 1000);
    return () => clearInterval(timer);
  }, [state]);
  function stop() {
    if (recorder.current?.state !== 'inactive') recorder.current?.stop();
  }
  async function start() {
    if (starting) return;
    setStarting(true);
    setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw Error(
          'Este navegador não oferece gravação. Use o envio de arquivo de áudio.',
        );
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(
        (t) => MediaRecorder.isTypeSupported(t),
      );
      if (!mime)
        throw Error(
          'Nenhum formato de gravação compatível. Envie um arquivo de áudio.',
        );
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      if (!mounted.current) {
        stream.current.getTracks().forEach((track) => track.stop());
        return;
      }
      const media = new MediaRecorder(stream.current, {
        mimeType: mime,
        audioBitsPerSecond: 32000,
      });
      recorder.current = media;
      chunks.current = [];
      size.current = 0;
      elapsed.current = 0;
      setSeconds(0);
      setFile(null);
      setUrl('');
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
      blobUrl.current = '';
      media.ondataavailable = (e) => {
        if (e.data.size) {
          chunks.current.push(e.data);
          size.current += e.data.size;
          if (
            size.current >= MAX_AUDIO_BYTES - 128 * 1024 &&
            media.state !== 'inactive'
          ) {
            setError(
              'Limite de tamanho atingido. A gravação foi encerrada para você conferir.',
            );
            media.stop();
          }
        }
      };
      media.onerror = () => {
        setError(
          'A gravação foi interrompida. Confira o áudio disponível antes de enviar.',
        );
        if (media.state !== 'inactive') media.stop();
      };
      media.onstop = () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        if (!mounted.current) return;
        const blob = new Blob(chunks.current, { type: media.mimeType });
        if (!blob.size) {
          setError('Nenhum áudio foi capturado.');
          setState('idle');
          return;
        }
        const result = new File(
          [blob],
          `reuniao-${Date.now()}.${mime.includes('mp4') ? 'm4a' : 'webm'}`,
          { type: media.mimeType },
        );
        const objectURL = URL.createObjectURL(result);
        blobUrl.current = objectURL;
        setFile(result);
        setUrl(objectURL);
        setState('ready');
        if (blob.size > MAX_AUDIO_BYTES)
          setError(
            'O áudio excedeu 20 MB. Baixe o arquivo e reduza seu tamanho antes de enviar.',
          );
      };
      stream.current.getAudioTracks().forEach(
        (track) =>
          (track.onended = () => {
            if (media.state !== 'inactive') {
              setError(
                'O microfone foi desconectado. Confira a gravação parcial.',
              );
              media.stop();
            }
          }),
      );
      media.start(1000);
      setState('recording');
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      setError(
        (e as Error).name === 'NotAllowedError'
          ? 'O acesso ao microfone foi negado. Autorize nas configurações do navegador ou envie um arquivo.'
          : (e as Error).message,
      );
      setState('idle');
    } finally {
      if (mounted.current) setStarting(false);
    }
  }
  return (
    <div className="recorder">
      <div className={'record-icon ' + (state === 'recording' ? 'live' : '')}>
        <Mic size={26} />
      </div>
      <div>
        <h3>Gravar esta reunião</h3>
        <p className="muted small-copy">
          Sem corte por duração. Limite atual de 20 MB por áudio. O áudio só é
          armazenado na plataforma após o envio.
        </p>
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          checked={consent}
          disabled={state === 'recording' || state === 'paused'}
          onChange={(e) => setConsent(e.target.checked)}
        />
        Confirmei que os participantes estão cientes da gravação.
      </label>
      {state === 'idle' || state === 'ready' ? (
        <Btn
          secondary
          busy={starting}
          disabled={!consent || disabled}
          onClick={start}
        >
          <Mic size={17} />
          {state === 'ready'
            ? 'Descartar e regravar antes do envio'
            : 'Iniciar gravação'}
        </Btn>
      ) : (
        <div className="record-controls">
          <span className="record-timer">
            {Math.floor(seconds / 60)
              .toString()
              .padStart(2, '0')}
            :{(seconds % 60).toString().padStart(2, '0')}
          </span>
          <Btn
            secondary
            onClick={() => {
              if (state === 'recording') {
                recorder.current?.pause();
                setState('paused');
              } else {
                recorder.current?.resume();
                setState('recording');
              }
            }}
          >
            {state === 'recording' ? (
              <>
                <Pause size={17} />
                Pausar
              </>
            ) : (
              <>
                <Play size={17} />
                Retomar
              </>
            )}
          </Btn>
          <Btn danger onClick={stop}>
            <Square size={15} />
            Encerrar
          </Btn>
        </div>
      )}
      {url && file && (
        <div className="record-preview">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- This is a newly recorded audio preview; a transcript is produced only after processing. */}
          <audio
            src={url}
            controls
            aria-label="Ouvir gravação antes do envio"
          />
          <p className="small-copy muted">
            Gravação disponível neste navegador ·{' '}
            {(file.size / 1024 / 1024).toFixed(1)} MB
          </p>
          <div className="button-row">
            <a className="secondary" href={url} download={file.name}>
              <Download size={16} />
              Baixar cópia
            </a>
            <Btn
              disabled={disabled || file.size > MAX_AUDIO_BYTES}
              onClick={() => onFile(file)}
            >
              <UploadCloud size={16} />
              Enviar gravação
            </Btn>
          </div>
        </div>
      )}
      <ErrorNotice message={error} />
    </div>
  );
}
