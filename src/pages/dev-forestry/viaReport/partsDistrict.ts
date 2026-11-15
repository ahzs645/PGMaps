/**
 * Report parts for the district and 2001-guidebook forms: the Kamloops Region VIA summary table (02), and the 2001
 * forms' own rows, notes and questions (01, 03, 05). Structure and row labels follow the forms; the labels of a
 * government form are public text, and nothing here names a licensee, consultant or person.
 *
 * As everywhere in the report, the run fills what it measures, the scene what it records, the office fields what the
 * office gave, and the reviewer's step 4 record fills judgements at the assessment station only. Anything else prints
 * blank and is listed as to complete. Registered in `registry.ts`. No DOM or network access.
 */
import { blockList } from '../viaDocument/resolve'
import { CLASS_NAMES, PERCENT_SCALES, readPercent, type ClassCode, type PercentScale } from '../viaDocument/scales'
import { fillSentence, type Sentence } from '../viaDocument/wording'
import { SCALE_TERMS, SHAPE_TERMS, VIEWPOINT_TYPES, VISIBLENESS_TERMS } from '../via'
import { designDistanceScore } from '../vqe'
import { field, fields, heading, text, type FieldRow, type ReportBlock } from './model'
import {
  blank,
  CLASS_CODES_BY_ID,
  CLASS_ORDER,
  ha,
  missingFields,
  objectiveOf,
  officeRow,
  paragraph,
  yesNo,
  type ReportBlockFacts,
  type ReportContext,
  type ReportPart,
} from './parts'

// ------------------------------------------------------------------ helpers

type FactsViewpoint = ReportContext['facts']['viewpoints'][number]

/** "A", "A and B", "A, B and C". */
export function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

const rank = (code: ClassCode) => CLASS_ORDER.indexOf(code)
const today = (ctx: ReportContext) => ctx.date.toISOString().slice(0, 10)
const seen = (block: { status: string }) => block.status === 'visible' || block.status === 'possible glimpses'
const allHidden = (vp: FactsViewpoint) => vp.blocks.length > 0 && vp.blocks.every((b) => b.status === 'not visible')
const isClass = (value: string | undefined | null): value is ClassCode =>
  !!value && (CLASS_ORDER as readonly string[]).includes(value)
const className = (value: string | undefined | null) => (isClass(value) ? CLASS_NAMES[value] : (blank(value) ?? ''))

/** How `scale` prints the range of `code` ("PR 1.6-7%", "PR<7%"), or null. */
export function rangeFor(scale: PercentScale, code: ClassCode): string | null {
  const pattern = new RegExp(`^${code}(?=[\\s=<])`)
  return (
    scale.printed
      .split(';')
      .map((part) => part.trim())
      .find((part) => pattern.test(part)) ?? null
  )
}

/**
 * Whether a printed figure falls within `objective`'s range on `scale`: a figure past the scale's last band is over
 * every range. Null without a figure or an objective.
 */
export function withinRange(scale: PercentScale, percent: number | null, objective: ClassCode | null): boolean | null {
  if (percent === null || !objective) return null
  const band = readPercent(scale, percent)
  return band?.code ? rank(band.code) <= rank(objective) : false
}

/** The systems the scene records, with their blocks: "Clearcut" or "Clearcut (X1); Partial cut (X2)". */
function systemsLine(blocks: readonly ReportBlockFacts[]): string | null {
  const systems = [...new Set(blocks.map((block) => block.system))]
  if (!systems.length) return null
  if (systems.length === 1) return systems[0]
  return systems
    .map(
      (system) =>
        `${system} (${blocks
          .filter((block) => block.system === system)
          .map((block) => block.name)
          .join(', ')})`,
    )
    .join('; ')
}

/** A block's recorded leave (retention) area, hectares, or null when the scene records none. */
const leaveHa = (block: ReportBlockFacts) =>
  block.retentionPercent === null ? null : (block.areaHa * block.retentionPercent) / 100

const blocksField = (ctx: ReportContext) =>
  field('Blocks', blank(ctx.office.blockIds) ?? ctx.blocks.map((block) => block.name).join(', '), 'scene')

/** The established objective a viewpoint is judged against: its own landform's, else the report's. */
const objectiveAt = (ctx: ReportContext, vp: FactsViewpoint): ClassCode | null => vp.objective ?? objectiveOf(ctx)

// ------------------------------------------------------------------ 02: the district summary table

/** One viewpoint's figures as the district form prints them, rows 5 to 8. */
export interface DistrictFigures {
  name: string
  existing: string | null
  proposed: string | null
  total: string | null
  /** Read on the form's strict bounds (P=0%; R<1.5%; PR<7%; M<18%; MM<30%). */
  within: 'Yes' | 'No' | null
}

