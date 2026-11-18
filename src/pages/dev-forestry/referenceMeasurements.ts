import { parseComparisons, type ReferenceComparison } from './referenceComparison'

export const referenceLabels = {
  harvestSystem: 'Unit harvest system',
  volumeRemoved: 'Volume removed (%)',
  treesRemoved: 'Trees removed (%)',
  residualStems: 'Residual stems per hectare',
  residualHeight: 'Residual height (m)',
  boundaryType: 'Boundary type',
  boundaryDate: 'Boundary evidence date',
  stationElevation: 'Source station elevation (m)',
  lensMm: 'Source lens (mm)',
  cropFactor: 'Sensor crop factor',
  bearingRange: 'Source bearing range',
  coordinateSource: 'Coordinate source',
  bearingSource: 'Bearing source',
  elevationSource: 'Elevation source',
  confidence: 'Source confidence',
  longitude: 'Camera longitude',
  latitude: 'Camera latitude',
  eyeAltitude: 'Eye elevation (m)',
  heading: 'Heading (degrees)',
  pitch: 'Pitch (degrees)',
  roll: 'Roll (degrees)',
  cropLeft: 'Crop left (px)',
  cropTop: 'Crop top (px)',
  cropWidth: 'Crop width (px)',
  cropHeight: 'Crop height (px)',
  controls: 'Mapped control points',
  trace: 'Image trace',
  skylineTrace: 'Marked skyline points',
  ridgeGap: 'Ridge-gap tolerance (m)',
  acceptedCamera: 'Confirmed sheet camera and controls',
  referenceImage: 'Reference image / field record',
  numeratorMode: 'Calculate numerator from',
  denominatorMode: 'Calculate denominator from',
  viewpointName: 'Viewpoint name',
  block: 'Block / assessment subject',
  blocksVisible: 'Visible blocks',
  studyDate: 'Study date',
  treatment: 'Case treatment description',
  treatmentPercentRemoved: 'Treatment removal as reported (%)',
  objective: 'Study objective',
  vqo: 'Landform objective',
  landformCode: 'Source landform code',
  initialVQO: 'Initial VQO entry',
  designScores: 'Design scores',
  ocularClassOnScale: 'Ocular class on source scale',
  designAdjustY: 'Design adjustment Y',
  adjustedPercent: 'Adjusted alteration (%)',
  visibility: 'Visibility',
  viewpointImportance: 'Viewpoint importance',
  scaleOfAlteration: 'Scale of alteration',
  alteredLandformCategory: 'Altered landform category',
  distanceRating: 'Distance rating',
  visualDesignRating: 'Visual design rating',
  design: 'Design and character',
  sizeAndScale: 'Size and scale',
  ratingNote: 'Rating note',
  rationale: 'Assessment rationale',
  pieces: 'Individual area measurements',
  notGreenedUpCm2: 'Area below green-up (cm²)',
  existingNote: 'Existing alteration note',
  table4Percent: 'Table 4 alteration (%)',
  totalPercent: 'Printed total (%)',
  recomputedPercent: 'Case arithmetic (%)',
  printedRecomputedByCatalogue: 'Catalogue arithmetic note',
  proposedPrintedPercent: 'Printed proposed share (%)',
  nonVegPrintedPercent: 'Printed existing share (%)',
  levelOfImpact: 'Level of impact',
  forceLines: 'Response to visual force lines',
  borrowsCharacter: 'Borrows landscape character',
  edgeTreatments: 'Edge treatment',
  islands: 'Retention islands',
  distance: 'Viewing distance',
  position: 'Landform position',
  overallDesign: 'Overall design',
  finalDetermination: 'Final determination',
  referenceConclusion: 'Study conclusion',
  referenceSummary: 'Case summary',
  projection: 'Image projection',
  span: 'Panorama span (degrees)',
  crop: 'Source crop',
  fov: 'Lens / field of view',
  pose: 'Camera position and orientation',
  cameraEvidence: 'Camera source and held-out errors',
  proposal: 'Study-date proposal boundary',
  treatmentUnits: 'Mapped treatment units and reported units',
  retention: 'Retention and green-up evidence',
  outline: 'Visible face and traced outline',
  exclusions: 'Denominator exclusions and evidence',
  provenance: 'Reviewer evidence and rationale',

  viewpoint: 'Source viewpoint',
  landform: 'Source landform / sub-landform',
  source: 'Source document',
  page: 'Source page',
  sheet: 'Sheet',
  method: 'Method',
  formula: 'Source formula',
  unit: 'Area unit',
  numerator: 'Numerator',
  proposed: 'Proposed alteration area',
  existing: 'Existing alteration area',
  existingIncluded: 'Existing alteration included',
  proposedPercent: 'Proposed alteration (%)',
  existingPercent: 'Existing alteration (%)',
  denominator: 'Denominator used',
  gross: 'Gross landform area',
  deductionKind: 'Deduction',
  deduction: 'Deducted area',
  net: 'Net landform area',
  percent: 'Reported alteration (%)',
  netComparison: 'Case calculation on net area (%)',
  rating: 'Reported rating',
  rule: 'Rating basis',
  ocular: 'Ocular assessment',
  note: 'Transcription notes',
} as const
export type ReferenceField = keyof typeof referenceLabels
export type ReferenceValues = Partial<Record<ReferenceField, string>>
export type ReferenceRow = {
  id: string
  caseId: string
  viewId: string
  landformId: string
  printed: ReferenceValues
  corrections: ReferenceValues
  /** Retain alternative entries while the reviewer uses the transcription. */
  useSource?: ReferenceField[]
  origins?: ReferenceValues
  comparisons?: ReferenceComparison[]
}

