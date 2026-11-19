/**
 * An assembled VIA report as one printable, self-contained HTML page: the logo in the title block, tables, matrices
 * with their marked cells, scale bars drawn as inline SVG, tick boxes, figures and the reviewer's list at the end.
 * Values the reviewer has not given print as blank lines. No DOM or network access; the logo arrives as a data URL.
 */
import { escapeHtml as e } from '@/branding/presentation'

import { extraBlockHtml, extraBlockMarkdown, FIGURES_CSS } from './htmlFigures'
import { matrixHtml, SCALES_CSS, scaleHtml, scaleOrMatrixMarkdown } from './htmlScales'

import { ANSWER_SUB, cellSub, itemSub, type EditKeys } from './edits'
import type { AssembledReport, ReportBlock } from './model'

export interface ReportLogo {
  dataUrl: string
  /** Who it is: an uploaded file's name or the brand's name. */
  name: string
}

const BLANK = '<span class="blank"></span>'

/**
 * The draft's marks (`reportHtml`'s `draft`): where each part starts, so the draft can name it and scroll to it. A
 * draft also tints every value by where it came from (`data-src`) and shows blanks; the downloaded file has neither.
 */
export interface ReportDraft {
  /** The recipe's parts in order, each with its first block as an object in `report.blocks` (null: printed nothing). */
  parts: ReadonlyArray<{ title: string; sources: readonly string[]; first: ReportBlock | null }>
  /** Each value's edit key (`edits.ts`), marked on the page as `data-edit` so the draft can change it in place. */
  editKeys?: EditKeys
  /** The keys the reviewer has edited, marked `data-edited`. */
  edited?: ReadonlySet<string>
}

/** The draft's tint attribute, or nothing in a file. */
const src = (draft: unknown, source: string) => (draft ? ` data-src="${source}"` : '')
/** The draft's edit mark on a value (`data-edit`, and `data-edited` once the reviewer changed it), or nothing. */
const ed = (draft: ReportDraft | false, holder: object, sub?: string) => {
  const key = draft ? draft.editKeys?.of(holder, sub) : undefined
  return key ? ` data-edit="${e(key)}"${draft && draft.edited?.has(key) ? ' data-edited' : ''}` : ''
}