/**
 * Rows 5 to 8 for each viewpoint: the district format's own summary row where the document is in that format, else the
 * same figures from the format's arithmetic. Row 8 always reads the form's strict bounds, which are what it prints.
 */
export function districtFigures(ctx: ReportContext): DistrictFigures[] {
  return ctx.facts.viewpoints.map((vp, index) => {
    const out = ctx.document.viewpoints[index]
    const row = out?.rows.summary?.[0]
    const part = (id: 'nonVeg' | 'proposed') => out?.alteration?.parts.find((p) => p.part === id)?.printed ?? null
    const within = withinRange(
      PERCENT_SCALES.guidebookStrict,
      out?.alteration ? out.alteration.printedValue : null,
      objectiveAt(ctx, vp),
    )
    return {
      name: vp.name,
      existing: blank(row?.['Existing %']) ?? part('nonVeg'),
      proposed: blank(row?.['Proposed %']) ?? part('proposed'),
      total: blank(row?.['Total %']) ?? out?.alteration?.printed ?? null,
      within: yesNo(within) as DistrictFigures['within'],
    }
  })
}

/** Row 1's inventory units: one row per distinct unit the viewpoints read, else the scene's inventory and office. */
function inventoryRows(ctx: ReportContext): string[][] {
  const rows = ctx.facts.viewpoints.map((vp, index) => {
    const summary = ctx.document.viewpoints[index]?.rows.summary?.[0]
    const unit = vp.inventory
    return [
      vp.landform,
      blank(summary?.VLU) ?? blank(unit?.vsu) ?? '',
      blank(summary?.VSR) ?? blank(unit?.vsc) ?? '',
      blank(summary?.VAC) ?? blank(unit?.vac) ?? '',
      blank(summary?.EVC) ?? blank(unit?.evc) ?? '',
      blank(summary?.VQO) ?? className(unit?.vqo ?? objectiveAt(ctx, vp)),
    ]
  })
  const read = rows.filter((row) => row.slice(1, 5).some(Boolean))
  const unique = [...new Map(read.map((row) => [row.join('|'), row])).values()]
  if (unique.length) return unique
  const unit = ctx.inventory
  return [
    [
      ctx.landform?.name ?? '',
      blank(unit?.vsu) ?? blank(ctx.office.vliPolygon) ?? '',
      blank(unit?.vsc) ?? blank(ctx.office.vsc) ?? '',
      blank(unit?.vac) ?? blank(ctx.landform?.vac) ?? '',
      blank(unit?.evc) ?? blank(ctx.office.evc) ?? '',
      className(unit?.vqo ?? objectiveOf(ctx)),
    ],
  ]
}

/** Row 3: the blocks' plan-view areas, with any recorded retention they include. */
export function operationArea(blocks: readonly ReportBlockFacts[]): string | null {
  if (!blocks.length) return null
  const total = blocks.reduce((sum, block) => sum + block.areaHa, 0)
  const retained = blocks.reduce((sum, block) => sum + (leaveHa(block) ?? 0), 0)
  const sizes =
    blocks.length === 1
      ? `Block ${blocks[0].name}`
      : blocks.map((block) => `${block.name} ${ha(block.areaHa)} ha`).join(', ')
  return `${ha(total)} ha (${sizes}${retained > 0 ? `; includes about ${ha(retained)} ha of recorded retention` : ''})`
}

const DISTRICT_ROW = {
  inventory: '1. Visual Landscape Inventory/Analysis Data',
  lake: '2. Lake (if applicable)',
  area: '3. Area of proposed operation (plan view) (block sizes)',
  viewpoints: '4. Viewpoints for assessment (name and/or #)',
  existing: '5. Percent of VLU in existing alteration (not visually greened up) (perspective view)',
  proposed: '6. Percent of VLU in proposed alteration (perspective view)',
  total: '7. Total percent alteration visible (perspective view)',
  guidelines: `8. Does total % alteration fall within VQO guidelines? (${PERCENT_SCALES.guidebookStrict.printed})`,
  design:
    '9. Describe design principles and practices that are being applied to blend the proposed operation with the characteristic landscape (e.g. visual force analysis, irregular boundaries, leave trees/patches, feathering edges, etc.)',
  definition: '10. Will the proposed operation meet the definition and intent of the VQO?',
  allOperations:
    '11. Has the VIA included all proposed operations within the VLU? (e.g. other licensee blocks or future blocks)',
  additional: '12. Additional considerations',
} as const

/** The district form's notes, in its own order. */
export const DISTRICT_NOTES = [
  'It is strongly recommended that the district visual landscape specialist be consulted before carrying out a VIA to confirm viewpoint locations and VIA content requirements.',
  'Proposed operations are assessed using three criteria: scale of alteration, quality of design, and definition and intent of the VQO. Silvicultural systems which leave significant tree cover will be assessed more by basal area, volume and stems remaining than by scale of alteration.',
  'VQOs must be achieved from all viewpoints.',
  'Licensees are ultimately responsible for ensuring the visual quality objectives are met. Monitoring from viewpoints during harvest will help licensees meet them.',
] as const

