import type { Agenda } from './model';
import type { Source } from './memory';
export type MaterialSlide = {
  title: string;
  label: string;
  paragraphs: string[];
  sources: { title: string; href: string }[];
};
export type MaterialSnapshot = {
  title: string;
  objective: string;
  agenda: Agenda;
  sources: Source[];
  slides: MaterialSlide[];
  revision: number;
  createdAt: string;
  meetingId: string;
  orgId: string;
};
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
// Bounded pages preserve the complete source text and do not silently cut long agendas.
export function textPages(text: string, max = 650): string[] {
  const pages: string[] = [];
  while (text.length > max) {
    let at = text.lastIndexOf(' ', max);
    if (at < max / 2) at = max;
    pages.push(text.slice(0, at));
    text = text.slice(at).trimStart();
  }
  if (text) pages.push(text);
  return pages;
}
export function materialSlides(input: {
  title: string;
  objective: string;
  agenda: Agenda;
  sources: Source[];
  meetingHref: string;
}): MaterialSlide[] {
  const meetingSource = {
    title: 'Pauta revisada da reunião',
    href: input.meetingHref,
  };
  const slides: MaterialSlide[] = [
    {
      title: input.title,
      label: 'Material de apoio à discussão',
      paragraphs: [
        'Pauta e contexto para a reunião. Os itens de discussão são propostas. Decisões anteriores aparecem identificadas pelas fontes.',
      ],
      sources: [meetingSource],
    },
  ];
  for (const [i, text] of textPages(
    input.objective || 'Objetivo não informado na preparação.',
  ).entries())
    slides.push({
      title: i ? 'Objetivo da reunião (continuação)' : 'Objetivo da reunião',
      label: 'Preparação revisada',
      paragraphs: [text],
      sources: [meetingSource],
    });
  const appendPages = (title: string, paragraphs: string[], label: string) => {
    let page: string[] = [];
    let size = 0;
    let count = 0;
    const flush = () => {
      if (page.length)
        slides.push({
          title: title + (count++ ? ' (continuação)' : ''),
          label,
          paragraphs: page,
          sources: [meetingSource],
        });
      page = [];
      size = 0;
    };
    for (const paragraph of paragraphs)
      for (const part of textPages(paragraph)) {
        if (size + part.length > 650) flush();
        page.push(part);
        size += part.length;
      }
    flush();
  };
  appendPages(
    'Agenda',
    input.agenda.map((item, index) => `${index + 1}. ${item.title}`),
    'Propostas para discussão',
  );
  if (!input.sources.length)
    slides.push({
      title: 'Contexto anterior',
      label: 'Fontes de apoio',
      paragraphs: [
        'Nenhum contexto anterior autorizado foi incluído neste material. Os próximos pontos partem da pauta revisada.',
      ],
      sources: [meetingSource],
    });
  for (const source of input.sources) {
    const title =
      source.kind === 'task' && ['open', 'in_progress'].includes(source.status)
        ? 'Pendência anterior'
        : source.kind === 'decision'
          ? 'Decisão anterior'
          : 'Contexto registrado';
    for (const [i, text] of textPages(source.body).entries())
      slides.push({
        title: title + (i ? ' (continuação)' : ''),
        label: source.state + ' (registro de origem)',
        paragraphs: [text],
        sources: [{ title: source.title, href: source.href }],
      });
  }
  appendPages(
    'Questões para discussão',
    input.agenda.map(
      (item) =>
        `Sobre “${item.title}”: o que precisa ser esclarecido e qual encaminhamento deve ser discutido?`,
    ),
    'Perguntas propostas',
  );
  return slides;
}
export function renderMaterial(snapshot: MaterialSnapshot, origin: string) {
  const url = (href: string) => {
    if (!href.startsWith('/') || href.startsWith('//'))
      throw new Error('Origem inválida.');
    const target = new URL(href, origin);
    if (target.origin !== new URL(origin).origin)
      throw new Error('Origem inválida.');
    return escape(target.href);
  };
  const slideHtml = snapshot.slides
    .map(
      (slide, index) =>
        `<section class="slide" id="slide-${index + 1}" aria-label="Slide ${index + 1}"><header><span>Anota Aí</span><span>${index + 1} / ${snapshot.slides.length}</span></header><p class="label">${escape(slide.label)}</p><h1>${escape(slide.title)}</h1><div class="body">${slide.paragraphs.map((p) => `<p>${escape(p)}</p>`).join('')}</div><footer>${slide.sources.map((s) => `<a target="_blank" rel="noreferrer" href="${url(s.href)}">Fonte: ${escape(s.title)}</a>`).join('')}<small>Contexto registrado em ${escape(snapshot.createdAt.slice(0, 10))}</small></footer><nav aria-label="Navegação dos slides">${index ? `<a href="#slide-${index}">Anterior</a>` : ''}${index < snapshot.slides.length - 1 ? `<a href="#slide-${index + 2}">Próximo</a>` : ''}</nav></section>`,
    )
    .join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escape(snapshot.title)} — Anota Aí</title><style>
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-snap-type:y proximity}body{margin:0;background:#dbe4f3;color:#19283e;font-family:Arial,Helvetica,sans-serif}.instructions{padding:16px;text-align:center;font-size:16px}.slide{position:relative;scroll-snap-align:start;width:min(1120px,100%);min-height:630px;margin:24px auto;padding:42px 58px;background:#fff;display:flex;flex-direction:column;break-after:page;overflow-wrap:anywhere}header{display:flex;justify-content:space-between;color:#2858da;font-weight:700;font-size:18px;margin-bottom:28px}.label{font-size:17px;color:#58677e;margin:0 0 10px}h1{font-size:42px;line-height:1.1;margin:0 0 24px;font-weight:700}.body{flex:1;font-size:23px;line-height:1.42;white-space:pre-wrap}.body p{margin:0 0 18px}footer{border-top:1px solid #d9e1ef;padding-top:12px;margin-top:20px;font-size:14px}footer a{color:#2858da;display:block;line-height:1.4}footer small{display:block;margin-top:8px;color:#59677d;font-size:13px}nav{display:flex;justify-content:flex-end;gap:24px;margin-top:20px;font-size:16px}nav a{color:#2858da}@media(max-width:650px){.slide{padding:24px;min-height:85vh}h1{font-size:32px}.body{font-size:20px}}@page{size:A4 landscape;margin:0}@media print{html{scroll-snap-type:none}body{background:white}.instructions,nav{display:none}.slide{width:297mm;min-height:210mm;margin:0;padding:13mm 16mm;box-shadow:none;break-after:page}h1{font-size:30pt}.body{font-size:17pt}.slide:last-child{break-after:auto}a{text-decoration:none}}
</style></head><body><div class="instructions">Use Anterior e Próximo para apresentar. Para PDF, use Imprimir e escolha Salvar como PDF no navegador.</div>${slideHtml}</body></html>`;
}
