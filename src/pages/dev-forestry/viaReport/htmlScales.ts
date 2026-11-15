/**
 * How a report draws its scales and matrices: the P-MM arrow, the Appendix 1 bar, the partial-cut and clearcut
 * guides, the rating tables. HTML and inline SVG for `html.ts`, and their Markdown reading. No DOM or network access.
 *
 * The arrow axis follows the 2001 forms' "Existing Visual Condition" scale (01): an axis with tick marks and an
 * arrowhead at the right, the class letters above it in their colours, a light band of each class's colour under it
 * and the reading as a red arrow pointing down. The guides follow the poster "A Guide to Visual Quality Objectives":
 * one bar per class on a 0-30% axis, and a grid of class letters on solid class colours with white rules between
 * classes. Rating tables print as ruled forms with a shaded header and the marked cell ticked.
 */
import { escapeHtml as e } from '@/branding/presentation'

import type { ReportBlock } from './model'

type ScaleBlock = Extract<ReportBlock, { kind: 'scale' }>
type MatrixBlock = Extract<ReportBlock, { kind: 'matrix' }>

const INK = '#1f2937'
const MARK = '#b91c1c'
const RULE = '#64748b'

/** Print and screen styles for the scales and matrices, added to the report's own (`html.ts`). */
export const SCALES_CSS = `.scale-block{margin:8px 0 12px;break-inside:avoid}
svg.scale{width:100%;max-width:640px;height:auto;display:block;overflow:visible}svg.scale[data-style="arrow-axis"]{max-width:none}
svg.scale text{font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
svg.scale,table.matrix,.class-guide{-webkit-print-color-adjust:exact;print-color-adjust:exact}
table.matrix{border-collapse:collapse;border:1px solid ${RULE};font-size:12px;break-inside:avoid}
table.matrix th,table.matrix td{border:0.5pt solid #94a3b8;padding:3px 6px;vertical-align:top}
table.matrix thead th{background:#e2e8f0;font-weight:600;color:${INK}}
table.matrix thead th.span{text-align:center;font-weight:500;font-style:italic;background:#eef2f6}
table.matrix tbody th{background:#f8fafc;font-weight:600;width:28%}
table.matrix.compact{width:auto;min-width:55%}
table.matrix td.marked{background:#fdf2f2;outline:1.5px solid ${MARK};outline-offset:-1.5px;font-weight:600}
table.matrix .tick{display:inline-block;min-width:1.15em;height:1.15em;line-height:1.1em;margin-right:5px;text-align:center;border:1.5px solid ${MARK};color:${MARK};font-weight:700;font-size:11px;vertical-align:1px}
.class-guide{display:flex;flex-wrap:wrap;gap:12px 22px;align-items:flex-start;background:#e6e7e8;padding:10px 14px 12px;margin:6px 0;break-inside:avoid}
.class-guide h5{flex-basis:100%;margin:0;font-size:12px;letter-spacing:.02em;text-transform:uppercase}
table.matrix.class-grid{width:auto;border:0;border-collapse:collapse;font-size:11px;margin:0}
table.matrix.class-grid th,table.matrix.class-grid td{border:0}
table.matrix.class-grid thead th{background:none;font-weight:400;text-align:center;padding:1px 2px;color:${INK}}
table.matrix.class-grid thead th.axis{font-size:9.5px;font-weight:700;letter-spacing:.04em}
table.matrix.class-grid tbody th{background:none;width:auto;font-weight:400;text-align:right;vertical-align:middle;padding:0 6px 0 2px}
table.matrix.class-grid th.row-axis{writing-mode:vertical-rl;transform:rotate(180deg);font-size:9.5px;font-weight:700;letter-spacing:.04em;text-align:center;padding:0 2px}
table.matrix.class-grid td{position:relative;min-width:40px;height:30px;padding:2px 3px;text-align:center;vertical-align:middle;color:#fff;border:2px solid #e6e7e8;line-height:1.05}
table.matrix.class-grid td b{display:block;font-size:13px;letter-spacing:.02em}
table.matrix.class-grid td small{display:block;font-size:9px;font-weight:500;opacity:.92}
table.matrix.class-grid td.edge-r{border-right:4px solid #fff}table.matrix.class-grid td.edge-l{border-left:4px solid #fff}
table.matrix.class-grid td.edge-b{border-bottom:4px solid #fff}table.matrix.class-grid td.edge-t{border-top:4px solid #fff}
table.matrix.class-grid td.marked{outline:3px solid ${MARK};outline-offset:-3px;background-clip:padding-box}
table.matrix.class-grid td .grid-x{position:absolute;transform:translate(-50%,-50%);font:900 30px/1 Arial,Helvetica,sans-serif;color:#111;z-index:2;pointer-events:none}
.class-guide.full{display:block}.class-guide.full table.matrix.class-grid{width:100%}.class-guide.full .class-legend{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:8px}.class-guide.full .class-legend b{flex-basis:100%;margin:0}.class-guide.full .class-legend span{margin:0}
table.matrix.class-grid td .tick-badge{position:absolute;top:-7px;right:-6px;width:15px;height:15px;line-height:14px;border-radius:50%;background:${MARK};color:#fff;font-size:10px;font-weight:700;z-index:1}
.class-legend{font-size:11.5px;min-width:150px}.class-legend b{display:block;font-size:12.5px;margin:2px 0 8px}
.class-legend span{display:flex;align-items:center;gap:8px;margin:0 0 7px;text-transform:uppercase;font-size:10.5px}
.class-legend i{display:inline-block;width:26px;height:20px}`