/** 02's last page: the Kamloops Forest Region "Visual Impact Assessment Summary Table", rows 1-12 and notes 1-4. */
const districtSummaryForm: ReportPart = {
  id: 'district-summary-form',
  title: 'VIA summary table',
  sources: ['02'],
  build: (ctx) => {
    const toComplete: string[] = []
    const header = [
      officeRow(ctx, 'licensee', 'Licensee name'),
      field(
        'Sale or licence #',
        [blank(ctx.office.licence), blank(ctx.office.cuttingPermit) ? `CP ${ctx.office.cuttingPermit!.trim()}` : null]
          .filter(Boolean)
          .join(', '),
        'scene',
      ),
      { ...blocksField(ctx), label: 'Block #' },
      officeRow(ctx, 'evaluator', 'Completed by'),
      field('Date', today(ctx), 'run'),
    ]
    toComplete.push(...missingFields(header))

    // Row 1: the inventory units, and the inventory's date, which nothing the page reads records.
    const units = inventoryRows(ctx)
    const unitColumns = ['Landform', 'VLU #', 'VSR', 'VAC', 'EVC', 'VQO']
    const gaps = unitColumns.filter((_, column) => units.some((row) => !row[column]))
    if (gaps.length) toComplete.push(`1. Inventory data: ${andList(gaps)}`)
    const inventoryDate = field('Date of inventory', null, 'scene')
    toComplete.push('1. Date of inventory')

    // Row 2: no lake is known to the page, so the lake and its lakeshore management zone stay to complete.
    toComplete.push('2. Lake name, number and class, and the LMZ area and alteration (if a lake applies)')

    const area = field(DISTRICT_ROW.area, operationArea(ctx.blocks), 'scene')
    toComplete.push(...missingFields([area]))

    const figures = districtFigures(ctx)
    const percent = (value: string | null) => (value === null ? '' : `${value}%`)
    const noFigure = figures.filter((vp) => vp.total === null).map((vp) => vp.name)
    if (!figures.length) toComplete.push('4. Viewpoints for assessment: save a viewpoint')
    if (noFigure.length) toComplete.push(`5-8. Percent alteration (no class pass): ${andList(noFigure)}`)
    const noObjective = figures.filter((vp) => vp.total !== null && vp.within === null).map((vp) => vp.name)
    if (noObjective.length)
      toComplete.push(`8. Established VQO to read the guidelines against: ${andList(noObjective)}`)
    const sightline = ctx.facts.viewpoints
      .filter((vp) => vp.sightlinePercent !== null)
      .map((vp) => `${vp.name} ${vp.sightlinePercent!.toFixed(2)}%`)

    const rating = ctx.assessment?.rating ?? null
    const reviewer = [
      field(DISTRICT_ROW.design, ctx.measures.length ? ctx.measures.join('; ') : null, 'reviewer'),
      field(DISTRICT_ROW.definition, rating ? yesNo(rating.definitionAchieved) : null, 'reviewer'),
      field(DISTRICT_ROW.allOperations, null, 'reviewer'),
      field(DISTRICT_ROW.additional, null, 'reviewer'),
    ]
    toComplete.push(...missingFields(reviewer))

    const blocks: ReportBlock[] = [
      { kind: 'pageBreak' },
      heading('Visual Impact Assessment Summary Table'),
      fields(header),
      {
        kind: 'table',
        title: DISTRICT_ROW.inventory,
        columns: unitColumns,
        rows: units,
        source: 'run',
      },
      fields([inventoryDate]),
      {
        kind: 'table',
        title: DISTRICT_ROW.lake,
        columns: [
          'Lake name',
          'Lake #',
          'Lake class',
          'Area of LMZ',
          'Area of existing alteration in LMZ',
          'Area of proposed alteration in LMZ',
          'Total percent alteration in LMZ',
        ],
        rows: [['', '', '', '', '', '', '']],
        source: 'reviewer',
      },
      fields([area]),
      {
        kind: 'table',
        columns: [DISTRICT_ROW.viewpoints, ...(figures.length ? figures.map((vp) => vp.name) : [''])],
        rows: [
          [DISTRICT_ROW.existing, ...(figures.length ? figures.map((vp) => percent(vp.existing)) : [''])],
          [DISTRICT_ROW.proposed, ...(figures.length ? figures.map((vp) => percent(vp.proposed)) : [''])],
          [DISTRICT_ROW.total, ...(figures.length ? figures.map((vp) => percent(vp.total)) : [''])],
          [DISTRICT_ROW.guidelines, ...(figures.length ? figures.map((vp) => vp.within ?? '') : [''])],
        ],
        note: `Rows 5-7 measure each view’s class pass as ${ctx.document.format.rule.formula} (${ctx.document.format.rule.basis}); row 8 reads the total on the form’s strict bounds.${
          sightline.length ? ` The run’s sightline figures, the assessment’s: ${sightline.join(', ')}.` : ''
        }`,
        source: 'run',
      },
      fields(reviewer),
      heading('Notes', 3),
      { kind: 'list', items: [...DISTRICT_NOTES], ordered: true, source: 'fixed' },
      text('Visual Impact Assessment Guidelines · Kamloops Forest Region', 'fixed'),
    ]
    return { blocks, toComplete }
  },
}

