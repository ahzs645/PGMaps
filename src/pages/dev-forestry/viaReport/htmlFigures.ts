/**
 * How a report draws the block kinds its figure layouts add (map pages, before / after figure pages, photo and
 * simulation pairs, render grids), in HTML and Markdown. Unknown kinds draw nothing. Every picture place prints its
 * picture, or a dashed box saying what goes there. No DOM or network access.
 */
import { escapeHtml as e } from '@/branding/presentation'

import type { FieldRow, FigureSlot, MapFurniture, ReportBlock, ReportFigure } from './model'

type FigurePageBlock = Extract<ReportBlock, { kind: 'figurePage' }>
type FigurePairBlock = Extract<ReportBlock, { kind: 'figurePair' }>
type MapFigureBlock = Extract<ReportBlock, { kind: 'mapFigure' }>
type FigureGridBlock = Extract<ReportBlock, { kind: 'figureGrid' }>

/** The header bars' blue on the figure pages (26 p128–129, sampled #167aca). */
const BAR = '#167aca'

/**
 * Print and screen styles for the figure layouts, added to the report's own (`html.ts`). The figure page is a named
 * page, `via-figure`, letter landscape whatever the report's paper, with no running header (26 prints none).
 */
export const FIGURES_CSS = `@page via-figure{size:letter landscape;margin:0.45in 0.5in 0.5in;@top-left{content:none}}
.vf-page{page:via-figure;break-before:page;break-after:page;display:grid;grid-template-columns:2.3in 1fr;gap:0.1in;height:7.3in;margin:0;font-family:Arial,Helvetica,sans-serif}
.vf-side,.vf-main{display:flex;flex-direction:column;gap:0.08in;min-height:0}.vf-main{gap:0.3in}
.vf-box{border:1px solid #000;text-align:center;font-weight:700;font-size:11px;line-height:1.3;padding:3px 6px}
.vf-box .vf-number{display:block}.vf-facts .blank{min-width:70px}
.vf-slot{display:flex;flex-direction:column;flex:1;min-height:0}
.vf-bar{background:${BAR};color:#fff;font-weight:700;font-size:11px;text-transform:uppercase;text-align:center;padding:2px 4px;border:1px solid #000;border-bottom:0;letter-spacing:.01em}
.vf-pic{flex:1;min-height:0;border:1px solid #000;display:flex;align-items:center;justify-content:center;background:#fff;position:relative;overflow:hidden}
.vf-pic img{width:100%;height:100%;object-fit:contain;border:0;display:block}
.vf-pic svg.vf-marks{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.vf-empty{border:1px dashed #94a3b8;color:#64748b;font-size:11px;text-align:center;padding:10px;font-weight:400}
.vf-note{font-size:9px;color:#475569;margin:2px 0 0}
.vf-main .vf-sized{flex:none;align-self:center;width:min(100%,calc(3.05in * var(--ar)))}.vf-main .vf-sized .vf-pic{flex:none;aspect-ratio:var(--ar)}
.vf-north{position:absolute;top:4px;right:4px;width:16px;height:26px}
.vf-pair{break-before:page;break-inside:avoid;margin:0}.vf-pair h4{margin:0 0 8px}
.vf-fit{aspect-ratio:var(--ar);margin:0 auto}.vf-fit img{width:100%;height:100%}
.vf-pair-item{margin:0 0 16px;break-inside:avoid}.vf-pair-item .vf-fit{width:min(100%,calc(3.9in * var(--ar)))}
.vf-pair-item .vf-pic.vf-empty{height:2.4in;display:flex}
.vf-inset{position:absolute;top:4px;left:6px;background:rgba(255,255,255,.75);color:#000;font:13px Arial,Helvetica,sans-serif;padding:0 3px}
.vf-pair-item figcaption,.vf-map figcaption,.vf-grid figcaption{font-size:11px;font-weight:700;color:#1a2530;margin-top:4px}
.vf-map{margin:12px 0;break-inside:avoid}.vf-map .vf-fit{width:min(100%,calc(7.2in * var(--ar)))}
.vf-map .vf-pic.vf-empty{height:3.5in;display:flex}
.vf-key{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;font-size:10px;margin-top:4px}
.vf-key .vf-swatch{display:inline-block;width:18px;height:10px;margin-right:4px;vertical-align:middle;border:1px solid #475569}
.vf-key .vf-swatch.line{height:0;border:0;border-top:3px solid}.vf-key .vf-swatch.point{width:9px;height:9px;border-radius:50%}
.vf-key .vf-scale{font-weight:600}
.vf-grid{margin:12px 0;break-inside:avoid}.vf-cells{display:grid;gap:12px}.vf-cols-1{grid-template-columns:1fr}.vf-cols-2{grid-template-columns:1fr 1fr}.vf-cols-3{grid-template-columns:1fr 1fr 1fr}
.vf-cell .vf-fit{width:100%}.vf-cell .vf-pic.vf-empty{height:1.8in;display:flex}
.vf-cell .vf-label{font-size:10px;color:#475569;margin-top:2px}
@media screen{.vf-page{border:1px solid #cbd5e1;padding:12px;margin:16px 0;height:auto;min-height:640px;aspect-ratio:10/7.3}}`

