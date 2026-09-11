'use client';
/* eslint-disable next/no-html-link-for-pages -- Downloads and the standalone deck require document navigation. */
import { useEffect, useRef, useState } from 'react';
import { Presentation, Download, Eye } from 'lucide-react';
import { api, send, Btn, ErrorNotice, useAction } from './shared';
type Material = { id: string; revision: number; createdAt: string };
export function MeetingMaterials({
  orgId,
  meetingId,
  revision,
  canEdit,
  hasAgenda,
}: {
  orgId: string;
  meetingId: string;
  revision: number;
  canEdit: boolean;
  hasAgenda: boolean;
}) {
  const [materials, setMaterials] = useState<Material[]>([]),
    [reviewed, setReviewed] = useState(false),
    [selected, setSelected] = useState('');
  const requestId = useRef(crypto.randomUUID());
  const a = useAction(),
    setError = a.setError;
  useEffect(() => {
    void api<Material[]>('meetings/' + meetingId + '/materials', {}, orgId)
      .then(setMaterials)
      .catch(setError);
  }, [meetingId, orgId, setError]);
  const href = (materialId: string, download = false) =>
    `/api/meetings/${meetingId}/materials/${materialId}?org=${orgId}${download ? '&download=1' : ''}`;
  return (
    <section className="panel section-gap">
      <div className="section-head">
        <div>
          <h2>Materiais de apoio</h2>
          <p className="muted">
            Apresentação a partir da pauta salva, com contexto das origens
            autorizadas.
          </p>
        </div>
        <Presentation size={22} />
      </div>
      {canEdit && (
        <>
          <label className="proposal-choice">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={!hasAgenda || a.busy}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            Revisei a pauta salva e quero gerar os slides
          </label>
          <Btn
            type="button"
            busy={a.busy}
            disabled={!reviewed || !hasAgenda}
            onClick={() =>
              a.act(async () => {
                const material = await send(
                  'meetings/' + meetingId + '/materials',
                  {
                    requestId: requestId.current,
                    revision,
                    agendaReviewed: true,
                  },
                  orgId,
                );
                setMaterials(
                  await api<Material[]>(
                    'meetings/' + meetingId + '/materials',
                    {},
                    orgId,
                  ),
                );
                setSelected(material.id);
                requestId.current = crypto.randomUUID();
                setReviewed(false);
              })
            }
          >
            <Presentation size={17} />
            Gerar apresentação
          </Btn>
          {!hasAgenda && (
            <p className="muted">Salve a pauta antes de gerar o material.</p>
          )}
        </>
      )}
      <ErrorNotice message={a.error} />
      {materials.length === 0 && (
        <p className="muted">
          Nenhum material disponível para você nesta reunião.
        </p>
      )}
      <div className="material-list">
        {materials.map((material) => (
          <article key={material.id} className="material-row">
            <div>
              <strong>Apresentação da pauta</strong>
              <p className="muted">
                {new Date(material.createdAt).toLocaleString('pt-BR')}
                {material.revision !== revision
                  ? ' · Versão anterior da preparação'
                  : ''}
              </p>
            </div>
            <div className="material-actions">
              <a
                className="primary"
                href={`/reunioes/${meetingId}?org=${orgId}&tab=conteudo`}
              >
                Apresentar e gravar
              </a>
              <Btn
                type="button"
                secondary
                onClick={() => setSelected(material.id)}
              >
                <Eye size={16} />
                Visualizar
              </Btn>
              <a
                className="secondary"
                href={href(material.id)}
                target="_blank"
                rel="noreferrer"
              >
                Apresentar / PDF
              </a>
              <a className="secondary" href={href(material.id, true)}>
                <Download size={16} />
                Baixar HTML
              </a>
            </div>
          </article>
        ))}
      </div>
      {selected && (
        <div className="material-preview">
          <p className="muted">
            Arquivo independente para abrir no navegador. Para PDF, abra
            “Apresentar / PDF” e use Imprimir.
          </p>
          <iframe
            title="Slides de apoio à reunião"
            src={href(selected)}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
          />
        </div>
      )}
    </section>
  );
}