// ------------------------------------------------------------------ 2001 forms: header and block areas (01, 03, 05)

/**
 * The 2001 form's header (01 p1, 03 p1). The summary form that carries notes (03, 05) also asks for the year of
 * harvest and the type of operation, which no record on the page holds.
 */
const formHeader2001: ReportPart = {
  id: 'form-header-2001',
  title: 'Form header',
  sources: ['01', '03', '05'],
  build: (ctx) => {
    const summaryForm = !!ctx.recipeParts?.includes('notes-2001')
    const rows: FieldRow[] = [
      officeRow(ctx, 'licensee', 'Licensee name'),
      officeRow(ctx, 'licence', 'Licensee no.'),
      officeRow(ctx, 'cuttingPermit', 'Cutting permit'),
      blocksField(ctx),
      officeRow(ctx, 'generalLocation', 'General location'),
      field('Proposed silvicultural system', systemsLine(ctx.blocks), 'scene'),
      ...(summaryForm
        ? [field('Proposed year of harvest', null, 'reviewer'), field('Type of proposed operation', null, 'reviewer')]
        : []),
      field('Date', today(ctx), 'run'),
    ]
    return { blocks: [fields(rows)], toComplete: missingFields(rows) }
  },
}

/** 01's block table: gross, leave and net hectares per block, with the total. */
const blockAreas2001: ReportPart = {
  id: 'block-areas-2001',
  title: 'Block areas',
  sources: ['01', '03', '05'],
  build: (ctx) => {
    const rows = ctx.blocks.map((block) => {
      const leave = leaveHa(block)
      return [
        block.name,
        ha(block.areaHa),
        leave === null ? '' : ha(leave),
        leave === null ? '' : ha(block.areaHa - leave),
      ]
    })
    const unknown = ctx.blocks.filter((block) => leaveHa(block) === null).map((block) => block.name)
    const gross = ctx.blocks.reduce((sum, block) => sum + block.areaHa, 0)
    const leave = ctx.blocks.reduce((sum, block) => sum + (leaveHa(block) ?? 0), 0)
    if (ctx.blocks.length > 1)
      rows.push(['Total', ha(gross), unknown.length ? '' : ha(leave), unknown.length ? '' : ha(gross - leave)])
    return {
      blocks: [
        {
          kind: 'table',
          columns: ['Block', 'Gross (ha)', 'Leave (ha)', 'Net (ha)'],
          rows,
          note: 'Gross is the block’s planar BC Albers area; leave is its recorded retention.',
          source: 'scene',
        },
      ],
      toComplete: unknown.length ? [`Leave and net area (no retention recorded): ${andList(unknown)}`] : [],
    }
  },
}

// ------------------------------------------------------------------ 01: section 2, the FPPR criteria per viewpoint

interface CriterionRow {
  label: string
  /** The options the form lists under the label. */
  options: string
  value: (vp: FactsViewpoint, index: number) => string
}

