/**
 * VIA reports as recipes: an ordered list of shared parts (`parts.ts`) and the document format whose arithmetic,
 * scale and wording the parts read (`viaDocument/formats.ts`). Most reports share most parts: the 2001 forms (01, 03,
 * 05) differ in the figures they carry and the numerical worksheet; the consultant reports (22, 23) share every part
 * and differ only in their arithmetic; the handbook's Appendix 1 (06, 07) is one part; the Board's comparison (21)
 * and the environmental assessment memo (26) are the two that assess without a VQO rating of their own.
 * Structure only, never branding. No DOM or network access.
 */
import { findDocumentFormat } from '../viaDocument/formats'
import { proposedBlocks, type ReportContext } from './parts'
import { CONSULTANT_RECIPE_PARTS } from './partsConsultant'
import { findReportPart } from './registry'

/** The consultant reports carry their viewpoint map as an 11 x 17 appendix sheet, before the analysis sheets. */
const withOverviewMap = (parts: readonly string[]) => {
  const at = parts.indexOf('calculations')
  return at < 0 ? [...parts, 'overview-sheet'] : [...parts.slice(0, at), 'overview-sheet', ...parts.slice(at)]
}
import type { AssembledReport, ReportBlock, ReportItemToComplete, ReportLayout } from './model'
import { heading } from './model'

export interface ReportRecipe {
  id: string
  name: string
  title: string
  /** Reference documents whose structure it follows. */
  sources: readonly string[]
  /** The VIA document format whose rule, scale and wording it reads. */
  format: string
  parts: readonly string[]
  purpose: string
  /** The figure style its pictures are drawn in, when not its format's (`presets.ts` id). */
  figureStyle?: string
  /** Paper, cover and contents; letter with neither when absent. */
  layout?: Partial<ReportLayout>
}

export const REPORT_RECIPES: readonly ReportRecipe[] = [
  {
    id: 'partial-cut-form',
    figureStyle: 'arrows-no-outlines',
    layout: { paper: 'letter', cover: false, contents: false },
    name: 'Fuel-management VIA form (partial cut)',
    title: 'Visual Impact Assessment',
    sources: ['01'],
    format: 'form-2001-analysis-sheets',
    parts: [
      'form-header-2001',
      'block-areas-2001',
      'retention',
      'inventory',
      'current-evc',
      'viewpoints-columns',
      'criteria-rating-2001',
      'visual-design',
      'design-techniques-2001',
      'numerical-data',
      'summary-2001-five',
      'certification-2001',
      'overview-map',
      'overhead-renders',
      'photo-simulation-pairs',
    ],
    purpose: 'The 2001-style form for a partial cut: criteria by eye, design factors, the partial-cut table, summary.',
  },
  {
    id: 'design-rationale',
    figureStyle: 'arrows-no-outlines',
    layout: { paper: 'letter', cover: false, contents: false },
    name: 'Design rationale with district summary table',
    title: 'Visual Landscape Design Rationale',
    sources: ['02'],
    format: 'district-summary',
    parts: [
      'cover',
      'design-rationale',
      'recommendations',
      'sign-off',
      'figures',
      'overhead-renders',
      'district-summary-form',
    ],
    purpose: 'A narrative rationale, the recommendations, then the district summary table against strict % guidelines.',
  },
  {
    id: 'form-2001-sheets',
    layout: { paper: 'letter', cover: false, contents: false },
    name: '2001 VIA summary form with analysis sheets',
    title: 'Visual Impact Assessment Summary Form',
    sources: ['03'],
    format: 'form-2001-analysis-sheets',
    parts: [
      'form-header-2001',
      'block-areas-2001',
      'inventory',
      'viewpoints-columns',
      'basic-definition',
      'visual-design',
      'design-techniques-2001',
      'numerical-data',
      'summary-2001',
      'sign-off',
      'notes-2001',
      'calculations',
    ],
    purpose: 'The 2001 form, then one perspective analysis sheet per viewpoint with its pixel calculation.',
  },
  {
    id: 'form-2001-photos',
    layout: { paper: 'letter', cover: true, contents: true },
    name: '2001 VIA with existing / proposed / analysed panels',
    title: 'Visual Impact Assessment',
    sources: ['05'],
    format: 'form-2001-analysed-photos',
    parts: [
      'cover',
      'project-information',
      'inventory',
      'distance-zones',
      'viewpoints-columns',
      'basic-definition',
      'visual-design',
      'design-techniques-2001',
      'numerical-data',
      'summary-2001',
      'certification-2001',
      'notes-2001',
      'recommendations',
      'limitations',
      'figures',
      'overview-sheet',
      'photo-simulation-pairs',
      'calculations',
    ],
    purpose: 'The 2001 form with a project information page, the report’s own distance zones and calculation pages.',
  },
  {
    id: 'appendix-1-report',
    layout: { paper: 'legal', cover: true, contents: false },
    name: '2022 handbook report with Appendix 1',
    title: 'Visual Impact Assessment',
    sources: ['06', '07'],
    format: 'appendix-1-net-private-rock',
    parts: [
      'cover',
      'project-information',
      'overview-map',
      'purpose',
      'methodology',
      'viewpoint-pages',
      'photo-simulation-pairs',
      'calculations',
      'conclusion',
      'appendix-1',
      'extent-scale',
    ],
    purpose: 'Objective and methods, a page per viewpoint with its calculation, and the handbook’s Appendix 1 form.',
  },
  {
    id: 'board-comparison',
    layout: { paper: 'letter', cover: true, contents: true },
    name: 'Simulation against the result (Board comparison)',
    title: 'Visual Quality: Simulation and Result',
    sources: ['21'],
    format: 'form-2001-analysed-photos',
    parts: ['cover', 'regulatory-frame', 'board-comparison', 'methodology', 'overview-map', 'photo-simulation-pairs'],
    purpose: 'Per viewpoint the established objective, the simulated class and the post-harvest class, with findings.',
  },
  {
    id: 'consultant-net-private',
    layout: { paper: 'letter', cover: true, contents: true },
    name: 'Consultant VIA, landform net of private land',
    title: 'Visual Impact Assessment',
    sources: ['22'],
    format: 'perspective-report-net-private',
    parts: withOverviewMap(CONSULTANT_RECIPE_PARTS['consultant-net-private']),
    purpose: 'Regulatory frame, terms, method, Tables 1-5, the block discussion, conclusion and analysis sheets.',
  },
  {
    id: 'consultant-gross',
    layout: { paper: 'letter', cover: true, contents: true },
    name: 'Consultant VIA, gross landform',
    title: 'Visual Impact Assessment',
    sources: ['23'],
    format: 'perspective-report-gross',
    parts: withOverviewMap(CONSULTANT_RECIPE_PARTS['consultant-gross']),
    purpose: 'As the net-of-private report, on the gross landform with private land left standing.',
  },
  {
    id: 'ea-visual-memo',
    layout: { paper: 'letter', cover: false, contents: false },
    name: 'Environmental assessment visual memo (no VQO)',
    title: 'Visual Aesthetics',
    sources: ['26'],
    format: 'referral-panoramas',
    parts: ['ea-visual-memo', 'overview-map', 'ea-figure-pages', 'references'],
    purpose: 'Existing conditions, observer viewpoints, visibility per viewpoint and the effect characterization.',
  },
]