/** Rounded for tidy SVG. */
const r = (value: number) => Math.round(value * 10) / 10

/** Piecewise-linear position along a bar with equally spaced ticks, 0-1; past the last tick it reads over 1. */
function position(value: number, ticks: readonly number[], min: number, max: number): number {
  if (ticks.length >= 2) {
    if (value <= ticks[0]) return 0
    for (let i = 1; i < ticks.length; i++)
      if (value <= ticks[i])
        return (i - 1 + (value - ticks[i - 1]) / (ticks[i] - ticks[i - 1] || 1)) / (ticks.length - 1)
    return 1.01
  }
  if (!(max > min)) return 0
  return value > max ? 1.01 : Math.max(0, (value - min) / (max - min))
}

/** Where a scale's bands, ticks and mark fall along its axis, in SVG units: shared by the drawing and the tests. */
export interface ScaleGeometry {
  width: number
  /** The axis' ticked stretch, and the arrowhead's tip past it. */
  start: number
  end: number
  tip: number
  bands: Array<{ label: string; x0: number; x1: number; centre: number }>
  ticks: Array<{ label: string; x: number }>
  /** Null when nothing is marked. A reading past the last band sits on the stretch before the tip. */
  markX: number | null
}

export function scaleGeometry(block: ScaleBlock): ScaleGeometry {
  const style = block.style ?? 'bar'
  const width = 640
  const [start, end, tip] =
    style === 'guide'
      ? [292, 596, 612]
      : style === 'arrow-axis'
        ? [block.axisLabel ? 58 : 18, 548, 618]
        : [10, 630, 630]
  const ticks = block.ticks.map((tick) => tick.at)
  const min = Math.min(...block.bands.map((b) => b.from), ...ticks)
  const max = Math.max(...block.bands.map((b) => b.to), ...ticks)
  // The guide's axis is linear in percent; the forms space their ticks equally whatever the numbers.
  const at = (value: number) => {
    const p = style === 'guide' ? position(value, [], min, max) : position(value, ticks, min, max)
    return p > 1 ? end + (tip - end) * 0.45 : start + (end - start) * p
  }
  return {
    width,
    start,
    end,
    tip,
    bands: block.bands.map((band) => {
      const x0 = at(band.from)
      const x1 = at(band.to)
      return { label: band.label, x0, x1, centre: (x0 + x1) / 2 }
    }),
    ticks: block.ticks.map((tick) => ({ label: tick.label, x: at(tick.at) })),
    markX: block.mark === null ? null : at(block.mark),
  }
}

/** A downward arrow with its tip at (x, y): the reading. */
function downArrow(x: number, top: number, y: number): string {
  return `<line x1="${r(x)}" x2="${r(x)}" y1="${top}" y2="${y - 7}" stroke="${MARK}" stroke-width="2.4"/><path d="M${r(x - 5.5)} ${y - 9} L${r(x + 5.5)} ${y - 9} L${r(x)} ${y} Z" fill="${MARK}"/>`
}