/** 01's "Section 2 Assessing Basic VQO Definition": each FPPR criterion rated per viewpoint, options listed. */
const criteriaRating2001: ReportPart = {
  id: 'criteria-rating-2001',
  title: 'Assessing basic VQO definition',
  sources: ['01'],
  build: (ctx) => {
    const vps = ctx.facts.viewpoints
    const ocular = ctx.review?.ocular ?? null
    const scale = ctx.document.format.percentScale
    const rows: CriterionRow[] = [
      {
        label: 'Blocks & roads visible',
        options: '',
        value: (vp) => {
          if (vp.blocks.some((block) => block.status === 'unknown')) return ''
          const ids = vp.blocks
            .filter(seen)
            .map((block) => (block.status === 'possible glimpses' ? `${block.id} (glimpses)` : block.id))
          return ids.length ? blockList(ids) : vp.blocks.length ? 'None' : ''
        },
      },
      {
        label: 'Ease of seeing or visibility',
        options: ['Not visible', ...VISIBLENESS_TERMS.map((t) => t.label)].join(', '),
        value: (vp) =>
          allHidden(vp)
            ? 'Not visible'
            : vp.review
              ? (VISIBLENESS_TERMS.find((t) => t.id === ocular?.visibleness)?.label ?? '')
              : '',
      },
      {
        label: 'Scale of alteration',
        options: SCALE_TERMS.map((t) => t.label).join(', '),
        value: (vp, index) => {
          const chosen = vp.review ? SCALE_TERMS.find((t) => t.id === ocular?.scale)?.label : undefined
          if (chosen) return chosen
          const printed = ctx.document.viewpoints[index]?.printed
          return printed ? `${printed.term.charAt(0).toUpperCase()}${printed.term.slice(1)} (${printed.percent}%)` : ''
        },
      },
      {
        label: 'Existing human-made alterations present?',
        options: 'Angular and geometric (Poor), small to moderate but angular (Moderate), natural appearing (Good)',
        value: () => '',
      },
      {
        label: 'Proposal design',
        options: SHAPE_TERMS.map((t) => t.label).join(', '),
        value: (vp) =>
          allHidden(vp)
            ? 'No visible alteration'
            : vp.review
              ? (SHAPE_TERMS.find((t) => t.id === ocular?.shape)?.label ?? '')
              : '',
      },
      {
        label: 'Viewpoint importance and duration',
        options: 'Low 1 2 3 4 5 High',
        value: (vp) => (vp.review && ctx.review?.viewpointType ? String(ctx.review.viewpointType) : ''),
      },
      {
        label: 'Distance from viewpoint',
        options: 'Poor (under 1 km), Moderate (1 to 8 km), Good (over 8 km)',
        value: (vp) => (vp.distanceKm === null ? '' : (designDistanceScore(vp.distanceKm * 1000)?.grade ?? '')),
      },
      {
        label: 'Category of visually altered landform',
        options: CLASS_ORDER.map((code) => CLASS_NAMES[code]).join(', '),
        value: (vp) => {
          const id = vp.review ? ctx.assessment?.ocular?.classId : undefined
          const code = id ? CLASS_CODES_BY_ID[id] : undefined
          return code ? CLASS_NAMES[code] : ''
        },
      },
    ]
    const cells = rows.map((row) => vps.map((vp, index) => row.value(vp, index)))
    const toComplete = rows.flatMap((row, r) => {
      const missing = vps.filter((_, index) => !cells[r][index]).map((vp) => vp.name)
      return missing.length ? [`Section 2, ${row.label.toLowerCase()}: ${andList(missing)}`] : []
    })
    const ocularCode = ctx.assessment?.ocular ? CLASS_CODES_BY_ID[ctx.assessment.ocular.classId] : null
    if (!ocularCode) toComplete.push('Section 2: the basic VQO definition met from all viewpoints (class by eye)')
    toComplete.push('Section 2: reasons the basic definition is not achieved, if it is not')
    return {
      blocks: [
        heading('2. Assessing basic VQO definition'),
        {
          kind: 'table',
          columns: ['FPPR criteria', ...vps.map((vp, i) => `VP ${vp.n ?? i + 1}: ${vp.name}`)],
          rows: rows.map((row, r) => [row.options ? `${row.label}: ${row.options}` : row.label, ...cells[r]]),
          note: `Blocks visible and distance are the run’s, and roads the reviewer’s to add; scale is the pixel figure read on ${scale.name} unless the reviewer chose a term; the other ratings are the reviewer’s, at the assessment station.`,
          source: 'run',
        },
        text('Viewpoint importance and duration, rated 1 to 5:', 'fixed'),
        { kind: 'list', items: VIEWPOINT_TYPES.map((type) => `(${type.id}) ${type.label}`), source: 'fixed' },
        {
          kind: 'choices',
          label:
            'Which basic VQO definition would the proposed alteration, in combination with any existing non-VEG alterations, meet from all the selected viewpoints, taking into account viewpoint importance, viewing distance and duration?',
          options: [...CLASS_ORDER],
          chosen: ocularCode,
          source: 'reviewer',
        },
        fields([
          field(
            'If applicable, state reasons why the proposed alteration(s) does not achieve the basic definition of the established VQO from any of the selected viewpoints',
            null,
            'reviewer',
          ),
        ]),
      ],
      toComplete,
    }
  },
}

// ------------------------------------------------------------------ 01: section 5, the five summary questions

const FIVE_YEAR_QUESTION =
  'Has this visual impact assessment incorporated all known alterations proposed in the scenic area for the next 5 years (i.e., all operations proposed by the same or different licensees)?'

