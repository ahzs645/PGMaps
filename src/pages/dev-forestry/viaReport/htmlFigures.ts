/**
 * How a report draws the block kinds its figure layouts add (map pages, before / after figure pages, photo and
 * simulation pairs, render grids), in HTML and Markdown. Unknown kinds draw nothing. Every picture place prints its
 * picture, or a dashed box saying what goes there. No DOM or network access.
 */
import { escapeHtml as e } from '@/branding/presentation'

import { panoramaBand } from '../figureFraming'
import { layoutBlockMarks, MARK_LINE_HEIGHT, markRows } from './blockMarks'
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
.vf-pair-caption{font-size:11px;color:#1a2530;margin:6px 0 0}
.vf-map{margin:12px 0;break-inside:avoid}.vf-map .vf-fit{width:min(100%,calc(7.2in * var(--ar)))}
.vf-map .vf-pic.vf-empty{height:3.5in;display:flex}
.vf-key{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;font-size:10px;margin-top:4px}
.vf-key .vf-swatch{display:inline-block;width:18px;height:10px;margin-right:4px;vertical-align:middle;border:1px solid #475569}
.vf-key .vf-swatch.line{height:0;border:0;border-top:3px solid}.vf-key .vf-swatch.point{width:9px;height:9px;border-radius:50%}
.vf-key .vf-scale{font-weight:600}
.vf-grid{margin:12px 0;break-inside:avoid}.vf-cells{display:grid;gap:12px}.vf-cols-1{grid-template-columns:1fr}.vf-cols-2{grid-template-columns:1fr 1fr}.vf-cols-3{grid-template-columns:1fr 1fr 1fr}
.vf-cell .vf-fit{width:100%}.vf-cell .vf-pic.vf-empty{height:1.8in;display:flex}
.vf-cell .vf-label{font-size:10px;color:#475569;margin-top:2px}
.vf-map.vf-compact .vf-fit{width:min(100%,calc(4.2in * var(--ar)))}
.vf-sheet{page:sheet;break-before:page;break-after:page;display:flex;flex-direction:column;height:10.2in}.vf-sheet .vf-pair-item{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;justify-content:center;margin:0}.vf-sheet .vf-pair-item .vf-fit{width:min(100%,calc(9.4in * var(--ar)))}.vf-sheet .vf-pair-item .vf-pic.vf-empty{height:6in}
.vf-landscape{page:via-figure;break-before:page;margin:0}.vf-landscape .vf-pair-item .vf-fit{width:min(100%,calc(6.3in * var(--ar)))}.vf-grid.vf-landscape .vf-cell .vf-fit{width:min(100%,calc(5.6in * var(--ar)))}
@media screen{.vf-page{border:1px solid #cbd5e1;padding:12px;margin:16px 0;height:auto;min-height:640px;aspect-ratio:10/7.3}}`

const NORTH_ARROW =
  '<svg class="vf-north" viewBox="0 0 16 26" role="img" aria-label="North"><path d="M8 1 L14 15 L8 12 L2 15 Z" fill="#000" stroke="#fff" stroke-width="0.8"/><text x="8" y="24.5" font-size="9" font-weight="700" text-anchor="middle" fill="#000" stroke="#fff" stroke-width="0.3">N</text></svg>'

/**
 * The rows a panorama slot shows (`panoramaBand`): a band round its landform that keeps the marks of `panoramaHold`, the
 * same for the before and after pictures. Null when the slot shows its picture whole.
 */
export function bandOf(slot: FigureSlot): { y: number; height: number } | null {
  const figure = slot.figure
  if (!slot.panorama || !figure) return null
  const hold = markRows(slot.panoramaHold ?? [], figure.width, figure.height)
  return panoramaBand(figure.landformRows, figure.width, figure.height, slot.panorama, hold)
}

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
  // A panorama shows a band of the picture round its landform rows and its blocks: the box takes the band's shape and
  // the picture covers it, positioned so the band shows; the marks' view box is the same band.
  const band = bandOf(slot)
  if (band) {
    const position = band.y / Math.max(1, slot.figure.height - band.height)
    return `<div class="vf-pic vf-fit vf-pano" style="--ar:${(slot.figure.width / band.height).toFixed(4)}">${img(
      slot.figure,
      slot.label,
    ).replace(
      '<img ',
      `<img style="object-fit:cover;object-position:50% ${(position * 100).toFixed(2)}%" `,
    )}${blockMarks(slot, band)}${north}${label}</div>`
  }
  const aspect = fit ? aspectOf(slot.figure) : 0
  return `<div class="vf-pic${aspect ? ' vf-fit' : ''}"${aspect ? ` style="--ar:${aspect.toFixed(4)}"` : ''}>${img(
    slot.figure,
    slot.label,
  )}${blockMarks(slot)}${north}${label}</div>`
}

/**
 * The slot's block marks over the picture, in an SVG sized to the picture so `meet` lines it up with the picture's
 * `object-fit: contain`. An unseen block gets a dashed ring, a seen one (with `all`) an arrow, never an outline; the
 * names sit in one row inside the shown picture, each led to its mark (`layoutBlockMarks`).
 */
function blockMarks(slot: FigureSlot, band: { y: number; height: number } | null = null): string {
  const figure = slot.figure
  if (!figure?.marks?.length || !slot.markBlocks) return ''
  const w = figure.width,
    h = figure.height
  const placed = layoutBlockMarks(figure.marks, w, h, { all: slot.markBlocks === 'all', band })
  if (!placed.length) return ''
  const n = (value: number) => value.toFixed(1)
  const items = placed.map((mark) => {
    const [x, y] = mark.anchor
    const size = mark.size
    const symbol = mark.unseen
      ? `<circle cx="${n(x)}" cy="${n(y)}" r="${n(mark.ring)}" fill="none" stroke="#fff" stroke-width="${n(size * 0.28)}"/><circle cx="${n(x)}" cy="${n(y)}" r="${n(mark.ring)}" fill="none" stroke="#d00" stroke-width="${n(size * 0.16)}" stroke-dasharray="${n(size * 0.5)} ${n(size * 0.3)}"/>`
      : ''
    let leader = ''
    if (mark.leader) {
      const [[x1, y1], [x2, y2]] = mark.leader
      const halo = `stroke="#000" stroke-opacity="0.55" stroke-width="${n(size * 0.34)}"`
      const line = (stroke: string) =>
        `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" ${stroke} stroke-linecap="round"/>`
      if (mark.unseen) leader = line(halo) + line(`stroke="#fff" stroke-width="${n(size * 0.14)}"`)
      else {
        // An arrowhead at the block, pointing along the leader.
        const len = Math.hypot(x2 - x1, y2 - y1) || 1
        const ux = (x2 - x1) / len,
          uy = (y2 - y1) / len
        const head = size * 0.9,
          half = size * 0.45
        const bx = x2 - ux * head,
          by = y2 - uy * head
        leader = `${line(halo)}${line(`stroke="#fff" stroke-width="${n(size * 0.22)}"`).replace(
          `x2="${n(x2)}" y2="${n(y2)}"`,
          `x2="${n(bx)}" y2="${n(by)}"`,
        )}<path d="M${n(bx - uy * half)} ${n(by + ux * half)} L${n(x2)} ${n(y2)} L${n(bx + uy * half)} ${n(by - ux * half)} Z" fill="#fff" stroke="#000" stroke-opacity="0.55" stroke-width="${n(size * 0.08)}"/>`
      }
    }
    const box = mark.box
    const label = box
      ? `<text x="${n(box.x + box.w / 2)}" y="${n(box.y + size * 0.92)}" font-size="${n(size)}" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="${n(size * 0.18)}" paint-order="stroke" font-family="Arial,Helvetica,sans-serif" font-weight="700">${mark.lines
          .map(
            (line, i) =>
              `<tspan x="${n(box.x + box.w / 2)}"${i ? ` dy="${n(size * MARK_LINE_HEIGHT)}"` : ''}>${e(line)}</tspan>`,
          )
          .join('')}</text>`
      : ''
    return symbol + leader + label
  })
  return `<svg class="vf-marks" viewBox="0 ${band ? band.y : 0} ${w} ${band ? band.height : h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${items.join('')}</svg>`
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
    // A panorama's box takes the band's shape, not the whole picture's.
    const band = bandOf(s)
    const aspect =
      sized && s.figure && s.figure.width > 0 && s.figure.height > 0
        ? s.figure.width / (band ? band.height : s.figure.height)
        : 0
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
  // A label the pair's title already prints is not printed again under its picture.
  const named = (s: FigureSlot) => !!block.title && block.title.includes(s.label)
  const items = block.slots.map(
    (s) =>
      `<figure class="vf-pair-item">${picture(s, block.placement === 'inset' ? s.label : undefined, true)}${
        block.placement === 'caption' && !named(s) ? `<figcaption>${e(s.label)}</figcaption>` : ''
      }${note(s)}</figure>`,
  )
  const page = block.sheet ? ' vf-sheet' : block.landscape ? ' vf-landscape' : ''
  return `<section class="vf-pair${page}">${block.title ? `<h4>${e(block.title)}</h4>` : ''}${items.join('')}${
    block.caption ? `<p class="vf-pair-caption">${e(block.caption)}</p>` : ''
  }</section>`
}

function mapFigureHtml(block: MapFigureBlock): string {
  return `<figure class="vf-map${block.compact ? ' vf-compact' : ''}">${picture(block.slot, undefined, true)}${mapKey(block.slot.figure?.map)}${note(block.slot)}<figcaption>${e(
    block.caption,
  )}</figcaption></figure>`
}

function figureGridHtml(block: FigureGridBlock): string {
  const cells = block.slots.map(
    (s) =>
      `<div class="vf-cell">${picture(s, undefined, true)}${s.figure ? `<p class="vf-label">${e(s.label)}</p>` : ''}${note(s)}</div>`,
  )
  return `<figure class="vf-grid${block.landscape ? ' vf-landscape' : ''}"><div class="vf-cells vf-cols-${block.columns}">${cells.join('')}</div><figcaption>${e(
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
      return [
        ...(block.title ? [`**${block.title}**`, ''] : []),
        ...block.slots.map(slotMarkdown),
        ...(block.caption ? ['', `_${block.caption}_`] : []),
      ].join('\n')
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
