'use client';
/* eslint-disable next/no-html-link-for-pages -- Full document navigation resets organization/session state and preserves unsaved-change prompts. */
import { useState } from 'react';
import { ArrowRight, Check, Layers3, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
export function Access({ ready = true }: { ready?: boolean }) {
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [localLink, setLocalLink] = useState('');
  return (
    <main className="access">
      <section className="access-story">
        <a href="/" className="brand">
          <span className="brand-icon">
            <Layers3 size={22} />
          </span>
          Anota Aí<span className="brand-dot">.</span>
        </a>
        <div>
          <span className="eyebrow">DA CONVERSA À CONTINUIDADE</span>
          <h1>
            Boas reuniões.
            <br />
            Decisões que
            <br />
            <em>seguem adiante.</em>
          </h1>
          <p>
            Um lugar para preparar encontros, registrar acordos e acompanhar o
            próximo passo da sua empresa.
          </p>
          <div className="cycle">
            <span>Planejar</span>
            <ArrowRight size={16} />
            <span>Decidir</span>
            <ArrowRight size={16} />
            <span>Acompanhar</span>
          </div>
        </div>
        <p className="access-foot">
          A memória das reuniões, construída em equipe.
        </p>
      </section>
      <section className="access-form">
        <div className="login-card">
          <span className="eyebrow">SEU ESPAÇO DE TRABALHO</span>
          <h2>{creating ? 'Crie sua conta' : 'Acesse sua empresa'}</h2>
          <div className="tabs" aria-label="Tipo de acesso">
            <button
              type="button"
              className={!creating ? 'active' : ''}
              onClick={() => {
                setCreating(false);
                setMessage('');
                setLocalLink('');
              }}
            >
              Entrar
            </button>
            <button
              type="button"
              className={creating ? 'active' : ''}
              onClick={() => {
                setCreating(true);
                setMessage('');
                setLocalLink('');
              }}
            >
              Criar conta
            </button>
          </div>
          <p className="muted">
            {creating
              ? 'Crie sua conta, confirme seu e-mail e cadastre sua empresa para começar a organizar as reuniões.'
              : 'Já tem conta ou foi adicionado como membro interno? Entre com o e-mail cadastrado. Seu acesso é por link, sem senha.'}
          </p>
          {!ready && (
            <div className="notice">
              O acesso por e-mail aguarda a configuração do serviço de envio.
              Esta prévia preserva os dados empresariais protegidos.
            </div>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              setMessage('');
              setLocalLink('');
              try {
                const r = await fetch('/api/auth/request', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    email,
                    ...(creating ? { name } : {}),
                  }),
                });
                const d = (await r.json()) as {
                  error: string;
                  message: string;
                  localLink?: string;
                };
                if (!r.ok) throw Error(d.error);
                setMessage(d.message);
                setLocalLink(d.localLink || '');
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setPending(false);
              }
            }}
          >
            {creating && (
              <label>
                Seu nome
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Como podemos chamar você?"
                  required
                  maxLength={100}
                />
              </label>
            )}
            <label>
              E-mail profissional
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com.br"
                required
                maxLength={254}
              />
            </label>
            <Button
              type="submit"
              className="primary wide"
              disabled={pending || !ready}
            >
              {pending ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <>
                  {creating
                    ? 'Confirmar e-mail e continuar'
                    : 'Enviar link para entrar'}
                  <ArrowRight size={18} />
                </>
              )}
            </Button>
          </form>
          {message && <output className="notice">{message}</output>}
          {localLink && (
            <div className="local-box">
              <strong>Ambiente local de teste</strong>
              <p>
                Nenhum e-mail foi enviado. Use o link abaixo para validar o
                acesso.
              </p>
              <a href={localLink}>Abrir link de teste →</a>
            </div>
          )}
          <p className="login-note">
            <Check size={16} />
            Participante externo? Abra o link de aceite recebido por e-mail. Não
            precisa de conta.
          </p>
        </div>
      </section>
    </main>
  );
}