type NamedRecord = { id: string; name: string }
export type ReferenceContext = { views: NamedRecord[]; landforms: NamedRecord[]; attachments: string[] }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const scalar = (v: unknown) => (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? String(v) : '')
const MAX_ROWS = 2000
export const MAX_CASE_BYTES = 4 * 1024 * 1024
export async function readReferenceCase(file: Blob): Promise<unknown> {
  if (file.size > MAX_CASE_BYTES) throw new Error('The case JSON exceeds 4 MB.')
  return JSON.parse(await file.text())
}
/**
 * A row's values. A field this version does not know, or one that does not read (not text, or too long), is left
 * out and named in `dropped` rather than refusing the row: one field from a newer file must not lose the workspace.
 */
export function readValues(v: unknown, dropped?: string[]): ReferenceValues {
  if (!record(v)) throw new Error('Invalid reference measurement fields.')
  const kept: ReferenceValues = {}
  for (const [key, value] of Object.entries(v)) {
    if (
      Object.prototype.hasOwnProperty.call(referenceLabels, key) &&
      typeof value === 'string' &&
      value.length <= (key === 'controls' || key === 'acceptedCamera' ? 64000 : 12000)
    )
      kept[key as ReferenceField] = value
    else dropped?.push(key)
  }
  return kept
}
/** `dropped` collects the names of fields left out (`readValues`), once each. */
export function parseReferenceRows(value: unknown, dropped?: string[]): ReferenceRow[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_ROWS) throw new Error('Invalid reference measurement table.')
  const ids = new Set<string>()
  return value.map((v: unknown) => {
    if (
      !record(v) ||
      typeof v.id !== 'string' ||
      !v.id ||
      ids.has(v.id) ||
      typeof v.caseId !== 'string' ||
      typeof v.viewId !== 'string' ||
      typeof v.landformId !== 'string'
    )
      throw new Error('Invalid or duplicate reference measurement.')
    if (v.useSource !== undefined && (!Array.isArray(v.useSource) || v.useSource.some((k) => typeof k !== 'string')))
      throw new Error('Invalid reference field selection.')
    ids.add(v.id)
    const known = (k: string) => Object.prototype.hasOwnProperty.call(referenceLabels, k)
    const useSource = (v.useSource as string[] | undefined)?.filter(known) as ReferenceField[] | undefined
    return {
      id: v.id,
      caseId: v.caseId,
      viewId: v.viewId,
      landformId: v.landformId,
      printed: readValues(v.printed, dropped),
      corrections: readValues(v.corrections, dropped),
      ...(v.origins !== undefined ? { origins: readValues(v.origins, dropped) } : {}),
      ...(useSource ? { useSource: [...new Set(useSource)] } : {}),
      ...(v.comparisons !== undefined ? { comparisons: parseComparisons(v.comparisons) } : {}),
    }
  })
}
function uniqueId(records: NamedRecord[], label: string, view = false) {
  const matches = records.filter(
    (r) => label && (r.id === label || r.name === label || (view && r.name.split(' · ')[0] === label)),
  )
  return matches.length === 1 ? matches[0].id : ''
}