const NORTH_ARROW =
  '<svg class="vf-north" viewBox="0 0 16 26" role="img" aria-label="North"><path d="M8 1 L14 15 L8 12 L2 15 Z" fill="#000" stroke="#fff" stroke-width="0.8"/><text x="8" y="24.5" font-size="9" font-weight="700" text-anchor="middle" fill="#000" stroke="#fff" stroke-width="0.3">N</text></svg>'

const aspectOf = (figure: ReportFigure) => (figure.width > 0 && figure.height > 0 ? figure.width / figure.height : 0)

function img(figure: ReportFigure, alt: string): string {
  return `<img src="${e(figure.dataUrl)}" width="${figure.width}" height="${figure.height}" alt="${e(alt)}">`
}

/** The picture box of a slot: the picture (a map's north arrow over it), or the dashed placeholder. */
/**
 * The picture box of a slot: the picture (a map's north arrow over it), or the dashed placeholder. `fit` shapes the
 * box to the picture (`--ar`), so its border wraps the picture rather than a band of white beside it.
 */
function picture(slot: FigureSlot, inset?: string, fit = false): string {
  const label = inset ? `<span class="vf-inset">${e(inset)}</span>` : ''
  if (!slot.figure) return `<div class="vf-pic vf-empty"><p>${e(slot.placeholder)}</p></div>`
  const map = slot.figure.map
  const north = map?.northUp && !map.inPicture ? NORTH_ARROW : ''
  const aspect = fit ? aspectOf(slot.figure) : 0
  return `<div class="vf-pic${aspect ? ' vf-fit' : ''}"${aspect ? ` style="--ar:${aspect.toFixed(4)}"` : ''}>${img(
    slot.figure,
    slot.label,
  )}${blockMarks(slot)}${north}${label}</div>`
}

const UNSEEN: Record<string, string> = {
  'possible glimpses': 'glimpses only',
  'not visible': 'not visible',
  unknown: 'not known',
}

/**
 * The slot's block marks over the picture, in an SVG sized to the picture so `meet` lines it up with the picture's
 * `object-fit: contain`. An unseen block gets a dashed ring and its name with what is seen of it; with `all`, a seen
 * block gets an arrow from above and its name, never an outline.
 */
function blockMarks(slot: FigureSlot): string {
  const figure = slot.figure
  if (!figure?.marks?.length || !slot.markBlocks) return ''
  const w = figure.width,
    h = figure.height
  const size = Math.max(10, w * 0.022)
  const marks = figure.marks.filter((m) => slot.markBlocks === 'all' || UNSEEN[m.status])
  if (!marks.length) return ''
  const items = marks.map((m) => {
    const x = m.x * w,
      y = m.y * h
    const unseen = UNSEEN[m.status]
    const text = unseen ? `${m.label} (${unseen})` : m.label
    if (unseen) {
      const ty = y - size * 2.2 < size ? y + size * 3.2 : y - size * 1.9
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(size * 1.2).toFixed(1)}" fill="none" stroke="#fff" stroke-width="${(size * 0.28).toFixed(1)}"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(size * 1.2).toFixed(1)}" fill="none" stroke="#d00" stroke-width="${(size * 0.16).toFixed(1)}" stroke-dasharray="${(size * 0.5).toFixed(1)} ${(size * 0.3).toFixed(1)}"/><text x="${x.toFixed(1)}" y="${ty.toFixed(1)}" font-size="${size.toFixed(1)}" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="${(size * 0.18).toFixed(1)}" paint-order="stroke" font-family="Arial,Helvetica,sans-serif" font-weight="700">${e(text)}</text>`
    }
    const top = Math.max(size * 1.2, y - size * 4)
    return `<line x1="${x.toFixed(1)}" y1="${(top + size * 0.4).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y - size * 0.5).toFixed(1)}" stroke="#fff" stroke-width="${(size * 0.22).toFixed(1)}"/><path d="M${(x - size * 0.45).toFixed(1)} ${(y - size * 0.9).toFixed(1)} L${x.toFixed(1)} ${y.toFixed(1)} L${(x + size * 0.45).toFixed(1)} ${(y - size * 0.9).toFixed(1)} Z" fill="#fff"/><text x="${x.toFixed(1)}" y="${top.toFixed(1)}" font-size="${size.toFixed(1)}" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="${(size * 0.18).toFixed(1)}" paint-order="stroke" font-family="Arial,Helvetica,sans-serif" font-weight="700">${e(text)}</text>`
  })
  return `<svg class="vf-marks" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${items.join('')}</svg>`
}