function blockHtml(block: ReportBlock, draft: ReportDraft | false = false): string {
  switch (block.kind) {
    case 'heading':
      return `<h${block.level + 1}>${e(block.text)}</h${block.level + 1}>`
    case 'paragraph':
      return draft
        ? `<p${ed(draft, block)}>${block.sentences.map((s) => `<span${src(true, s.source)}>${e(s.text ?? '')}</span>`).join(' ')}</p>`
        : `<p>${block.sentences.map((s) => e(s.text ?? '')).join(' ')}</p>`
    case 'text':
      return block.text.trim()
        ? `<p class="src-${block.source}"${src(draft, block.source)}${ed(draft, block)}>${e(block.text)}</p>`
        : ''
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul'
      return `<${tag}${src(draft, block.source)}>${block.items.map((item, i) => `<li${ed(draft, block, itemSub(i))}>${e(item)}</li>`).join('')}</${tag}>`
    }
    case 'fields':
      return `${block.title ? `<h4>${e(block.title)}</h4>` : ''}<table class="fields">${block.rows
        .map(
          (row) =>
            `<tr${src(draft, row.source)}><th>${e(row.label)}</th><td${ed(draft, row)}>${row.value === null ? BLANK : e(row.value)}</td></tr>`,
        )
        .join('')}</table>`
    case 'table':
      return `${block.title ? `<h4>${e(block.title)}</h4>` : ''}<table class="grid"${src(draft, block.source)}><thead><tr>${block.columns
        .map((c) => `<th>${e(c)}</th>`)
        .join('')}</tr></thead><tbody>${
        block.rows.length
          ? block.rows
              .map(
                (row, r) =>
                  `<tr>${row.map((cell, c) => `<td${ed(draft, block, cellSub(r, c))}>${cell ? e(cell) : BLANK}</td>`).join('')}</tr>`,
              )
              .join('')
          : `<tr><td colspan="${block.columns.length}" class="empty">None</td></tr>`
      }</tbody></table>${block.note ? `<p class="note">${e(block.note)}</p>` : ''}`
    case 'matrix':
      return matrixHtml(block)
    case 'scale':
      return scaleHtml(block)
    case 'choices': {
      const boxes = block.options
        .map(
          (option) =>
            `<span class="box"${ed(draft, block)}${draft ? ` data-option="${e(option)}"` : ''}>${option === block.chosen ? '☒' : '☐'} ${e(option)}</span>`,
        )
        .join(' ')
      if (block.boxed)
        return `<table class="answer-box"><tr><td>${e(block.label)}${
          block.answer === undefined
            ? ''
            : `<b class="answer"${ed(draft, block, ANSWER_SUB)}>${block.answer ? e(block.answer) : BLANK}</b>`
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
    case 'form':
      return formHtml(block, draft)
    default:
      // Block kinds the figure layouts add (`htmlFigures.ts`).
      return extraBlockHtml(block)
  }
}

/** A section's first table or scale without its own title when the section's title bar already prints it. */
export function untitled(block: ReportBlock, sectionTitle: string): ReportBlock {
  return (block.kind === 'matrix' || block.kind === 'scale') &&
    sectionTitle.toLowerCase().includes(block.title.toLowerCase())
    ? { ...block, title: '' }
    : block
}

/**
 * A form's sections as one ruled table, a section or two side by side per row; each row's title bars and contents stay
 * together on a page.
 */
function formHtml(block: Extract<ReportBlock, { kind: 'form' }>, draft: ReportDraft | false = false): string {
  const rows = block.rows
    .filter((row) => row.length)
    .map((row) => {
      const span = row.length === 1 ? ' colspan="2"' : ''
      return `<tbody><tr>${row.map((cell) => `<th${span}>${e(cell.title)}</th>`).join('')}</tr><tr>${row
        .map(
          (cell) =>
            `<td${span}>${cell.blocks.map((b, i) => blockHtml(i ? b : untitled(b, cell.title), draft)).join('')}</td>`,
        )
        .join('')}</tr></tbody>`
    })
    .join('')
  return `<table class="form-grid"><colgroup><col><col></colgroup>${rows}</table>`
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
table.form-grid{table-layout:fixed;border:1px solid #1a2530;margin:4px 0;font-size:10.5px;line-height:1.3}table.form-grid col{width:50%}
table.form-grid tbody{break-inside:avoid}table.form-grid > tbody > tr > th{background:#d9dee4;border:1px solid #1a2530;padding:2px 6px;font-weight:600}
table.form-grid > tbody > tr > td{border:1px solid #1a2530;padding:2px 6px 3px}
table.form-grid td table{margin:2px 0}table.form-grid td th,table.form-grid td td{padding:1px 4px}table.form-grid td table.fields th{width:46%}
table.form-grid td h4{font-size:10.5px;margin:3px 0 1px}table.form-grid td p{margin:2px 0}table.form-grid .note{font-size:9px;margin:0 0 2px}
table.form-grid h4:empty,table.form-grid .unmarked{display:none}
table.form-grid .scale-block{margin:0 0 2px}table.form-grid svg.scale{max-width:470px}
table.form-grid table.matrix{font-size:10px}table.form-grid table.matrix th,table.form-grid table.matrix td{padding:1px 4px}table.form-grid table.matrix.compact{width:100%}table.form-grid table.matrix.compact tbody th{width:72%}table.form-grid table.signature td{height:18px}
.vf-landscape + .page-break,.vf-sheet + .page-break,.vf-page + .page-break,.sheet-page + .page-break,figure.sheet + .page-break{display:none}
@media print{body{margin:0;max-width:none}button{display:none}}`

/** Tables and matrices wider than this many columns print on a landscape page. */
export const WIDE_COLUMNS = 7
/** A table too wide for portrait goes on a landscape page; the alteration guide's grid fits portrait, as 01 prints it. */
export const isWide = (block: ReportBlock) =>
  (block.kind === 'table' || block.kind === 'matrix') &&
  block.columns.length > WIDE_COLUMNS &&
  !(block.kind === 'matrix' && block.style === 'class-grid')
/** A figure this wide for its height is an 11 × 17 analysis sheet (1224 × 792 pt), printed on a page of its own. */
export const isSheet = (figure: { width: number; height: number }) =>
  Math.abs(figure.width / figure.height - 1224 / 792) < 0.05
/** A map this tall for its width is the portrait 11 × 17 end map (792 × 1224 pt), printed full-size on its own page. */
export const isPortraitSheet = (figure: { width: number; height: number; map?: unknown }) =>
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

/** The most text that follows a landscape table onto its page, in characters: a paragraph or two, not a discussion. */
const CLOSING_TEXT_CHARS = 1500
/**
 * How many paragraphs from `from` close a landscape table's section and print on its page: text only, up to the next
 * heading (or the end), and no more than `CLOSING_TEXT_CHARS` of it; none when anything else comes first.
 */
export function closingText(blocks: readonly ReportBlock[], from: number): number {
  let n = 0,
    chars = 0
  for (; from + n < blocks.length; n++) {
    const block = blocks[from + n]
    if (block.kind === 'heading') break
    if (block.kind !== 'paragraph' && block.kind !== 'text') return 0
    chars +=
      block.kind === 'text' ? block.text.length : block.sentences.reduce((sum, s) => sum + (s.text ?? '').length, 0)
    if (chars > CLOSING_TEXT_CHARS) return 0
  }
  return n
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
      // A label the title already carries is not repeated (22's Perspective Viewpoint sheets).
      const panels = block.slots
        .map((slot) => slot.label)
        .filter((label) => !block.title?.includes(label))
        .join(' / ')
      return block.title ? `${block.title}${panels ? `: ${panels}` : ''}` : panels || null
    }
    case 'mapFigure':
    case 'figureGrid':
      return block.caption || null
    default:
      return null
  }
}