/**
 * Where a row was printed, read only from the case file: the row's own `page`, else the case's
 * `blockPages` (a Table 5 row, by its block) or `pages.table5`; for other rows a sheet
 * "Appendix A<n>" printed on page n + `appendixPageOffset`, else `pages` by viewpoint id.
 * The source is the case's `originals` entry for the viewpoint when it is attached, else the
 * one attachment named for the case's `doc`, narrowed by the row's sheet name and page.
 * Nothing about any particular case is kept in code.
 */
export function caseCitation(
  raw: Record<string, unknown>,
  r: Record<string, unknown>,
  detail: boolean,
  attachments: string[],
): { source: string; page: string } {
  const viewpoint = scalar(r.viewpoint)
  const sheet = scalar(r.sheet)
  const pages = record(raw.pages) ? raw.pages : {}
  const blockPages = record(raw.blockPages) ? raw.blockPages : {}
  const appendix = /^Appendix A(\d+)$/.exec(sheet)
  const offset = Number(raw.appendixPageOffset)
  const page = detail
    ? scalar(blockPages[scalar(r.block)]) || scalar(pages.table5)
    : appendix && raw.appendixPageOffset !== undefined && Number.isFinite(offset)
      ? String(Number(appendix[1]) + offset)
      : scalar(pages[viewpoint])
  const named = record(raw.originals) ? scalar(raw.originals[viewpoint]) : ''
  if (named && attachments.includes(named)) return { source: named, page }
  const doc = scalar(raw.doc)
  let originals = doc ? attachments.filter((n) => n.startsWith(doc + ' ') && /\.(pdf|jpe?g|png)$/i.test(n)) : []
  const narrow = (keep: (name: string) => boolean) => {
    const kept = originals.filter(keep)
    if (kept.length) originals = kept
  }
  if (originals.length > 1 && sheet) narrow((n) => n.includes(sheet))
  if (originals.length > 1 && /^\d+$/.test(page)) narrow((n) => n.endsWith(`page ${page.padStart(2, '0')}.jpg`))
  return { source: originals.length === 1 ? originals[0] : '', page }
}

