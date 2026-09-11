'use client';
import { useState, useRef, useEffect } from 'react';
import { LoaderCircle, Plus, Inbox, X, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { statusLabels } from '@/lib/domain/model';
// SQL rows and version snapshots are mapped at this boundary; mutation payloads are validated with Zod.
// eslint-disable-next-line typescript/no-explicit-any
export type Row = Record<string, any>;
export async function api<T = Row>(
  path: string,
  options: RequestInit = {},
  orgId?: string,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  if (orgId) headers.set('x-organization-id', orgId);
  const r = await fetch('/api/' + path, { ...options, headers });
  const bodyText = await r.text();
  let d;
  try {
    d = JSON.parse(bodyText);
  } catch {
    throw Error(
      r.status === 413
        ? 'O arquivo excede o limite permitido. Use até 20 MB.'
        : 'O servidor não retornou uma resposta válida. Tente novamente.',
    );
  }
  if (!r.ok) throw new Error(d.error || 'Não foi possível concluir a ação.');
  return d;
}
export function send(
  path: string,
  data: unknown,
  orgId?: string,
  method = 'POST',
) {
  return api(path, { method, body: JSON.stringify(data) }, orgId);
}
export const dateTime = (value: string, tz = 'America/Sao_Paulo') =>
  new Date(value).toLocaleString('pt-BR', {
    timeZone: tz,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
export const dateOnly = (value?: string) =>
  value
    ? new Date(value + 'T12:00:00').toLocaleDateString('pt-BR')
    : 'Sem prazo';
export const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();
export function Badge({ status }: { status: string }) {
  return (
    <span className={'badge badge-' + status}>
      <i />
      {statusLabels[status] || status}
    </span>
  );
}
export function Btn({
  children,
  busy = false,
  secondary = false,
  danger = false,
  ...props
}: React.ComponentProps<typeof Button> & {
  busy?: boolean;
  secondary?: boolean;
  danger?: boolean;
}) {
  return (
    <Button
      {...props}
      disabled={busy || props.disabled}
      className={
        (danger ? 'danger' : secondary ? 'secondary' : 'primary') +
        ' ' +
        (props.className || '')
      }
    >
      {busy ? <LoaderCircle size={17} className="spin" /> : children}
    </Button>
  );
}
export function Empty({
  title,
  description,
  href,
  action,
}: {
  title: string;
  description: string;
  href?: string;
  action?: string;
}) {
  return (
    <div className="empty">
      <span>
        <Inbox size={28} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {href && (
        <a className="primary" href={href}>
          <Plus size={16} />
          {action || 'Criar reunião'}
        </a>
      )}
    </div>
  );
}
export function ErrorNotice({ message }: { message: string }) {
  return message ? (
    <div className="error-notice" role="alert">
      <AlertCircle size={18} />
      <span>{message}</span>
    </div>
  ) : null;
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose} className="modal">
      <div className="section-head">
        <h2>{title}</h2>
        <button
          autoFocus
          className="icon-btn"
          onClick={onClose}
          aria-label="Fechar"
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function act<T>(fn: () => Promise<T>, message = '') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await fn();
      if (message) setNotice(message);
      return result;
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, notice, act, setError };
}