/** A map's legend and scale under it, unless the picture prints its own. */
function mapKey(map: MapFurniture | undefined): string {
  if (!map || map.inPicture) return ''
  const rows = (map.legend ?? []).map(
    (row) =>
      `<span><span class="vf-swatch ${row.kind ?? 'area'}" style="${row.kind === 'line' ? 'border-top-color' : 'background'}:${e(row.color)}"></span>${e(row.label)}</span>`,
  )
  if (map.scale) rows.push(`<span class="vf-scale">${e(map.scale)}</span>`)
  return rows.length ? `<div class="vf-key">${rows.join('')}</div>` : ''
}

const note = (slot: FigureSlot) => (slot.figure && slot.note ? `<p class="vf-note">${e(slot.note)}</p>` : '')

const factLine = (row: FieldRow) =>
  `<span>${e(row.label)}: ${row.value === null ? '<span class="blank"></span>' : e(row.value)}</span>`

function figurePageHtml(block: FigurePageBlock): string {
  // The right column's boxes take their picture's shape, as wide as the column allows (26 fits each to its picture);
  // a missing picture's box takes what height is left. The maps fit inside their boxes.
  const slot = (s: FigureSlot, sized = false) => {
    const aspect = sized && s.figure && s.figure.width > 0 && s.figure.height > 0 ? s.figure.width / s.figure.height : 0
    return `<div class="vf-slot${aspect ? ' vf-sized' : ''}"${aspect ? ` style="--ar:${aspect.toFixed(4)}"` : ''}><div class="vf-bar">${e(
      s.label,
    )}</div>${picture(s)}${note(s)}</div>`
  }
  return `<section class="vf-page"><div class="vf-side"><div class="vf-box vf-title"><span class="vf-number">${e(
    block.number,
  )}</span>${e(block.title)}</div><div class="vf-box vf-facts">${block.facts
    .map(factLine)
    .join('<br>')}</div>${block.side.map((s) => slot(s)).join('')}</div><div class="vf-main">${block.main
    .map((s) => slot(s, true))
    .join('')}</div></section>`
}

function figurePairHtml(block: FigurePairBlock): string {
  const items = block.slots.map(
    (s) =>
      `<figure class="vf-pair-item">${picture(s, block.placement === 'inset' ? s.label : undefined, true)}${
        block.placement === 'caption' ? `<figcaption>${e(s.label)}</figcaption>` : ''
      }${note(s)}</figure>`,
  )
  return `<section class="vf-pair">${block.title ? `<h4>${e(block.title)}</h4>` : ''}${items.join('')}</section>`
}

function mapFigureHtml(block: MapFigureBlock): string {
  return `<figure class="vf-map">${picture(block.slot, undefined, true)}${mapKey(block.slot.figure?.map)}${note(block.slot)}<figcaption>${e(
    block.caption,
  )}</figcaption></figure>`
}

function figureGridHtml(block: FigureGridBlock): string {
  const cells = block.slots.map(
    (s) =>
      `<div class="vf-cell">${picture(s, undefined, true)}${s.figure ? `<p class="vf-label">${e(s.label)}</p>` : ''}${note(s)}</div>`,
  )
  return `<figure class="vf-grid"><div class="vf-cells vf-cols-${block.columns}">${cells.join('')}</div><figcaption>${e(
    block.caption,
  )}</figcaption></figure>`
}

export function extraBlockHtml(block: ReportBlock): string {
  switch (block.kind) {
    case 'figurePage':
      return figurePageHtml(block)
    case 'figurePair':
      return figurePairHtml(block)
    case 'mapFigure':
      return mapFigureHtml(block)
    case 'figureGrid':
      return figureGridHtml(block)
    default:
      return ''
  }
}

/** One slot as a Markdown line: the picture's caption, or what goes there. */
const slotMarkdown = (s: FigureSlot) =>
  `- ${s.label}: ${s.figure ? `_${s.figure.caption || s.figure.view}_${s.note ? ` (${s.note})` : ''}` : `to come, ${s.placeholder}`}`

export function extraBlockMarkdown(block: ReportBlock): string {
  switch (block.kind) {
    case 'figurePage':
      return [
        `**${block.number}: ${block.title}**`,
        '',
        ...block.facts.map((row) => `- ${row.label}: ${row.value ?? '______'}`),
        ...[...block.side, ...block.main].map(slotMarkdown),
      ].join('\n')
    case 'figurePair':
      return [...(block.title ? [`**${block.title}**`, ''] : []), ...block.slots.map(slotMarkdown)].join('\n')
    case 'mapFigure': {
      const map = block.slot.figure?.map
      const key =
        map && !map.inPicture
          ? [
              ...(map.legend?.length ? [`- Legend: ${map.legend.map((row) => row.label).join(', ')}`] : []),
              ...(map.scale ? [`- Scale: ${map.scale}`] : []),
              ...(map.northUp ? ['- North up'] : []),
            ]
          : []
      return [`_${block.caption}_`, '', slotMarkdown(block.slot), ...key].join('\n')
    }
    case 'figureGrid':
      return [`_${block.caption}_`, '', ...block.slots.map(slotMarkdown)].join('\n')
    default:
      return ''
  }
}
