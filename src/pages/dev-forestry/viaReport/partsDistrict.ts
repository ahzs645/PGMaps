/**
 * Report parts for the district and 2001-guidebook forms: the Kamloops Region VIA summary table (02), and the 2001
 * forms' own rows, notes and questions (01, 03, 05). Structure and row labels follow the forms; the labels of a
 * government form are public text, and nothing here names a licensee, consultant or person.
 *
 * As everywhere in the report, the run fills what it measures, the scene what it records, the office fields what the
 * office gave, and the reviewer's step 4 record fills judgements at the assessment station only. Anything else prints
 * blank and is listed as to complete. Registered in `registry.ts`. No DOM or network access.
 */
import { jsonPart } from './reportEngine'
import { blockId, blockList, significanceScore } from '../viaDocument/resolve'
import { atAssessmentStation, judgedOcular } from '../viaDocument/facts'
import { CLASS_NAMES, PERCENT_SCALES, readPercent, type ClassCode, type PercentScale } from '../viaDocument/scales'
import { fillSentence, type Sentence } from '../viaDocument/wording'
import { SCALE_TERMS, SHAPE_TERMS, VIEWPOINT_TYPES, VISIBLENESS_TERMS, type DesignElementId } from '../via'
import { designDistanceScore } from '../vqe'
import { field, fields, heading, text, type ReportBlock } from './model'
import {
  assessed,
  blank,
  CERTIFICATION_STATEMENTS,
  CLASS_CODES_BY_ID,
  CLASS_ORDER,
  ha,
  missingFields,
  objectiveOf,
  officeRow,
  preparerRow,
  paragraph,
  PRIVATE_LAND_NETTED,
  proposedBlocks,
  inventoryDateField,
  rangeStanding,
  ROCK_NETTED,
  SUMMARY_QUESTIONS_2001,
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

/** A block's recorded leave (retention) area, hectares, or null when the scene records none. */
const leaveHa = (block: ReportBlockFacts) =>
  block.retentionPercent === null ? null : (block.areaHa * block.retentionPercent) / 100

/** Mapped reserves (wildlife tree patches / retention) inside a block, hectares, when there is a printable area. */
const reservesOf = (block: ReportBlockFacts) => ((block.reservesHa ?? 0) >= 0.05 ? block.reservesHa! : 0)

/** All a block keeps standing, hectares: its mapped reserves and its dispersed retention; null when neither is recorded. */
const keptHa = (block: ReportBlockFacts) => {
  const leave = leaveHa(block)
  const reserves = reservesOf(block)
  return leave === null && !reserves ? null : Math.min(block.areaHa, reserves + (leave ?? 0))
}

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
  // The units the inventory read, one row each, when the report read it.
  // Only the units a block lies in, when any does: the read covers the whole scene around the viewpoints.
  const holding = (ctx.inventoryUnits ?? []).filter((unit) => Object.keys(unit.blocks ?? {}).length > 0)
  const units = holding.length ? holding : (ctx.inventoryUnits ?? [])
  if (units.length)
    return units.map((unit) => [
      ctx.landform?.name ?? '',
      unit.vsu,
      unit.vsc ?? '',
      unit.vac ?? '',
      unit.evc ?? '',
      className(unit.vqo),
    ])
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
  const retained = blocks.reduce((sum, block) => sum + (keptHa(block) ?? 0), 0)
  const sizes =
    blocks.length === 1
      ? `Block ${blocks[0].name}`
      : blocks.map((block) => `${block.name} ${ha(block.areaHa)} ha`).join(', ')
  const what = [
    blocks.some((block) => reservesOf(block) > 0) ? 'mapped reserves' : '',
    blocks.some((block) => (leaveHa(block) ?? 0) > 0) ? 'recorded retention' : '',
  ]
    .filter(Boolean)
    .join(' and ')
  return `${ha(total)} ha (${sizes}${retained > 0 ? `; includes about ${ha(retained)} ha of ${what}` : ''})`
}

export { harvestYearLine } from './formLines'

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

