/**
 * An assembled VIA report as one printable, self-contained HTML page: the logo in the title block, tables, matrices
 * with their marked cells, scale bars drawn as inline SVG, tick boxes, figures and the reviewer's list at the end.
 * Values the reviewer has not given print as blank lines. No DOM or network access; the logo arrives as a data URL.
 */
import { escapeHtml as e } from '@/branding/presentation'

import { extraBlockHtml, extraBlockMarkdown, FIGURES_CSS } from './htmlFigures'
import { matrixHtml, SCALES_CSS, scaleHtml, scaleOrMatrixMarkdown } from './htmlScales'

import type { AssembledReport, ReportBlock } from './model'

export interface ReportLogo {
  dataUrl: string
  /** Who it is: an uploaded file's name or the brand's name. */
  name: string
}

const BLANK = '<span class="blank"></span>'

function blockHtml(block: ReportBlock): string {
  switch (block.kind) {
    case 'heading':
      return `<h${block.level + 1}>${e(block.text)}</h${block.level + 1}>`
    case 'paragraph':
      return `<p>${block.sentences.map((s) => e(s.text ?? '')).join(' ')}</p>`
    case 'text':
      return block.text.trim() ? `<p class="src-${block.source}">${e(block.text)}</p>` : ''
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul'
      return `<${tag}>${block.items.map((item) => `<li>${e(item)}</li>`).join('')}</${tag}>`
    }
    case 'fields':
      return `${block.title ? `<h4>${e(block.title)}</h4>` : ''}<table class="fields">${block.rows
        .map((row) => `<tr><th>${e(row.label)}</th><td>${row.value === null ? BLANK : e(row.value)}</td></tr>`)
        .join('')}</table>`
    case 'table':
      return `${block.title ? `<h4>${e(block.title)}</h4>` : ''}<table class="grid"><thead><tr>${block.columns
        .map((c) => `<th>${e(c)}</th>`)
        .join('')}</tr></thead><tbody>${
        block.rows.length
          ? block.rows
              .map((row) => `<tr>${row.map((cell) => `<td>${cell ? e(cell) : BLANK}</td>`).join('')}</tr>`)
              .join('')
          : `<tr><td colspan="${block.columns.length}" class="empty">None</td></tr>`
      }</tbody></table>${block.note ? `<p class="note">${e(block.note)}</p>` : ''}`
    case 'matrix':
      return matrixHtml(block)
    case 'scale':
      return scaleHtml(block)
    case 'choices': {
      const boxes = block.options
        .map((option) => `<span class="box">${option === block.chosen ? '☒' : '☐'} ${e(option)}</span>`)
        .join(' ')
      if (block.boxed)
        return `<table class="answer-box"><tr><td>${e(block.label)}${
          block.answer === undefined ? '' : `<b class="answer">${block.answer ? e(block.answer) : BLANK}</b>`
        }</td><td class="ticks">${boxes}</td></tr></table>`
      return `<p class="choices"><span class="label">${e(block.label)}</span> ${boxes}${
        block.answer ? ` <b class="answer">${e(block.answer)}</b>` : ''
      }</p>`
    }
    case 'figure':
      return block.figure
        ? `<figure><img src="${block.figure.dataUrl}" width="${block.figure.width}" height="${block.figure.height}" alt="${e(block.caption)}"><figcaption>${e(block.caption)}</figcaption></figure>`
        : `<figure class="placeholder"><p>${e(block.placeholder ?? 'Figure to come')}</p><figcaption>${e(block.caption)}</figcaption></figure>`
    case 'signature':
      return `<table class="signature">${block.lines.map((line) => `<tr><th>${e(line)}</th><td>${BLANK}</td></tr>`).join('')}</table>`
    case 'pageBreak':
      return '<div class="page-break"></div>'
    default:
      // Block kinds the figure layouts add (`htmlFigures.ts`).
      return extraBlockHtml(block)
  }
}

