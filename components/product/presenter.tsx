'use client';
/* eslint-disable next/no-html-link-for-pages -- Sources open authorized records in a separate tab without interrupting audio. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Maximize,
  Minimize,
  Presentation,
} from 'lucide-react';
import type { MaterialSnapshot } from '@/lib/domain/materials';
import { api, Btn, ErrorNotice } from './shared';

export function MeetingPresenter({
  orgId,
  meetingId,
  revision,
  children,
}: {
  orgId: string;
  meetingId: string;
  revision: number;
  children: ReactNode;
}) {
  const [materials, setMaterials] = useState<
    { id: string; revision: number; createdAt: string }[]
  >([]);
  const [deck, setDeck] = useState<MaterialSnapshot | null>(null);
  const [selected, setSelected] = useState('');
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const surface = useRef<HTMLElement>(null);
  useEffect(() => {
    let active = true;
    api<typeof materials>('meetings/' + meetingId + '/materials', {}, orgId)
      .then((value) => {
        if (active) setMaterials(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [meetingId, orgId]);
  useEffect(() => {
    const update = () =>
      setFullscreen(document.fullscreenElement === surface.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  useEffect(() => {
    let active = true;
    if (!selected) return;
    api<MaterialSnapshot>(
      `meetings/${meetingId}/materials/${selected}?format=json`,
      {},
      orgId,
    )
      .then((value) => {
        if (active) {
          setDeck(value);
          setIndex(0);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selected, meetingId, orgId]);
  const slide = deck?.slides[index];
  return (
    <section className="panel meeting-presenter section-gap" ref={surface}>
      <div className="section-head">
        <div>
          <h2>
            <Presentation size={20} /> Apresentação e gravação
          </h2>
          <p className="muted">
            Os slides são opcionais. Trocar de slide ou sair da tela cheia
            mantém a gravação.
          </p>
        </div>
        <Btn
          secondary
          onClick={async () => {
            try {
              if (document.fullscreenElement) await document.exitFullscreen();
              else if (surface.current?.requestFullscreen)
                await surface.current.requestFullscreen();
              else
                setError(
                  'Tela cheia indisponível neste navegador. Continue apresentando nesta página.',
                );
            } catch {
              setError(
                'Não foi possível abrir a tela cheia. Continue nesta página.',
              );
            }
          }}
        >
          {fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
          {fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
        </Btn>
      </div>
      <label>
        Slides salvos
        <select
          value={selected}
          onChange={(event) => {
            setDeck(null);
            setError('');
            setSelected(event.target.value);
            setLoading(!!event.target.value);
          }}
        >
          <option value="">Reunião sem slides</option>
          {materials.map((material) => (
            <option key={material.id} value={material.id}>
              {new Date(material.createdAt).toLocaleString('pt-BR')}
              {material.revision !== revision ? ' · preparação anterior' : ''}
            </option>
          ))}
        </select>
      </label>
      <ErrorNotice message={error} />
      {loading && <output>Carregando apresentação…</output>}
      {deck && slide && (
        <div className="presenter-deck">
          {deck.revision !== revision && (
            <p className="notice">
              Este material retrata uma preparação anterior. Confira a pauta
              atual antes de conduzir a discussão.
            </p>
          )}
          <article
            className="presenter-slide"
            aria-label={`Slide ${index + 1} de ${deck.slides.length}`}
          >
            <p className="eyebrow">{slide.label}</p>
            <h2>{slide.title}</h2>
            {slide.paragraphs.map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
            <footer>
              {slide.sources.map((source, i) => (
                <a key={i} href={source.href} target="_blank" rel="noreferrer">
                  Fonte: {source.title}
                </a>
              ))}
            </footer>
          </article>
          <div className="presenter-navigation">
            <Btn
              secondary
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
            >
              <ArrowLeft size={17} />
              Anterior
            </Btn>
            <output>
              {index + 1} / {deck.slides.length}
            </output>
            <Btn
              secondary
              disabled={index === deck.slides.length - 1}
              onClick={() => setIndex(index + 1)}
            >
              Próximo
              <ArrowRight size={17} />
            </Btn>
          </div>
        </div>
      )}
      {!selected && (
        <p className="muted">
          Para usar slides, gere o material em Preparação depois de revisar e
          salvar a pauta.
        </p>
      )}
      {children}
    </section>
  );
}