/** Each viewpoint's figure against the objective's range, in a sentence (05's one-line statements). */
function numericStatements(ctx: ReportContext): Sentence[] {
  const scale = ctx.document.format.percentScale
  return ctx.document.viewpoints.flatMap((vp, index) => {
    const facts = ctx.facts.viewpoints[index]
    const objective = facts ? objectiveAt(ctx, facts) : objectiveOf(ctx)
    if (!vp.printed || !objective) return []
    const within = withinRange(scale, vp.alteration?.printedValue ?? Number(vp.printed.percent), objective)
    return [
      fillSentence(
        'numeric-statement',
        'From {viewpoint}, the alteration is {percent}% of the {basis}, {standing} the {objective} range ({range}).',
        {
          viewpoint: vp.name,
          percent: vp.printed.percent,
          basis: ctx.document.format.rule.basis,
          standing: within ? 'within' : 'over',
          objective: CLASS_NAMES[objective],
          range: rangeFor(scale, objective),
        },
        'run',
      ),
    ]
  })
}

/** 01's "Section 5 VIA Summary": the 2001 summary's four questions and the five-year all-operations question. */
const summary2001Five: ReportPart = {
  id: 'summary-2001-five',
  title: 'VIA summary',
  sources: ['01'],
  build: (ctx) => {
    const objective = objectiveOf(ctx)
    const scale = ctx.document.format.percentScale
    const readings = ctx.document.viewpoints.flatMap((vp, index) => {
      const facts = ctx.facts.viewpoints[index]
      const at = facts ? objectiveAt(ctx, facts) : objective
      const within = withinRange(scale, vp.alteration ? vp.alteration.printedValue : null, at)
      return within === null ? [] : [{ name: vp.name, within }]
    })
    // Within only when every viewpoint with a figure is: VQOs must be met from all selected viewpoints.
    const numerical = readings.length ? readings.every((reading) => reading.within) : null
    const ocular = ctx.assessment?.ocular ?? null
    const definition = ocular && objective ? rank(CLASS_CODES_BY_ID[ocular.classId]) <= rank(objective) : null
    const design = ctx.assessment?.designTotal == null ? null : ctx.assessment.designTotal <= 0
    const rating = ctx.assessment?.rating ?? null
    const questions: Array<{ label: string; chosen: boolean | null; source: 'run' | 'reviewer' }> = [
      {
        label:
          'Does the proposal, in combination with any existing non-VEG alterations, achieve the basic definition for the established VQO?',
        chosen: definition,
        source: 'reviewer',
      },
      {
        label: 'Have visual design concepts and principles been incorporated into block/road design?',
        chosen: design,
        source: 'reviewer',
      },
      {
        label:
          'Does the proposal, in combination with any existing non-VEG alterations, fall within the numerical ranges for the established VQO?',
        chosen: numerical,
        source: 'run',
      },
      {
        label:
          'Given the three criteria listed above, does the proposal meet the established VQO from all the selected viewpoint(s)?',
        chosen: rating ? rating.definitionAchieved : null,
        source: 'reviewer',
      },
      { label: FIVE_YEAR_QUESTION, chosen: null, source: 'reviewer' },
    ]
    const over = readings.filter((reading) => !reading.within).map((reading) => reading.name)
    const reasons = over.length
      ? fillSentence(
          'reasons-not-met',
          'Reasons the alteration exceeds the range from {viewpoints}: {reasons}',
          { viewpoints: andList(over), reasons: blank(ctx.review?.rationale) },
          'reviewer',
        )
      : null
    return {
      blocks: [
        heading('5. VIA summary'),
        ...questions.map(
          (q): ReportBlock => ({
            kind: 'choices',
            label: q.label,
            options: ['Yes', 'No'],
            chosen: yesNo(q.chosen),
            source: q.source,
          }),
        ),
        ...paragraph([...numericStatements(ctx), ...(reasons ? [reasons] : [])]),
        ...(reasons && !reasons.text
          ? [fields([field(`Reasons the alteration exceeds the range from ${andList(over)}`, null, 'reviewer')])]
          : []),
      ],
      toComplete: [
        ...questions.filter((q) => q.chosen === null).map((q) => q.label),
        ...(reasons && !reasons.text ? ['Reasons the alteration exceeds the numerical range'] : []),
      ],
    }
  },
}

// ------------------------------------------------------------------ 01, 05: certification and attachments