const CSS = `body{font:13px/1.45 system-ui,sans-serif;color:#1a2530;max-width:960px;margin:28px auto;padding:0 24px}
header.title{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:2px solid #1a2530;padding-bottom:12px;margin-bottom:16px}
header.title h1{margin:0;font-size:24px}header.title p{margin:4px 0 0;color:#475569}
.logo{width:180px;height:64px;display:flex;align-items:center;justify-content:flex-end}.logo img{max-width:100%;max-height:100%;object-fit:contain}
.logo.empty{border:1px dashed #94a3b8;color:#94a3b8;font-size:11px;justify-content:center}
h2{font-size:18px;margin:22px 0 6px}h3{font-size:15px;margin:18px 0 6px}h4{font-size:13px;margin:14px 0 4px}h5{font-size:12px}
table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #cbd5e1;padding:4px 6px;text-align:left;vertical-align:top}
table.fields th{width:32%;background:#f8fafc;font-weight:600}table.grid thead th{background:#f1f5f9}
table.matrix td.marked{outline:2px solid #b91c1c;outline-offset:-2px;font-weight:600}
.blank{display:inline-block;min-width:160px;border-bottom:1px solid #64748b;height:1em}
.note{font-size:11px;color:#64748b;margin:2px 0 8px}.empty{color:#94a3b8}
.choices .label{font-weight:600;margin-right:8px}.choices .box{margin-right:12px;white-space:nowrap}.choices .box{display:inline-block;max-width:100%;white-space:normal;vertical-align:top}
svg.scale{width:100%;max-width:640px;height:auto;display:block}
table.answer-box{margin:10px 0;break-inside:avoid}table.answer-box td{border:1px solid #1a2530;padding:6px 8px}table.answer-box td.ticks{width:120px;white-space:nowrap;vertical-align:top}table.answer-box b.answer{display:block;margin-top:2px}
h2,h3,h4{break-after:avoid}table.fields,table.signature,.choices{break-inside:avoid}
figure{margin:12px 0;break-inside:avoid}figure img{max-width:100%;height:auto;border:1px solid #cbd5e1}figcaption{font-size:11px;color:#475569}
figure.placeholder{border:1px dashed #94a3b8;padding:24px;text-align:center;color:#94a3b8}
table.signature th{width:32%}table.signature td{height:28px}
.complete{border:1px solid #b7791f;background:#fffaf0;padding:4px 12px;margin-top:14px;font-size:10px;line-height:1.25}.complete h2{font-size:14px;margin:4px 0}.complete ul{margin:4px 0;padding-left:16px}.complete li{margin:0 0 3px}
footer{margin-top:24px;font-size:11px;color:#64748b;border-top:1px solid #cbd5e1;padding-top:6px}
.page-break{break-after:page}button{margin:8px 0}
.vf-landscape + .page-break,.vf-page + .page-break,.sheet-page + .page-break,figure.sheet + .page-break{display:none}
@media print{body{margin:0;max-width:none}button{display:none}}`

/** Tables and matrices wider than this many columns print on a landscape page. */
const WIDE_COLUMNS = 7
/** A table too wide for portrait goes on a landscape page; the alteration guide's grid fits portrait, as 01 prints it. */
const isWide = (block: ReportBlock) =>
  (block.kind === 'table' || block.kind === 'matrix') &&
  block.columns.length > WIDE_COLUMNS &&
  !(block.kind === 'matrix' && block.style === 'class-grid')
/** A figure this wide for its height is an 11 × 17 analysis sheet (1224 × 792 pt), printed on a page of its own. */
const isSheet = (figure: { width: number; height: number }) =>
  Math.abs(figure.width / figure.height - 1224 / 792) < 0.05
/** A map this tall for its width is the portrait 11 × 17 end map (792 × 1224 pt), printed full-size on its own page. */
const isPortraitSheet = (figure: { width: number; height: number; map?: unknown }) =>
  !!figure.map && Math.abs(figure.width / figure.height - 792 / 1224) < 0.02