export function importReferenceCase(raw: unknown, ctx: ReferenceContext): ReferenceRow[] {
  if (
    !record(raw) ||
    !Array.isArray(raw.reference) ||
    typeof raw.id !== 'string' ||
    !raw.id ||
    raw.reference.length > MAX_ROWS
  )
    throw new Error('Expected a case ID and a reference row list.')
  const caseId = raw.id
  const details = raw.referenceDetail_table5 ?? []
  if (!Array.isArray(details) || details.length + raw.reference.length > MAX_ROWS)
    throw new Error('Invalid Table 5 assessments.')
  const entries = [...raw.reference, ...details]
  const measurementCount = raw.reference.length
  const rows = entries.map((r: unknown, index: number) => {
    const detail = index >= measurementCount
    if (!record(r) || typeof r.viewpoint !== 'string') throw new Error(`Invalid reference row ${index + 1}.`)
    const citation = caseCitation(raw, r, detail, ctx.attachments)
    const printed: ReferenceValues = {}
    function put(key: ReferenceField, v: unknown) {
      const text = scalar(v)
      if (text) printed[key] = text
    }
    for (const key of Object.keys(referenceLabels) as ReferenceField[]) {
      const value = r[key]
      if (value != null && (Array.isArray(value) || record(value))) put(key, JSON.stringify(value, null, 2))
      else put(key, value)
    }
    const vp = Array.isArray(raw.viewpoints) ? raw.viewpoints.find((v) => record(v) && v.id === r.viewpoint) : null
    if (record(vp)) {
      put('viewpointName', r.viewpointName ?? vp.name)
      put('longitude', vp.lng)
      put('latitude', vp.lat)
      put('heading', vp.bearing)
      put('stationElevation', vp.elevation)
      put('lensMm', vp.lensMm)
      put('cropFactor', vp.cropFactor)
      if (Array.isArray(vp.bearingRange)) put('bearingRange', vp.bearingRange.join(' to '))
      put('coordinateSource', vp.coordSource)
      put('bearingSource', vp.bearingSource)
      put('elevationSource', vp.elevationSource)
      put('confidence', vp.confidence)
    }
    put('studyDate', raw.viaDate)
    put('treatment', raw.treatment)
    put('objective', raw.objective)
    put('referenceConclusion', raw.referenceConclusion)
    put('referenceSummary', raw.referenceSummary)
    if (detail) {
      put('sheet', r.sheet ?? 'Table 5')
      put('method', r.method ?? 'Detailed assessment by block or landform')
      put('finalDetermination', r.finalDetermination ?? r.final)
    }
    put('source', r.source ?? (citation.source || raw.title))
    put('page', r.page ?? citation.page)
    put('formula', r.printedFormula)
    put('proposed', r.proposedCm2 ?? r.proposedPx)
    put('existing', r.existingNonVegCm2 ?? r.nonVegPx ?? r.existingNonVegPixels)
    put(
      'existingIncluded',
      typeof r.existingIncluded === 'boolean' ? (r.existingIncluded ? 'Yes' : 'No') : r.existingIncluded,
    )
    const quotedRanges = /Thresholds quoted: (.+?%)\.(?: |$)/.exec(scalar(raw.method))?.[1]
    put('rule', r.ratingBasis ?? r.printedCriterion ?? quotedRanges)
    put('gross', r.grossVluCm2 ?? r.landformPx ?? (/\bgross\b/i.test(scalar(r.landform)) ? r.denominator : null))
    put('net', r.netVluCm2)
    put('netComparison', r.percentOfNetVlu)
    for (const [key, label] of [
      ['rockCm2', 'Rock'],
      ['rockPrivateCm2', 'Rock and private land'],
      ['privateRockCm2', 'Private land and rock'],
      ['privateLandPx', 'Private land'],
    ]) {
      if (r[key] != null) {
        put('deductionKind', label)
        put('deduction', r[key])
        break
      }
    }
    return {
      id: detail ? `${caseId}/table5/${index - measurementCount + 1}` : `${caseId}/reference/${index + 1}`,
      caseId,
      viewId: uniqueId(ctx.views, r.viewpoint, true),
      landformId: uniqueId(ctx.landforms, scalar(r.landform)),
      printed,
      corrections: {},
    }
  })
  return parseReferenceRows(rows)
}