/** What the rationale is for, as row 9 names it: the licence, the cutting permit and the blocks ("A00000 CP 1 blks X1, X2"). */
export function rationaleSubject(ctx: ReportContext): string {
  const licence = blank(ctx.office.licence)
  return `${licence ? `${licence} ` : ''}${projectLine(ctx)}`
}

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
      preparerRow(ctx, 'Completed by'),
      field('Date', today(ctx), 'run'),
    ]
    toComplete.push(...missingFields(header))

    // Row 1: the inventory units, and the inventory's date, which nothing the page reads records.
    const units = inventoryRows(ctx)
    const unitColumns = ['Landform', 'VLU #', 'VSR', 'VAC', 'EVC', 'VQO']
    const gaps = unitColumns.filter((_, column) => units.some((row) => !row[column]))
    if (gaps.length) toComplete.push(`1. Inventory data: ${andList(gaps)}`)
    const inventoryDate = inventoryDateField(ctx)
    if (inventoryDate.value === null) toComplete.push('1. Date of inventory')

    // Row 2: no lake is known to the page, so the lake and its lakeshore management zone stay to complete.
    // The reviewer's lake or management zone (office fields) names the row; its areas stay to complete.
    const lmz = blank(ctx.office.lakeManagementZone)
    toComplete.push(
      lmz
        ? `2. ${lmz}: lake number and class, and the LMZ area and alteration`
        : '2. Lake name, number and class, and the LMZ area and alteration (if a lake applies)',
    )

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
    // A view whose run was provisional at the save names why, never a figure (`capturedSightline`).
    const sightlineWithheld = ctx.facts.viewpoints.filter((vp) => vp.sightlinePercent === null && vp.sightlineWithheld)

    const rating = ctx.assessment?.rating ?? null
    // When the report carries the design rationale, rows 9 and 12 refer to it, as the form's users write them; what
    // the rationale says stays the reviewer's, and its own part lists what it leaves blank.
    const rationale = ctx.recipeParts?.includes('design-rationale')
      ? `Refer to the attached Visual Landscape Design Rationale for ${rationaleSubject(ctx)}`
      : null
    const reviewer = [
      rationale
        ? field(DISTRICT_ROW.design, rationale, 'run')
        : field(DISTRICT_ROW.design, ctx.measures.length ? ctx.measures.join('; ') : null, 'reviewer'),
      field(DISTRICT_ROW.definition, rating ? yesNo(rating.definitionAchieved) : null, 'reviewer'),
      field(DISTRICT_ROW.allOperations, null, 'reviewer'),
      rationale ? field(DISTRICT_ROW.additional, rationale, 'run') : field(DISTRICT_ROW.additional, null, 'reviewer'),
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
        rows: [[lmz ?? '', '', '', '', '', '', '']],
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
        }${sightlineWithheld
          .map(
            (vp) =>
              ` ${ctx.facts.viewpoints.length > 1 ? `${vp.name}: sightline figure: ` : 'Sightline figure: '}${vp.sightlineWithheld}`,
          )
          .join('')}${ctx.facts.viewpoints
          .filter((vp) => vp.terrainNote)
          .map((vp) => ` ${ctx.facts.viewpoints.length > 1 ? `${vp.name}: ` : ''}${vp.terrainNote}`)
          .join('')}`,
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

/** form-header-2001: defined once in JSON (`recipeJson/components/form-header-2001.json`), read by `kitBlocks.ts`. */
const formHeader2001 = jsonPart('form-header-2001')

/** 01's block table: gross, leave and net hectares per block, with the total. */
const blockAreas2001: ReportPart = {
  id: 'block-areas-2001',
  title: 'Block areas',
  sources: ['01', '03', '05'],
  build: (ctx) => {
    const rows = ctx.blocks.map((block) => {
      const leave = keptHa(block)
      return [
        block.name,
        ha(block.areaHa),
        leave === null ? '' : ha(leave),
        leave === null ? '' : ha(block.areaHa - leave),
      ]
    })
    const unknown = ctx.blocks.filter((block) => keptHa(block) === null).map((block) => block.name)
    const gross = ctx.blocks.reduce((sum, block) => sum + block.areaHa, 0)
    const leave = ctx.blocks.reduce((sum, block) => sum + (keptHa(block) ?? 0), 0)
    if (ctx.blocks.length > 1)
      rows.push(['Total', ha(gross), unknown.length ? '' : ha(leave), unknown.length ? '' : ha(gross - leave)])
    return {
      blocks: [
        {
          kind: 'table',
          columns: ['Block', 'Gross (ha)', 'Leave (ha)', 'Net (ha)'],
          rows,
          note: 'Gross is the block’s planar BC Albers area; leave is its mapped reserves (wildlife tree patches / retention) and recorded dispersed retention.',
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
    // Each viewpoint's terms are its group's step 4 (`judgedOcular`).
    const ocularOf = (vp: (typeof vps)[number]) => judgedOcular(vp, ctx)
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
            : atAssessmentStation(vp)
              ? (VISIBLENESS_TERMS.find((t) => t.id === ocularOf(vp)?.visibleness)?.label ?? '')
              : '',
      },
      {
        label: 'Scale of alteration',
        options: SCALE_TERMS.map((t) => t.label).join(', '),
        value: (vp, index) => {
          const chosen = atAssessmentStation(vp)
            ? SCALE_TERMS.find((t) => t.id === ocularOf(vp)?.scale)?.label
            : undefined
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
            : atAssessmentStation(vp)
              ? (SHAPE_TERMS.find((t) => t.id === ocularOf(vp)?.shape)?.label ?? '')
              : '',
      },
      {
        label: 'Viewpoint importance and duration',
        options: 'Low 1 2 3 4 5 High',
        value: (vp) =>
          String(
            significanceScore(vp.review?.importance) ??
              vp.review?.viewpointType ??
              ((vp.atAssessment ?? atAssessmentStation(vp)) ? ctx.review?.viewpointType : null) ??
              '',
          ),
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
          const id = atAssessmentStation(vp) ? judgedOcular(vp, ctx)?.classId : undefined
          const code = id ? CLASS_CODES_BY_ID[id as keyof typeof CLASS_CODES_BY_ID] : undefined
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
        'From {viewpoint}, the alteration is {percent}% of the {basis}, {standing}.',
        {
          viewpoint: vp.name,
          percent: vp.printed.percent,
          basis: ctx.document.format.rule.basis,
          // The class the figure reads as on this scale; over the range when the scale reads none past its bands.
          standing: rangeStanding(
            readPercent(scale, vp.alteration?.printedValue ?? Number(vp.printed.percent))?.code ??
              (within ? objective : 'MM'),
            objective,
            rangeFor(scale, objective),
          ),
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
        label: SUMMARY_QUESTIONS_2001.definition,
        chosen: definition,
        source: 'reviewer',
      },
      {
        label: SUMMARY_QUESTIONS_2001.design,
        chosen: design,
        source: 'reviewer',
      },
      {
        label: SUMMARY_QUESTIONS_2001.numerical,
        chosen: numerical,
        source: 'run',
      },
      {
        label: SUMMARY_QUESTIONS_2001.met,
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

/**
 * The boxed VIA summary a consultant's 2001-form VIA ends on (05 p5): "VIA Summary - {project}", the four questions
 * each in a ruled box with its Yes/No and a bold one-line answer, then who completed it and when, and the registered
 * professional's signature with the certification statement. The run answers the numerical question and its line;
 * the other answers are the reviewer's, from step 4 at the assessment station, else blank.
 */
/** "CP 405 blks 1, 2, 4, 5, 7": the cutting permit and the proposed blocks, as the boxed summary's title names them. */
const projectLine = (ctx: ReportContext) => {
  const permit = blank(ctx.office.cuttingPermit)
  const ids = proposedBlocks(ctx).map((block) => blockId(block.name))
  return (
    [
      permit ? `CP ${permit.trim()}` : null,
      ids.length ? `${ids.length === 1 ? 'blk' : 'blks'} ${ids.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join(' ') || 'the proposed blocks'
  )
}