function markText(x: number, y: number, text: string, width: number): string {
  if (!text) return ''
  const right = x > width - 150
  return `<text x="${r(right ? x - 8 : x + 8)}" y="${y}" font-size="11" font-weight="600" fill="${MARK}" text-anchor="${right ? 'end' : 'start'}">${e(text)}</text>`
}

/** Class labels in their colours, with a paper-white halo so the reading's arrow passes behind them. */
const halo = 'paint-order="stroke" stroke="#fff" stroke-width="3.5" stroke-linejoin="round"'

/** The forms' axis: labels above, light bands under, boundary ticks, an arrowhead, the reading pointing down. */
function arrowAxisSvg(block: ScaleBlock): string {
  const g = scaleGeometry(block)
  const yLabel = 30,
    yAxis = 44,
    band = 8
  const tickLabels = block.ticks.some((tick) => tick.label)
  const height = tickLabels ? 74 : 58
  const bands = block.bands
    .map((b, i) => {
      const { x0, x1 } = g.bands[i]
      return x1 - x0 > 0.5 && b.color
        ? `<rect x="${r(x0)}" y="${yAxis}" width="${r(x1 - x0)}" height="${band}" fill="${b.color}" fill-opacity="0.4"/>`
        : ''
    })
    .join('')
  const edges = new Set<number>()
  for (const b of g.bands) edges.add(r(b.x0)).add(r(b.x1))
  for (const t of g.ticks) if (t.x <= g.end) edges.add(r(t.x))
  const boundaries = [...edges]
    .map((x) => `<line x1="${x}" x2="${x}" y1="${yAxis - 7}" y2="${yAxis + band}" stroke="${INK}" stroke-width="1.3"/>`)
    .join('')
  const axis = `<line x1="${g.start}" x2="${g.tip - 7}" y1="${yAxis}" y2="${yAxis}" stroke="${INK}" stroke-width="1.6"/><path d="M${g.tip - 9} ${yAxis - 4.5} L${g.tip} ${yAxis} L${g.tip - 9} ${yAxis + 4.5} Z" fill="${INK}"/>`
  const centres = block.bands
    .map((b, i) => {
      const x = r(g.bands[i].centre)
      const color = b.color ?? INK
      return `<line x1="${x}" x2="${x}" y1="${yAxis - 6}" y2="${yAxis + band}" stroke="${color}" stroke-width="1.6"/>`
    })
    .join('')
  const labels = block.bands
    .map((b, i) => {
      const chosen = block.markBand === i
      return `<text x="${r(g.bands[i].centre)}" y="${yLabel}" font-size="13" font-weight="${chosen ? 800 : 700}" fill="${b.color ?? INK}" text-anchor="middle" ${halo}>${e(b.label)}</text>`
    })
    .join('')
  const tickText = tickLabels
    ? `${block.axisLabel ? `<text x="${g.start - 10}" y="${yAxis + 25}" font-size="11" fill="${INK}" text-anchor="end">${e(block.axisLabel)}</text>` : ''}${g.ticks
        .map((t) =>
          t.label
            ? `<text x="${r(t.x)}" y="${yAxis + 25}" font-size="11" fill="${INK}" text-anchor="middle">${e(t.label)}</text>`
            : '',
        )
        .join('')}`
    : ''
  const mark =
    g.markX === null
      ? ''
      : `${downArrow(g.markX, 4, yAxis - 1)}${markText(g.markX, 12, block.markLabel ?? '', g.width)}`
  // The arrow goes under the labels so their halo keeps them legible where it crosses them.
  return `<svg class="scale" data-style="arrow-axis" viewBox="0 0 ${g.width} ${height}" role="img" aria-label="${e(block.title)}">${bands}${boundaries}${axis}${centres}${mark}${labels}${tickText}</svg>`
}