export function mergeReferences(saved: ReferenceRow[], imported: ReferenceRow[]) {
  const incoming = new Map(imported.map((row) => [row.id, row]))
  const preserved = saved.map((row) => {
    const match = incoming.get(row.id)
    incoming.delete(row.id)
    // Never overlay a different sheet when a later case reorders its rows.
    if (
      !match ||
      match.printed.viewpoint !== row.printed.viewpoint ||
      match.printed.landform !== row.printed.landform ||
      match.printed.sheet !== row.printed.sheet
    )
      return row
    return { ...row, printed: { ...match.printed, ...row.printed } }
  })
  return parseReferenceRows([...preserved, ...incoming.values()])
}

export function chosenValues(row: ReferenceRow): ReferenceValues {
  const selected = { ...row.printed }
  for (const key of Object.keys(row.corrections) as ReferenceField[]) {
    if (!row.useSource?.includes(key)) selected[key] = row.corrections[key]
  }
  return selected
}

export function amount(value: string | undefined) {
  if (!value || !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
export function referenceArithmetic(values: ReferenceValues) {
  const proposed = amount(values.proposed),
    existing = amount(values.existing)
  const numerator =
    values.numeratorMode === 'Proposed only'
      ? proposed
      : values.numeratorMode === 'Proposed and existing'
        ? proposed !== null && existing !== null
          ? proposed + existing
          : null
        : amount(values.numerator)
  const ratio = (area: number | null) => {
    if (numerator === null || area === null || area <= 0) return null
    const pct = (numerator / area) * 100
    return Number.isFinite(pct) ? pct : null
  }
  const gross = amount(values.gross),
    deduction = amount(values.deduction)
  const netArea = gross !== null && deduction !== null && gross >= deduction ? gross - deduction : null
  const denominator =
    values.denominatorMode === 'Gross area'
      ? gross
      : values.denominatorMode === 'Gross less deduction'
        ? netArea
        : values.denominatorMode === 'Listed net area'
          ? amount(values.net)
          : amount(values.denominator)
  const percentage = ratio(denominator)
  const printed = amount(values.percent)
  const net = amount(values.net)
  const proposedPct = amount(values.proposedPercent),
    existingPct = amount(values.existingPercent)
  return {
    numerator,
    denominator,
    percentage,
    difference: percentage !== null && printed !== null ? percentage - printed : null,
    netArea,
    netPercentage: ratio(netArea),
    listedNetPercentage: ratio(net),
    componentArea:
      proposed !== null && existing !== null && values.existingIncluded !== 'No' ? proposed + existing : null,
    componentPercentage:
      proposedPct !== null && existingPct !== null && values.existingIncluded !== 'No'
        ? proposedPct + existingPct
        : null,
  }
}

// Only classify a value when the transcription gives explicit, inclusive percentage ranges.
// Gaps, shared boundaries, a named table without its cutoffs and ocular judgements stay unrated.
export function referenceClass(rule: string | undefined, percentage: number | null) {
  if (!rule || percentage === null) return null
  const upper =
    /^(?:Worksheet row \d+:\s*)?P\s*=\s*0%,\s*R\s*<\s*([\d.]+)%,\s*PR\s*<\s*([\d.]+)%,\s*M\s*<\s*([\d.]+)%,\s*MM\s*<\s*([\d.]+)%\.?$/.exec(
      rule,
    )
  if (upper) {
    const limits = upper.slice(1).map(Number)
    if (percentage < 0 || limits.some((n, i) => !Number.isFinite(n) || n <= (limits[i - 1] ?? 0))) return null
    if (percentage === 0) return 'P'
    return ['R', 'PR', 'M', 'MM'][limits.findIndex((limit) => percentage < limit)] ?? null
  }
  const ranges = rule.split(/,\s*/).map((part) => /^(P|R|PR|M|MM) (\d+(?:\.\d+)?)[–-](\d+(?:\.\d+)?)%$/.exec(part))
  if (ranges.some((range) => !range)) return null
  const matches = ranges.filter((range) => range && percentage >= Number(range[2]) && percentage <= Number(range[3]))
  return matches.length === 1 ? matches[0]![1] : null
}