const summaryBoxed: ReportPart = {
  id: 'summary-boxed',
  title: 'VIA summary',
  sources: ['05'],
  build: (ctx) => {
    const objective = objectiveOf(ctx)
    const scale = ctx.document.format.percentScale
    const readings = ctx.document.viewpoints.flatMap((vp, index) => {
      const facts = ctx.facts.viewpoints[index]
      const at = facts ? objectiveAt(ctx, facts) : objective
      const value = vp.alteration ? vp.alteration.printedValue : null
      const within = withinRange(scale, value, at)
      return within === null || value === null ? [] : [{ name: vp.name, within, value, printed: vp.printed!.percent }]
    })
    const numerical = readings.length ? readings.every((reading) => reading.within) : null
    // The objective's ceiling as the scale prints it (PR: 7.0), for "Less than 7.0 percent alteration".
    const ceiling = objective ? (scale.bands.find((b) => b.code === objective)?.max ?? null) : null
    const highest = readings.reduce<(typeof readings)[number] | null>((a, b) => (!a || b.value > a.value ? b : a), null)
    const numericalAnswer =
      numerical === null || !highest
        ? null
        : numerical && ceiling !== null
          ? `Less than ${ceiling.toFixed(1)} percent alteration (at most ${highest.printed}%, from ${highest.name}).`
          : `${highest.printed}% alteration from ${highest.name}, over the ${objective ? CLASS_NAMES[objective] : ''} range.`
    const ocular = ctx.assessment?.ocular ?? null
    const definition = ocular && objective ? rank(CLASS_CODES_BY_ID[ocular.classId]) <= rank(objective) : null
    const design = ctx.assessment?.designTotal == null ? null : ctx.assessment.designTotal <= 0
    const rating = ctx.assessment?.rating ?? null
    // The reviewer's own words where step 4 has them: the impact and visibility terms, the rationale.
    const review = assessed(ctx)?.review
    const seenAnswer =
      review?.visibility || review?.impact
        ? `Activities are ${(review.visibility ?? 'visible').toLowerCase()}${review.impact ? `, and remain ${review.impact.toLowerCase()}` : ''}.`
        : null
    const questions: Array<{
      label: string
      chosen: boolean | null
      answer: string | null
      source: 'run' | 'reviewer'
    }> = [
      {
        label: SUMMARY_QUESTIONS_2001.definition,
        chosen: definition,
        answer: seenAnswer,
        source: 'reviewer',
      },
      {
        label: SUMMARY_QUESTIONS_2001.design,
        chosen: design,
        answer: blank(ctx.measures.join(' ')) ?? null,
        source: 'reviewer',
      },
      {
        label: SUMMARY_QUESTIONS_2001.numerical,
        chosen: numerical,
        answer: numericalAnswer,
        source: 'run',
      },
      {
        label: SUMMARY_QUESTIONS_2001.met,
        chosen: rating ? rating.definitionAchieved : null,
        answer: blank(ctx.review?.rationale) ?? null,
        source: 'reviewer',
      },
    ]
    const rows = [preparerRow(ctx, 'Completed by'), field('Date completed', null, 'reviewer')]
    return {
      blocks: [
        heading(`VIA Summary - ${projectLine(ctx)}`),
        ...questions.map(
          (q): ReportBlock => ({
            kind: 'choices',
            label: q.label,
            options: ['Yes', 'No'],
            chosen: yesNo(q.chosen),
            answer: q.answer,
            boxed: true,
            source: q.source,
          }),
        ),
        fields(rows),
        text(CERTIFICATION_STATEMENTS.supervised, 'fixed'),
        { kind: 'signature', lines: ['Signature and seal', 'Name, RPF', 'Date'] },
      ],
      toComplete: [
        ...questions.filter((q) => q.chosen === null).map((q) => q.label),
        ...questions.filter((q) => q.source === 'reviewer' && !q.answer).map((q) => `Summary answer: ${q.label}`),
        ...missingFields(rows),
        'Signature and certification',
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
    // Only what the report itself prints is listed: a part the recipe leaves out attaches nothing.
    const prints = (...ids: string[]) => !ctx.recipeParts || ids.some((id) => ctx.recipeParts!.includes(id))
    const attachments: Array<{ name: string; attached: boolean }> = [
      ...(prints('overview-map', 'overview-sheet')
        ? [{ name: 'VIA overview map', attached: !!(ctx.images?.overviewMap ?? ctx.images?.overviewSheet) }]
        : []),
      ...(prints('overhead-renders', 'simulation-pages')
        ? [
            {
              name: prints('overhead-renders') ? 'Overhead model renders' : 'Oblique model renders',
              attached: !!ctx.images?.overhead?.length,
            },
          ]
        : []),
      ...(prints('photo-simulation-pairs', 'ea-figure-pages')
        ? [
            {
              name:
                before && before < vps
                  ? `Site photography by viewpoint (${before} of ${vps} viewpoints)`
                  : 'Site photography by viewpoint',
              attached: before > 0,
            },
          ]
        : []),
      { name: 'Harvest simulations by viewpoint', attached: ctx.figures.length > 0 },
    ]
    const rows = [preparerRow(ctx, 'Qualified registered professional responsible for VIA findings')]
    const attached = attachments.filter((entry) => entry.attached).map((entry) => entry.name)
    return {
      blocks: [
        { kind: 'pageBreak' },
        heading('Signature of qualified registered professional responsible for VIA findings'),
        fields(rows),
        {
          kind: 'choices',
          label: 'Certification:',
          options: [CERTIFICATION_STATEMENTS.supervised, CERTIFICATION_STATEMENTS.reviewed],
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
    // Note 2 read for this proposal repeats the figures the 2001 summary already states per viewpoint (03).
    const stated = !!ctx.recipeParts?.includes('summary-2001')
    const comments = field('Comments', null, 'reviewer')
    return {
      blocks: [
        heading('Notes', 3),
        { kind: 'list', items: [...NOTES_2001], ordered: true, source: 'fixed' },
        ...(stated ? [] : paragraph([tests])),
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
        ...(tests.text || stated ? [] : [`Note 2 for this proposal (needs ${andList(tests.missing)})`]),
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
    // Mapped reserves (`retained` masks: wildlife tree patches / retention) inside the blocks, whatever their system.
    const reserved = blocks.filter((block) => reservesOf(block) > 0)
    if (reserved.length)
      out.push(
        fillSentence(
          'design-reserves',
          reserved.length > 1
            ? 'Mapped wildlife tree patches and reserves keep about {area} ha standing within {blocks} ({each}); they are left out of the proposed alteration.'
            : 'Mapped wildlife tree patches and reserves keep about {area} ha standing within {blocks}; they are left out of the proposed alteration.',
          {
            area: ha(reserved.reduce((sum, block) => sum + reservesOf(block), 0)),
            blocks: blockList(reserved.map((block) => block.name)),
            each: reserved.map((block) => `${ha(reservesOf(block))} ha in Block ${blockId(block.name)}`).join(', '),
          },
          'scene',
        ),
      )
    const none = blocks.filter(
      (block) => block.retentionPercent === null && !block.partialCut && reservesOf(block) === 0,
    )
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
  const netting = nettingSentence(ctx)
  if (netting) out.push(netting)
  return out
}

/**
 * Why private land and rock leave the landform (05's design comments), said only when the format's arithmetic nets
 * them out and a view's class pass finds some: the methods' own sentences, and what follows for alterations there.
 */
export function nettingSentence(ctx: ReportContext): Sentence | null {
  const deduct = ctx.document.format.rule.deduct
  const found = (key: 'privateLand' | 'rock') =>
    deduct.includes(key) && ctx.facts.viewpoints.some((vp) => (vp.areas?.[key] ?? 0) > 0)
  const privateLand = found('privateLand')
  const rock = found('rock')
  if (!privateLand && !rock) return null
  const text = privateLand
    ? `${PRIVATE_LAND_NETTED}${rock ? ` ${ROCK_NETTED}` : ''} Alterations on private land are therefore not counted in the figures.`
    : 'Rock and other non-vegetated ground inside the landform is left out of the percent alteration’s denominator.'
  return fillSentence('design-netting', text, {}, 'run')
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
    // 01's form asks, after the techniques, which objective the design meets: the reviewer's mark, never the run's.
    const strategies = ctx.recipeParts?.includes('visual-design')
    return {
      blocks: [
        heading('Design techniques', 3),
        ...paragraph(sentences),
        fields([techniques]),
        ...(strategies
          ? [
              {
                kind: 'choices',
                label:
                  'Which VQO definition would the proposed alteration meet from all the selected viewpoints, taking into account visual design strategies and tactics?',
                options: [...CLASS_ORDER],
                chosen: null,
                source: 'reviewer',
              } satisfies ReportBlock,
            ]
          : []),
      ],
      toComplete: [
        'Design techniques used, or reasons a technique could not be employed',
        ...sentences.filter((s) => !s.text).map((s) => `Design techniques: ${s.id} (needs ${andList(s.missing)})`),
        ...(strategies ? ['The VQO met taking into account visual design strategies and tactics'] : []),
      ],
    }
  },
}

// ------------------------------------------------------------------ 03, 05: design as yes / no questions

/**
 * The 2001 summary form's section 2 (03 p2, 05 p3): five yes / no design questions and a line for design deficiencies.
 * The first three answer from step 4's design ratings at the assessment station (good is Yes, poor is No, moderate is
 * the reviewer's); islands answer Yes when the scene maps a retention patch inside a block, else they are the
 * reviewer's; poor design in the unit is always the reviewer's.
 */
const designQuestions2001: ReportPart = {
  id: 'design-questions-2001',
  title: 'Assessing visual design',
  sources: ['03', '05'],
  build: (ctx) => {
    const rating = (id: DesignElementId): boolean | null => {
      const value = ctx.assessment?.design[id]?.rating ?? null
      return value === -1 ? true : value === 1 ? false : null
    }
    // Yes when the scene maps a retention patch (a wildlife tree patch or reserve) in a block, whatever its system.
    const islands = ctx.blocks.some((block) => (block.islands ?? 0) > 0 || reservesOf(block) > 0) ? true : null
    const questions: Array<{ short: string; label: string; chosen: boolean | null; source: 'reviewer' | 'scene' }> = [
      {
        short: 'major lines of force',
        label:
          'Have major lines of force been identified and used to develop the size and shape of the proposed operation? (If Yes, attach the visual force analysis.)',
        chosen: rating('force-lines'),
        source: 'reviewer',
      },
      {
        short: 'borrowing from the natural character',
        label: 'Has the proposed operation borrowed from the natural character of the landscape?',
        chosen: rating('natural-character'),
        source: 'reviewer',
      },
      {
        short: 'edge treatments',
        label:
          'Have edge treatments been incorporated into the design of the proposed operation (feathered edges, irregular cutblock design, etc.)?',
        chosen: rating('edge-treatment'),
        source: 'reviewer',
      },
      {
        short: 'islands or patches of trees',
        label:
          'Have “islands,” or patches of trees, been maintained to mitigate visual impacts and other resource management objectives?',
        chosen: islands,
        source: islands ? 'scene' : 'reviewer',
      },
      {
        short: 'existing alterations of poor design in the unit',
        label: 'Are there any existing human-made alterations visible in the unit that exhibit poor design?',
        chosen: null,
        source: 'reviewer',
      },
    ]
    return {
      blocks: [
        heading('2. Assessing visual design'),
        ...questions.map(
          (q): ReportBlock => ({
            kind: 'choices',
            label: q.label,
            options: ['Yes', 'No'],
            chosen: yesNo(q.chosen),
            source: q.source,
          }),
        ),
        fields([field('If Yes, describe the design deficiencies', null, 'reviewer')]),
      ],
      toComplete: questions.filter((q) => q.chosen === null).map((q) => q.short),
    }
  },
}

export const DISTRICT_PARTS: readonly ReportPart[] = [
  designQuestions2001,
  districtSummaryForm,
  formHeader2001,
  blockAreas2001,
  criteriaRating2001,
  summary2001Five,
  summaryBoxed,
  certification2001,
  notes2001,
  designTechniques2001,
]