export const findReportRecipe = (id: string | null | undefined) =>
  REPORT_RECIPES.find((recipe) => recipe.id === id) ?? null

/** Assembles `recipe` from `ctx`: each part in order, with what each leaves for the reviewer. */
export function assembleReport(recipe: ReportRecipe, ctx: ReportContext): AssembledReport {
  const blocks: ReportBlock[] = []
  const toComplete: ReportItemToComplete[] = []
  for (const id of recipe.parts) {
    const part = findReportPart(id)
    if (!part) throw new Error(`Unknown report part: ${id}`)
    const out = part.build({ ...ctx, recipeParts: recipe.parts })
    blocks.push(...out.blocks)
    for (const what of out.toComplete ?? []) toComplete.push({ part: part.title, what })
  }
  // The document's own unfilled sentences, once each, named by viewpoint and block.
  for (const item of ctx.document.toComplete)
    toComplete.push({
      part: 'Wording',
      what: `${item.viewpoint ? `${item.viewpoint}: ` : ''}${item.about ? `${item.about}, ` : ''}${item.id} (needs ${item.missing.join(', ')})`,
    })
  const project = ctx.office.cuttingPermit
    ? `${ctx.office.licence ? `${ctx.office.licence} ` : ''}CP ${ctx.office.cuttingPermit}`
    : proposedBlocks(ctx)
        .map((block) => block.name)
        .join(', ') || 'Proposed blocks'
  return {
    id: recipe.id,
    title: recipe.title,
    subtitle: project,
    sources: recipe.sources,
    blocks: [heading(recipe.title, 1), ...blocks],
    toComplete,
    layout: { paper: 'letter', cover: false, contents: false, ...recipe.layout },
    footer: `PGMaps report in the structure of reference document${recipe.sources.length > 1 ? 's' : ''} ${recipe.sources.join(', ')} · generated ${ctx.date.toISOString().slice(0, 10)} · terrain model and drawn timber, not a field-verified simulation`,
  }
}

/** The document format a recipe reads, checked. */
export function recipeFormat(recipe: ReportRecipe) {
  const format = findDocumentFormat(recipe.format)
  if (!format) throw new Error(`Report ${recipe.id} names an unknown format: ${recipe.format}`)
  return format
}