/** The poster's clearcut guide: a row per class with its range, a bar on a 0-30% axis, the reading across them. */
function guideSvg(block: ScaleBlock): string {
  const g = scaleGeometry(block)
  // Room above the axis for the reading's arrow and figure only when there is one.
  const top = block.mark === null ? 34 : 50,
    row = 26,
    bottom = top + row * block.bands.length
  const height = bottom + 8
  const header = g.ticks
    .map(
      (t) =>
        `<text x="${r(t.x)}" y="${top - 12}" font-size="11.5" fill="${INK}" text-anchor="middle" ${halo}>${e(t.label)}</text><line x1="${r(t.x)}" x2="${r(t.x)}" y1="${top - 7}" y2="${top - 3}" stroke="${INK}"/>`,
    )
    .join('')
  const rows = block.bands
    .map((b, i) => {
      const y = top + i * row
      const { x0, x1 } = g.bands[i]
      const chosen = block.markBand === i
      const last = i === block.bands.length - 1
      const color = b.color ?? INK
      const bar =
        x1 - x0 > 0.5
          ? `<rect x="${r(x0)}" y="${y + 3}" width="${r(x1 - x0)}" height="${row - 6}" fill="${color}"/>${
              last
                ? `<path d="M${r(x1)} ${y + 3} L${g.tip} ${y + row / 2} L${r(x1)} ${y + row - 3} Z" fill="${color}"/><text x="${r(x1 + 5)}" y="${y + row / 2 + 4}" font-size="11" font-weight="700" fill="#fff" text-anchor="middle">+</text>`
                : ''
            }`
          : ''
      return `${chosen ? `<rect x="0" y="${y}" width="${g.end}" height="${row}" fill="${color}" fill-opacity="0.14"/>` : ''}<text x="4" y="${y + 17}" font-size="12.5" font-weight="${chosen ? 700 : 400}" fill="${INK}">${e(b.name ?? b.label)}</text><text x="${g.start - 14}" y="${y + 17}" font-size="12.5" font-weight="${chosen ? 700 : 400}" fill="${INK}" text-anchor="end">${e(b.range ?? '')}</text>${bar}`
    })
    .join('')
  const rules = Array.from({ length: block.bands.length + 1 }, (_, i) => {
    const y = top + i * row
    return `<line x1="0" x2="${g.end}" y1="${y}" y2="${y}" stroke="${INK}" stroke-width="0.9"/>`
  }).join('')
  const frame = [g.start, g.end]
    .map((x) => `<line x1="${x}" x2="${x}" y1="${top}" y2="${bottom}" stroke="#cbd5e1" stroke-width="1"/>`)
    .join('')
  const mark =
    g.markX === null
      ? ''
      : `<line x1="${r(g.markX)}" x2="${r(g.markX)}" y1="${top}" y2="${bottom + 4}" stroke="${MARK}" stroke-width="1.6" stroke-dasharray="4 3"/>${downArrow(g.markX, 6, top)}${markText(g.markX, 15, block.markLabel ?? '', g.width)}`
  return `<svg class="scale" data-style="guide" viewBox="0 0 ${g.width} ${height}" role="img" aria-label="${e(block.title)}">${rows}${frame}${rules}${mark}${header}</svg>`
}

/** Boxes along a bar: the original drawing, kept for a scale that names no style. */
function barSvg(block: ScaleBlock): string {
  const g = scaleGeometry(block)
  const top = 22,
    h = 22
  const bands = block.bands
    .map((band, i) => {
      const { x0, x1 } = g.bands[i]
      return `<rect x="${r(x0)}" y="${top}" width="${r(Math.max(1, x1 - x0))}" height="${h}" fill="${band.color ?? '#e5e7eb'}" fill-opacity="0.35" stroke="#555" stroke-width="0.6"/><text x="${r((x0 + x1) / 2)}" y="${top + h / 2 + 4}" font-size="11" text-anchor="middle">${e(band.label)}</text>`
    })
    .join('')
  const ticks = g.ticks
    .map(
      (t) =>
        `<line x1="${r(t.x)}" x2="${r(t.x)}" y1="${top + h}" y2="${top + h + 5}" stroke="#333"/><text x="${r(t.x)}" y="${top + h + 17}" font-size="10" text-anchor="middle">${e(t.label)}</text>`,
    )
    .join('')
  const mark =
    g.markX === null
      ? ''
      : `<path d="M${r(g.markX - 6)} 4 L${r(g.markX + 6)} 4 L${r(g.markX)} ${top - 2} Z" fill="${MARK}"/>${markText(g.markX, 13, block.markLabel ?? '', g.width)}`
  return `<svg class="scale" viewBox="0 0 ${g.width} ${top + h + 24}" role="img" aria-label="${e(block.title)}">${bands}${ticks}${mark}</svg>`
}