/** What the draft adds to the page: each part's mark, the tints, the blanks and the stand-ins made clickable. */
const DRAFT_CSS = `.draft-part{margin:20px 0 6px;padding:3px 8px;border-left:3px solid #0d9488;background:#f0fdfa;font:600 11px/1.4 system-ui,sans-serif;color:#0f766e;display:flex;justify-content:space-between;gap:12px;scroll-margin-top:8px}
.draft-part span:last-child{font-weight:400;color:#64748b}.draft-part.flash{background:#99f6e4}
[data-src="run"]{background:rgba(59,130,246,.12)}[data-src="reviewer"]{background:rgba(245,158,11,.18)}[data-src="scene"]{background:rgba(16,185,129,.14)}[data-src="table"]{background:rgba(139,92,246,.12)}
.blank{background:#fde68a;min-height:1em}
[data-edit]{cursor:text}[data-edit]:hover{outline:1px dashed #0d9488;outline-offset:1px}[data-edit][data-option]{cursor:pointer}
[data-edited]{box-shadow:inset 3px 0 0 #b45309}[data-edit][contenteditable]{outline:2px solid #0d9488;outline-offset:1px;background:#fff}
img[src*="data-draw"]{cursor:pointer}img[src*="data-draw"]:hover{outline:3px solid #0d9488;outline-offset:-3px}`

export function reportHtml(report: AssembledReport, logo: ReportLogo | null, draft?: ReportDraft): string {
  // Where each part starts, for the draft's marks; a part that printed nothing has none.
  const partAt = new Map<ReportBlock, { index: number; title: string; sources: readonly string[] }>()
  draft?.parts.forEach((part, index) => {
    if (part.first && !partAt.has(part.first))
      partAt.set(part.first, { index, title: part.title, sources: part.sources })
  })
  const mark = (block: ReportBlock) => {
    const part = partAt.get(block)
    return part
      ? `<div class="draft-part" id="part-${part.index}" data-part="${part.index}"><span>${e(part.title)}</span><span>${e(part.sources.join(', '))}</span></div>`
      : ''
  }
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
  const html = (block: ReportBlock): string => mark(block) + labelled(block)
  const labelled = (block: ReportBlock): string => {
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
    const drawn = blockHtml(block, draft ?? false)
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
      if (!nextSheet) {
        // Short text closing the table's section (22's sub-landform sentences under Table 2) prints under the table:
        // on a portrait page of its own it pushed the next section's table notes onto a page more.
        const closing = closingText(bodyBlocks, i + 1)
        group.push(...bodyBlocks.slice(i + 1, i + 1 + closing).map(html))
        i += closing
      }
      parts.push(`<div class="${nextSheet ? 'sheet-page' : 'wide-page'}">${group.join('')}</div>`)
    } else if (block.kind === 'figure' && block.figure && isSheet(block.figure) && next?.kind === 'fields') {
      parts.push(`<div class="sheet-page">${html(block)}${sheetFieldsHtml(next)}</div>`)
      i++
    } else parts.push(html(block))
  }
  const at = completeAt(parts)
  // No logo: the slot keeps its place and is empty in a file; only the draft, an editing surface, says whose it is.
  const logoBox = logo
    ? `<div class="logo"><img src="${logo.dataUrl}" alt="${e(logo.name)}"></div>`
    : draft
      ? '<div class="logo empty">Logo (your own)</div>'
      : '<div class="logo"></div>'
  const head = report.layout.cover
    ? `<section class="cover">${logoBox}<h1>${e(title)}</h1><p class="sub">${e(report.subtitle)}</p>${coverBlocks.map((block) => mark(block) + blockHtml(block, draft ?? false)).join('')}</section>`
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline'">${report.about ? `<meta name="description" content="${e(report.about)}">` : ''}<title>${e(title)} - ${e(report.subtitle)}</title><style>${CSS}
${SCALES_CSS}
${FIGURES_CSS}
${pageCss(report)}${draft ? `\n${DRAFT_CSS}` : ''}</style></head><body>
${head}
${draft ? '' : '<button onclick="window.print()">Print / save as PDF</button>'}
${contents}
${parts.slice(0, at).join('\n')}
${complete}
${report.footer ? `<footer>${e(report.footer)}</footer>` : ''}
${parts.slice(at).join('\n')}
</body></html>`
}

/** The same report as Markdown, for review and diffing. Scales print as their reading; matrices as tables. */
export function reportMarkdown(report: AssembledReport): string {
  const lines: string[] = []
  const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ') || ' '
  const put = (block: ReportBlock): void => {
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
      case 'form':
        for (const cell of block.rows.flat()) {
          lines.push(`**${cell.title}**`, '')
          cell.blocks.forEach(put)
        }
        break
      default: {
        const extra = extraBlockMarkdown(block)
        if (extra) lines.push(extra, '')
      }
    }
  }
  report.blocks.forEach(put)
  if (report.toComplete.length)
    lines.push(
      '## To complete before signing',
      '',
      ...report.toComplete.map((item) => `- **${item.part}:** ${item.what}`),
      '',
    )
  if (report.footer) lines.push(`_${report.footer}_`, '')
  return lines.join('\n')
}