/** 01's signature page: the qualified registered professional, a certification statement, and the attachments. */
const certification2001: ReportPart = {
  id: 'certification-2001',
  title: 'Certification and attachments',
  sources: ['01', '05'],
  build: (ctx) => {
    const before = ctx.images?.before ? Object.keys(ctx.images.before).length : 0
    const vps = ctx.facts.viewpoints.length
    const attachments: Array<{ name: string; attached: boolean }> = [
      { name: 'VIA overview map', attached: !!ctx.images?.overviewMap },
      { name: 'Overhead model renders', attached: !!ctx.images?.overhead?.length },
      {
        name:
          before && before < vps
            ? `Site photography by viewpoint (${before} of ${vps} viewpoints)`
            : 'Site photography by viewpoint',
        attached: before > 0,
      },
      { name: 'Harvest simulations by viewpoint', attached: ctx.figures.length > 0 },
    ]
    const rows = [officeRow(ctx, 'evaluator', 'Qualified registered professional responsible for VIA findings')]
    const attached = attachments.filter((entry) => entry.attached).map((entry) => entry.name)
    return {
      blocks: [
        { kind: 'pageBreak' },
        heading('Signature of qualified registered professional responsible for VIA findings'),
        fields(rows),
        {
          kind: 'choices',
          label: 'Certification:',
          options: [
            'I certify that the work described herein fulfills the standards expected of a registered forest professional and that I did personally supervise the work',
            'I certify that I have reviewed this document and, while I did not personally supervise the work, have determined that it has been done to the standards expected of a registered forest professional',
          ],
          chosen: null,
          source: 'reviewer',
        },
        { kind: 'signature', lines: ['Signature', 'Name, professional designation and seal', 'Date'] },
        heading('Attachments', 3),
        attached.length ? { kind: 'list', items: attached, source: 'run' } : text('Nothing is attached yet.', 'run'),
      ],
      toComplete: [
        ...missingFields(rows),
        'Certification statement and signature',
        ...attachments.filter((entry) => !entry.attached).map((entry) => `Attachment: ${entry.name}`),
      ],
    }
  },
}

// ------------------------------------------------------------------ 03, 05: notes and additional considerations

/** The 2001 summary form's notes (03 p5). */
export const NOTES_2001 = [
  'It is strongly recommended that the district office be consulted before carrying out an assessment to confirm viewpoint locations and content recommendations.',
  'Proposed alterations are assessed using three criteria (the first two being the most critical ones): (1) meeting basic definition and intent of VQO, (2) quality of design, and (3) scale of alteration.',
  'Silvicultural systems leaving significant tree cover will be assessed using volume or stems remaining rather than by scale of alteration, as outlined in Visual Impacts of Partial Cutting (1997).',
  'Visual quality objectives must be achieved from all selected viewpoints.',
] as const

/** 03's NOTES 1-4 and ADDITIONAL CONSIDERATIONS, with note 2's three tests read for this proposal. */
const notes2001: ReportPart = {
  id: 'notes-2001',
  title: 'Notes and additional considerations',
  sources: ['03', '05'],
  build: (ctx) => {
    const objective = objectiveOf(ctx)
    const scale = ctx.document.format.percentScale
    const figures = ctx.document.viewpoints
      .filter((vp) => vp.printed)
      .map((vp) => `${vp.printed!.percent}% from ${vp.name}`)
    const tests = fillSentence(
      'three-tests',
      'Here the definition and intent are those of {objective}; the scale of alteration, as a share of the {basis}, is {figures}, against the {range} range.',
      {
        objective: objective ? `${CLASS_NAMES[objective]} (${objective})` : null,
        figures: andList(figures),
        basis: ctx.document.format.rule.basis,
        range: objective ? rangeFor(scale, objective) : null,
      },
      'run',
    )
    // The five-year question is asked once: in the summary when the report's summary carries it (01).
    const asked = !!ctx.recipeParts?.includes('summary-2001-five')
    const comments = field('Comments', null, 'reviewer')
    return {
      blocks: [
        heading('Notes', 3),
        { kind: 'list', items: [...NOTES_2001], ordered: true, source: 'fixed' },
        ...paragraph([tests]),
        heading('Additional considerations', 3),
        ...(asked
          ? []
          : [
              {
                kind: 'choices',
                label: `${FIVE_YEAR_QUESTION} ²`,
                options: ['Yes', 'No'],
                chosen: null,
                source: 'reviewer',
              } satisfies ReportBlock,
            ]),
        fields([comments]),
        text(
          '² In scenic areas where licensees share operating areas, they should co-ordinate in preparing VIAs: existing and proposed cutblocks and roads visible from the same viewpoints are shown for all licensees. One VIA may then satisfy several licensees, and digital data may be shared in preparing them.',
          'fixed',
        ),
      ],
      toComplete: [
        ...(asked ? [] : ['Additional considerations: all known alterations for the next 5 years']),
        'Additional considerations: comments (if any)',
        ...(tests.text ? [] : [`Note 2 for this proposal (needs ${andList(tests.missing)})`]),
      ],
    }
  },
}

// ------------------------------------------------------------------ 01, 03, 05: design techniques

const SYSTEM_PHRASE: Record<string, string> = {
  Clearcut: 'clearcut harvest',
  'Dispersed retention': 'dispersed-retention harvest',
  'Partial cut': 'partial cutting',
}