/** Print rules for the report's paper: running header, page numbers, and the landscape and 11 × 17 pages. */
function pageCss(report: AssembledReport): string {
  const paper = report.layout.paper
  // One short line: the subtitle (a long block list on a big report) is cut to fit.
  const subtitle = report.subtitle.length > 60 ? `${report.subtitle.slice(0, 57).trimEnd()}…` : report.subtitle
  const header = `${report.title} · ${subtitle}`.replace(/["\\]/g, '')
  return `@page{size:${paper} portrait;margin:16mm 16mm 18mm;@top-left{content:"${header}";font:8pt system-ui,sans-serif;color:#64748b}@bottom-right{content:"Page " counter(page) " of " counter(pages);font:8pt system-ui,sans-serif;color:#64748b}}
@page wide{size:${paper} landscape}
@page sheet{size:17in 11in;margin:8mm;@top-left{content:none}@bottom-right{content:"Page " counter(page) " of " counter(pages);font:8pt system-ui,sans-serif;color:#64748b}}
@page sheetfull{size:17in 11in;margin:0;@top-left{content:none}@bottom-right{content:none}}
@page sheetportrait{size:11in 17in;margin:0;@top-left{content:none}@bottom-right{content:none}}
figure.sheet.portrait{page:sheetportrait;margin:0 0 0 -24px;width:11in;break-before:page;break-after:page}figure.sheet.portrait img{width:11in;height:16.98in;object-fit:contain;border:0;max-width:none;display:block}figure.sheet.portrait figcaption{display:none}
@page cover{@top-left{content:none}@bottom-right{content:none}}
figure.sheet.full{page:sheetfull;margin:0 0 0 -24px;width:17in;break-before:page;break-after:page}figure.sheet.full img{width:17in;height:10.98in;object-fit:contain;border:0;max-width:none;display:block}figure.sheet.full figcaption{display:none}
.wide{page:wide}td .blank{min-width:40px;width:100%;display:block}.wide-page table,.wide table{width:100%;font-size:9px;table-layout:auto}.wide-page td,.wide-page th,.wide td,.wide th{overflow-wrap:break-word;hyphens:auto}figure.sheet:not(.full):not(.portrait){page:sheet;margin:0;text-align:center;display:flex;flex-direction:column;height:10.2in;break-before:page;break-after:page}figure.sheet:not(.full):not(.portrait) img{flex:1 1 auto;min-height:0;width:100%;height:100%;object-fit:contain;border:0}figure.sheet:not(.full):not(.portrait) figcaption{flex:none}
section.cover{page:cover;break-after:page;min-height:80vh;display:flex;flex-direction:column;justify-content:center;gap:18px}
section.cover .logo{width:260px;height:110px}section.cover h1{font-size:34px}section.cover p.sub{font-size:18px;color:#334155}
nav.contents{break-after:page}nav.contents ol{list-style:none;padding-left:0}nav.contents li{margin:3px 0}nav.contents a{color:inherit;text-decoration:none}
figure.sheet + table.fields,.sheet-page table.fields{font-size:11px}.sheet-page{page:sheet;display:flex;flex-direction:column;height:10.2in;break-before:page;break-after:page}.sheet-page > *{flex:none}.sheet-page h3,.sheet-page h4{margin:0 0 4px}.sheet-page figure.sheet:not(.full):not(.portrait){page:auto;flex:1 1 auto;min-height:0;height:auto;break-before:auto;break-after:auto}
table.sheet-calc{font-size:10px;margin:4px 0 0;table-layout:fixed}table.sheet-calc th{background:#f8fafc;font-weight:600}table.sheet-calc td .blank{min-width:40px}.wide-page{page:wide}.wide-page .wide{page:auto}`
}

/**
 * The calculation fields under an analysis sheet as one strip, a column per field, so the sheet keeps the rest of the
 * 11 × 17 page.
 */
function sheetFieldsHtml(block: Extract<ReportBlock, { kind: 'fields' }>): string {
  return `${block.title ? `<h4>${e(block.title)}</h4>` : ''}<table class="sheet-calc"><tr>${block.rows
    .map((row) => `<th>${e(row.label)}</th>`)
    .join(
      '',
    )}</tr><tr>${block.rows.map((row) => `<td>${row.value === null ? BLANK : e(row.value)}</td>`).join('')}</tr></table>`
}

/** Pages of their own at the end of a report (analysis sheets, figure pages, photo pairs, map sheets). */
const OWN_PAGE =
  /^<(div class="(sheet-page|page-break)|section class="vf-(pair|page)|figure class="(sheet|vf-(map|grid)))/
/** Where the to-complete list goes: before the run of figure pages the report ends on, so it never takes a page alone. */
function completeAt(parts: readonly string[]): number {
  let at = parts.length
  // A picture and the calculation fields printed under it (a calculation that is not an 11 × 17 sheet) count too.
  const figureWithFields = (i: number) =>
    /^<figure/.test(parts[i]) || (/^<table class="fields"/.test(parts[i]) && i > 0 && /^<figure/.test(parts[i - 1]))
  while (at > 0 && (OWN_PAGE.test(parts[at - 1]) || /^<h[2-5]/.test(parts[at - 1]) || figureWithFields(at - 1))) at--
  // Headings left at the cut belong to the text before them, which stops the walk: keep them with it.
  while (at < parts.length && /^<h[2-5]/.test(parts[at])) at++
  return at
}

/**
 * What the contents' Images list calls a figure block: its figure number and title, its caption, or its pictures'
 * labels. Null for a block that is not a picture. Page numbers are not printed: the browser's print engine has no
 * `target-counter`, so a page number could only be added to the printed PDF afterwards.
 */
export function imageLabel(block: ReportBlock): string | null {
  switch (block.kind) {
    case 'figure':
      return block.caption || null
    case 'figurePage':
      return `${block.number}: ${block.title}`
    case 'figurePair': {
      const panels = block.slots.map((slot) => slot.label).join(' / ')
      return block.title ? `${block.title}${panels ? `: ${panels}` : ''}` : panels || null
    }
    case 'mapFigure':
    case 'figureGrid':
      return block.caption || null
    default:
      return null
  }
}

export function reportHtml(report: AssembledReport, logo: ReportLogo | null): string {
  const [first, ...rest] = report.blocks
  const title = first?.kind === 'heading' ? first.text : report.title
  const blocks = first?.kind === 'heading' ? rest : report.blocks
  // The cover takes the fields that come before the first section heading (the cover part's).
  const coverEnd = report.layout.cover ? blocks.findIndex((block) => block.kind === 'heading') : 0
  const coverBlocks = report.layout.cover ? blocks.slice(0, Math.max(0, coverEnd)) : []
  const bodyBlocks = blocks.slice(coverBlocks.length)
  let sectionNo = 0
  const sections: Array<{ id: string; text: string }> = []
  // The figure pages, for the contents' Images list; each anchored on its own outer element.
  const images: Array<{ id: string; text: string }> = []
  const html = (block: ReportBlock): string => {
    const drawn = blockBody(block)
    const label = imageLabel(block)
    if (!label) return drawn
    const id = `f${images.length + 1}`
    images.push({ id, text: label })
    // The id goes on the outer element's own tag, after its class, so the page rules that read the tag (`OWN_PAGE`)
    // are unchanged; an anchor element inside would become the first cell of a figure page's grid.
    return drawn.replace(/^<([a-z]+)([^>]*)>/, (_, name: string, attrs: string) =>
      / id="/.test(attrs) ? `<${name}${attrs}>` : `<${name}${attrs} id="${id}">`,
    )
  }
  const blockBody = (block: ReportBlock): string => {
    if (block.kind === 'heading' && block.level === 2) {
      const id = `s${++sectionNo}`
      sections.push({ id, text: block.text })
      return `<h3 id="${id}">${e(block.text)}</h3>`
    }
    const drawn = blockHtml(block)
    if (isWide(block)) return `<div class="wide">${drawn}</div>`
    // A map sheet prints full-size, so the scale it states is true on paper; an analysis sheet keeps its margins.
    if (block.kind === 'figure' && block.figure && isPortraitSheet(block.figure))
      return drawn.replace('<figure>', '<figure class="sheet portrait">')
    if (block.kind === 'figure' && block.figure && isSheet(block.figure))
      return drawn.replace('<figure>', block.figure.map ? '<figure class="sheet full">' : '<figure class="sheet">')
    return drawn
  }
  // A heading never stays behind on the page before a landscape table or an 11 x 17 sheet (a change of page type
  // forces a break): it moves onto that page, and a sheet takes the calculation fields that follow it.
  // A run of headings ("Calculations", then the viewpoint's) moves together.
  const parts: string[] = []
  for (let i = 0; i < bodyBlocks.length; i++) {
    const block = bodyBlocks[i]
    let last = i
    while (block.kind === 'heading' && bodyBlocks[last + 1]?.kind === 'heading') last++
    const next = bodyBlocks[last + 1]
    const nextWide = !!next && isWide(next)
    const nextSheet = next?.kind === 'figure' && next.figure && isSheet(next.figure)
    if (block.kind === 'heading' && (nextWide || nextSheet)) {
      const group = bodyBlocks.slice(i, last + 2).map(html)
      i = last + 1
      const calc = bodyBlocks[i + 1]
      if (nextSheet && calc?.kind === 'fields') {
        group.push(sheetFieldsHtml(calc))
        i++
      }
      parts.push(`<div class="${nextSheet ? 'sheet-page' : 'wide-page'}">${group.join('')}</div>`)
    } else if (block.kind === 'figure' && block.figure && isSheet(block.figure) && next?.kind === 'fields') {
      parts.push(`<div class="sheet-page">${html(block)}${sheetFieldsHtml(next)}</div>`)
      i++
    } else parts.push(html(block))
  }
  const at = completeAt(parts)
  const logoBox = logo
    ? `<div class="logo"><img src="${logo.dataUrl}" alt="${e(logo.name)}"></div>`
    : '<div class="logo empty">Logo (your own)</div>'
  const head = report.layout.cover
    ? `<section class="cover">${logoBox}<h1>${e(title)}</h1><p class="sub">${e(report.subtitle)}</p>${coverBlocks.map(blockHtml).join('')}</section>`
    : `<header class="title"><div><h1>${e(title)}</h1><p>${e(report.subtitle)}</p></div>${logoBox}</header>`
  const contents =
    report.layout.contents && sections.length
      ? `<nav class="contents"><h2>Contents</h2><ol>${sections.map((s) => `<li><a href="#${s.id}">${e(s.text)}</a></li>`).join('')}${report.toComplete.length ? '<li><a href="#complete">To complete before signing</a></li>' : ''}</ol>${
          images.length
            ? `<h4>Images</h4><ol>${images.map((f) => `<li><a href="#${f.id}">${e(f.text)}</a></li>`).join('')}</ol>`
            : ''
        }</nav>`
      : ''
  // One line per part, its items run on: the list stays a checklist without taking pages of its own.
  const byPart = new Map<string, string[]>()
  for (const item of report.toComplete) byPart.set(item.part, [...(byPart.get(item.part) ?? []), item.what])
  const complete = report.toComplete.length
    ? `<section class="complete" id="complete"><h2>To complete before signing</h2><ul>${[...byPart]
        .map(([part, items]) => `<li><b>${e(part)}:</b> ${items.map(e).join('; ')}</li>`)
        .join('')}</ul></section>`
    : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline'"><title>${e(title)} - ${e(report.subtitle)}</title><style>${CSS}
${SCALES_CSS}
${FIGURES_CSS}
${pageCss(report)}</style></head><body>
${head}
<button onclick="window.print()">Print / save as PDF</button>
${contents}
${parts.slice(0, at).join('\n')}
${complete}
<footer>${e(report.footer)}</footer>
${parts.slice(at).join('\n')}
</body></html>`
}

/** The same report as Markdown, for review and diffing. Scales print as their reading; matrices as tables. */
export function reportMarkdown(report: AssembledReport): string {
  const lines: string[] = []
  const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ') || ' '
  for (const block of report.blocks) {
    switch (block.kind) {
      case 'heading':
        lines.push(`${'#'.repeat(block.level)} ${block.text}`, '')
        if (block.level === 1) lines.push(`_${report.subtitle}_`, '')
        break
      case 'paragraph':
        lines.push(block.sentences.map((s) => s.text).join(' '), '')
        break
      case 'text':
        if (block.text.trim()) lines.push(block.text, '')
        break
      case 'list':
        lines.push(...block.items.map((item, i) => `${block.ordered ? `${i + 1}.` : '-'} ${item}`), '')
        break
      case 'fields':
        if (block.title) lines.push(`**${block.title}**`, '')
        lines.push(...block.rows.map((row) => `- ${row.label}: ${row.value ?? '______'}`), '')
        break
      case 'table':
        if (block.title) lines.push(`**${block.title}**`, '')
        lines.push(
          `| ${block.columns.map(cell).join(' | ')} |`,
          `| ${block.columns.map(() => '---').join(' | ')} |`,
          ...block.rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
          '',
        )
        if (block.note) lines.push(`_${block.note}_`, '')
        break
      case 'matrix':
      case 'scale':
        lines.push(scaleOrMatrixMarkdown(block), '')
        break
      case 'choices':
        lines.push(
          `- ${block.label} ${block.options.map((o) => `${o === block.chosen ? '[x]' : '[ ]'} ${o}`).join('  ')}`,
          ...(block.answer ? [`  **${block.answer}**`] : []),
          '',
        )
        break
      case 'figure':
        lines.push(`_Figure: ${block.caption}_`, '')
        break
      case 'signature':
        lines.push(...block.lines.map((line) => `- ${line}: ______`), '')
        break
      case 'pageBreak':
        lines.push('---', '')
        break
      default: {
        const extra = extraBlockMarkdown(block)
        if (extra) lines.push(extra, '')
      }
    }
  }
  if (report.toComplete.length)
    lines.push(
      '## To complete before signing',
      '',
      ...report.toComplete.map((item) => `- **${item.part}:** ${item.what}`),
      '',
    )
  lines.push(`_${report.footer}_`, '')
  return lines.join('\n')
}