export function scaleSvg(block: ScaleBlock): string {
  switch (block.style) {
    case 'arrow-axis':
      return arrowAxisSvg(block)
    case 'guide':
      return guideSvg(block)
    default:
      return barSvg(block)
  }
}

export function scaleHtml(block: ScaleBlock): string {
  return `<div class="scale-block"><h4>${e(block.title)}</h4>${scaleSvg(block)}${
    block.mark === null ? '<p class="note">Nothing marked yet.</p>' : ''
  }${block.note ? `<p class="note">${e(block.note)}</p>` : ''}</div>`
}

const TICK = '<span class="tick" aria-label="marked">✓</span>'

/** A header cell with its colour strip: on the left of a row header, along the top of a column header. */
function stripStyle(color: string | null | undefined, side: 'left' | 'top'): string {
  return color ? ` style="border-${side}:5px solid ${color}"` : ''
}

/** A rating or criteria table as a printed form: thin rules, a shaded header, the marked cell ticked. */
function formHtml(block: MatrixBlock): string {
  const marked = new Set(block.marks.map((m) => `${m.row}:${m.column}`))
  const span =
    block.columns.length > 1 && block.columnHeader
      ? `<tr><th></th><th class="span" colspan="${block.columns.length}">${e(block.columnHeader)}</th></tr>`
      : ''
  const head = `${span}<tr><th>${e(block.rowHeader)}</th>${block.columns
    .map((c, i) => `<th${stripStyle(block.columnColors?.[i], 'top')}>${e(c)}</th>`)
    .join('')}</tr>`
  const body = block.rows
    .map(
      (row, r) =>
        `<tr><th${stripStyle(block.rowColors?.[r], 'left')}>${e(row)}</th>${block.cells[r]
          .map((cell, c) => {
            const tint = block.tint?.[r]?.[c]
            const on = marked.has(`${r}:${c}`)
            return `<td${on ? ' class="marked"' : ''}${tint && !on ? ` style="background:${tint}26"` : ''}>${on ? TICK : ''}${e(cell)}</td>`
          })
          .join('')}</tr>`,
    )
    .join('')
  // A table of short factors stays as narrow as a form prints it rather than stretching its one column.
  const compact = block.columns.length <= 2 && block.cells.every((row) => row.every((cell) => cell.length <= 6))
  return `<table class="grid matrix form${compact ? ' compact' : ''}"><thead>${head}</thead><tbody>${body}</tbody></table>`
}

/**
 * The poster's partial-cut guide: solid class colours, the class letter large with the cell's value under it, a white
 * rule wherever the class changes, the axes named along the top and up the side, the harvest types in a key.
 */