/**
 * What the scene records about the design, in sentences: the harvest system of each block, the retention it keeps and
 * a partial cut's removal; then what the class pass shows of existing openings short of visual green-up, per
 * viewpoint (05's design comments). The techniques themselves are the reviewer's.
 */
export function designTechniqueSentences(ctx: ReportContext): Sentence[] {
  const out: Sentence[] = []
  const blocks = ctx.blocks
  if (blocks.length) {
    const systems = [...new Set(blocks.map((block) => block.system))]
    out.push(
      fillSentence(
        'design-system',
        'The proposal is {systems}.',
        {
          systems: andList(
            systems.map(
              (system) =>
                `${SYSTEM_PHRASE[system] ?? system.toLowerCase()} of ${blockList(
                  blocks.filter((block) => block.system === system).map((block) => block.name),
                )}`,
            ),
          ),
        },
        'scene',
      ),
    )
    for (const block of blocks) {
      const leave = leaveHa(block)
      if (leave !== null && block.retentionPercent! > 0)
        out.push({
          ...fillSentence(
            'design-retention',
            'Block {block} keeps {percent}% of its area, about {area} ha, standing as retention.',
            { block: block.name, percent: block.retentionPercent, area: ha(leave) },
            'scene',
          ),
          about: `Block ${block.name}`,
        })
      if (block.partialCut)
        out.push({
          ...fillSentence(
            'design-partial-cut',
            'Block {block} removes {removed}% of the volume and leaves a residual stand about {height} m tall.',
            {
              block: block.name,
              removed: block.partialCut.removedPercent,
              height: Math.round(block.partialCut.residualHeightM),
            },
            'scene',
          ),
          about: `Block ${block.name}`,
        })
    }
    const kept = blocks.reduce((sum, block) => sum + (leaveHa(block) ?? 0), 0)
    const gross = blocks.reduce((sum, block) => sum + block.areaHa, 0)
    const retained = blocks.filter((block) => (block.retentionPercent ?? 0) > 0)
    if (retained.length > 1 && gross > 0)
      out.push(
        fillSentence(
          'design-retention-total',
          'In all, about {area} ha of the {gross} ha proposed stays standing ({share}%).',
          { area: ha(kept), gross: ha(gross), share: Math.round((100 * kept) / gross) },
          'scene',
        ),
      )
    const none = blocks.filter((block) => block.retentionPercent === null && !block.partialCut)
    if (none.length)
      out.push(
        fillSentence(
          'design-no-retention',
          'The scene records no retention in {blocks}; wildlife tree patches, reserves and leave trees there are the reviewer’s to describe.',
          { blocks: blockList(none.map((block) => block.name)) },
          'scene',
        ),
      )
  }
  // Existing openings short of visual green-up, from each view's class pass on the format's arithmetic.
  const clear: string[] = []
  ctx.document.viewpoints.forEach((vp) => {
    const existing = vp.alteration?.parts.find((part) => part.part === 'nonVeg')
    if (!vp.alteration || !existing) return
    if (existing.area <= 0) clear.push(vp.name)
    else
      out.push(
        fillSentence(
          'design-existing',
          'From {viewpoint}, existing openings not yet visually greened up make up {percent}% of the {basis}.',
          { viewpoint: vp.name, percent: existing.printed, basis: ctx.document.format.rule.basis },
          'run',
        ),
      )
  })
  if (clear.length)
    out.push(
      fillSentence(
        'design-existing-none',
        'The class pass shows no existing opening short of visually effective green-up from {viewpoints}.',
        { viewpoints: andList(clear) },
        'run',
      ),
    )
  return out
}

/** The 2001 form's "additional design techniques" answer: the scene's record, then the reviewer's own line. */
const designTechniques2001: ReportPart = {
  id: 'design-techniques-2001',
  title: 'Design techniques',
  sources: ['01', '03', '05'],
  build: (ctx) => {
    const sentences = designTechniqueSentences(ctx)
    const techniques = field(
      'If applicable, list any additional design techniques used and/or state reasons why certain design techniques could not be employed',
      null,
      'reviewer',
    )
    return {
      blocks: [heading('Design techniques', 3), ...paragraph(sentences), fields([techniques])],
      toComplete: [
        'Design techniques used, or reasons a technique could not be employed',
        ...sentences.filter((s) => !s.text).map((s) => `Design techniques: ${s.id} (needs ${andList(s.missing)})`),
      ],
    }
  },
}

export const DISTRICT_PARTS: readonly ReportPart[] = [
  districtSummaryForm,
  formHeader2001,
  blockAreas2001,
  criteriaRating2001,
  summary2001Five,
  certification2001,
  notes2001,
  designTechniques2001,
]