function classGridHtml(block: MatrixBlock): string {
  const marked = new Set(block.marks.map((m) => `${m.row}:${m.column}`))
  const letter = (row: number, column: number) => block.letters?.[row]?.[column] ?? null
  const head = `<tr><th></th><th></th><th class="axis" colspan="${block.columns.length}">${e(block.columnHeader)}</th></tr><tr><th></th><th></th>${block.columns
    .map((c) => `<th>${e(c)}</th>`)
    .join('')}</tr>`
  const body = block.rows
    .map((row, r) => {
      const side = r === 0 ? `<th class="row-axis" rowspan="${block.rows.length}">${e(block.rowHeader)}</th>` : ''
      const cells = block.cells[r]
        .map((cell, c) => {
          const own = letter(r, c)
          const edges = [
            c + 1 < block.columns.length && letter(r, c + 1) !== own ? 'edge-r' : '',
            c > 0 && letter(r, c - 1) !== own ? 'edge-l' : '',
            r + 1 < block.rows.length && letter(r + 1, c) !== own ? 'edge-b' : '',
            r > 0 && letter(r - 1, c) !== own ? 'edge-t' : '',
            marked.has(`${r}:${c}`) ? 'marked' : '',
          ].filter(Boolean)
          const fill = block.tint?.[r]?.[c]
          const badge = marked.has(`${r}:${c}`) ? '<span class="tick-badge" aria-label="marked">✓</span>' : ''
          // The X sits in the cell left of and above its point, offset by the fractions, so it can land on a rule.
          const p = block.point
          const x =
            p && Math.floor(p.row + 0.5) === r && Math.min(block.columns.length - 1, Math.floor(p.column)) === c
              ? `<span class="grid-x" style="left:${Math.round((p.column - c + 0.5) * 100)}%;top:${Math.round((p.row - r + 0.5) * 100)}%" aria-label="reading">X</span>`
              : ''
          const value = block.cellValues === false ? '' : `<small>${e(cell)}</small>`
          return `<td${edges.length ? ` class="${edges.join(' ')}"` : ''}${fill ? ` style="background:${fill}"` : ''}>${badge}${x}${
            own ? `<b>${e(own)}</b>${value}` : `<b>${e(cell)}</b>`
          }</td>`
        })
        .join('')
      return `<tr>${side}<th>${e(row)}</th>${cells}</tr>`
    })
    .join('')
  const legend = block.legend
    ? `<div class="class-legend"><b>${e(block.legend.title)}</b>${block.legend.items
        .map((item) => `<span><i style="background:${item.color}"></i>${e(item.label)}</span>`)
        .join('')}</div>`
    : ''
  return `<div class="class-guide full"><table class="matrix class-grid"><thead>${head}</thead><tbody>${body}</tbody></table>${legend}</div>`
}

export function matrixHtml(block: MatrixBlock): string {
  const drawn = block.style === 'class-grid' ? classGridHtml(block) : formHtml(block)
  return `<h4>${e(block.title)}</h4>${drawn}${block.marks.length || block.point ? '' : '<p class="note">Nothing marked yet.</p>'}${
    block.note ? `<p class="note">${e(block.note)}</p>` : ''
  }`
}

/** A scale or a matrix as Markdown: a scale as its reading, a matrix as a table with the marked cells in bold. */
export function scaleOrMatrixMarkdown(block: ScaleBlock | MatrixBlock): string {
  const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ') || ' '
  if (block.kind === 'matrix') {
    const marked = new Set(block.marks.map((m) => `${m.row}:${m.column}`))
    const value = (r: number, c: number) => {
      const own = block.letters?.[r]?.[c]
      return own ? `${own} (${block.cells[r][c]})` : block.cells[r][c]
    }
    return [
      `**${block.title}**`,
      '',
      `| ${cell(block.rowHeader)} | ${block.columns.map(cell).join(' | ')} |`,
      `| --- | ${block.columns.map(() => '---').join(' | ')} |`,
      ...block.rows.map(
        (row, r) =>
          `| ${cell(row)} | ${block.cells[r]
            .map((_, c) => (marked.has(`${r}:${c}`) ? `**✓ ${cell(value(r, c))}**` : cell(value(r, c))))
            .join(' | ')} |`,
      ),
      ...(block.legend ? ['', `_${block.legend.title}: ${block.legend.items.map((i) => i.label).join(' / ')}_`] : []),
      ...(block.point
        ? [
            '',
            `X: ${block.rows[0] ? Math.round((block.point.row + 1) * 10) : ''}% removed, ${Math.round((block.point.column + 1) * 50) / 10} m residual trees`,
          ]
        : []),
    ].join('\n')
  }
  const reading =
    block.mark === null
      ? 'not marked'
      : `marked at ${block.markLabel ?? block.mark}${
          block.markBand !== undefined &&
          block.markBand !== null &&
          block.bands[block.markBand]?.name !== block.markLabel
            ? ` (${block.bands[block.markBand].name ?? block.bands[block.markBand].label})`
            : ''
        }`
  if (block.style === 'guide')
    return [
      `**${block.title}:** ${reading}`,
      '',
      ...block.bands.map(
        (b, i) =>
          `- ${block.markBand === i ? '**' : ''}${b.name ?? b.label}: ${b.range ?? ''}${block.markBand === i ? '**' : ''}`,
      ),
    ].join('\n')
  return `**${block.title}:** ${block.bands.map((b) => b.label).join(' · ')} — ${reading}`
}
