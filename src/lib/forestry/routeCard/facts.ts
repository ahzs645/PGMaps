/**
 * The facts the Other Considerations paragraphs are written from: what each route card row found,
 * and the figures a paragraph needs beyond it (the block's BEC subzone, how much of it a draft OGMA
 * covers, which side a TAP polygon lies on, how far the access road runs through a winter range).
 *
 * The wording lives in JSON (`catalogue/considerations/*.json`, rendered by document-kit), so this
 * module only measures and names: it hands the recipe plain values, each one either read, measured,
 * looked up in a cited table (`catalogue/biodiversity.json`) or given by the reviewer, and never
 * guesses one it does not have. A value it lacks is left out, so the sentence that needs it is
 * dropped or printed as a placeholder to complete. No DOM or network access.
 */
import biodiversityJson from './catalogue/biodiversity.json'
import {
  distanceToSubject,
  lengthInside,
  overlapArea,
  polygonsArea,
  prepareSubject,
  sideOfSubject,
  type Planar,
  type PreparedSubject,
  type Ring,
} from './geometry'
import type { RouteCardMatch } from './query'
import { printRow, type RouteCardEntry, type RouteCardRowState, type RouteCardSubject } from './results'
import { ROUTE_CARD_ROWS, type ConsiderationId, type RouteCardRow } from './rows'

/** What the reviewer writes once and the paragraphs read. All optional: a missing one is a placeholder. */
export type ConsiderationInputs = {
  /** "The licence area is currently meeting this old forest objective through spatially identified draft OGMAs." */
  oldForestStatement?: string
  /** The current share of the block's patch class in its NDT, as the district's patch analysis gives it. */
  patchCurrentPercent?: string
  /** The future target for that class, as the patch analysis gives it. */
  patchFutureTarget?: string
  /** The reviewer's own decision on patch size ("Patch is not a constraint at the time of planning."). */
  patchDecision?: string
  /** Anything to add to the TAP paragraph ("now being developed as part of an adjacent block"). */
  tapNote?: string
}

export type RowFact = {
  /** Y, W (within), N, notRead or notPublic. */
  answer: 'Y' | 'W' | 'N' | 'notRead' | 'notPublic'
  yes: boolean
  near: boolean
  /** The row was answered, by a read or an entry. */
  known: boolean
  entered: boolean
  /** PGMaps' estimate, not the source's own answer (`birdRank.ts`). */
  estimated: boolean
  /** What a Y names, one item each ("4", "Mountain Pine Beetle"); for an entry, its text split on commas. */
  names: string[]
  count: number
}

export type SideFact = { name: string; side: string; touching: boolean; distanceMeters: number }

export type ConsiderationFacts = {
  subject: { name: string; kind: 'block' | 'road'; noun: string; areaHa: number | null }
  rows: Record<string, RowFact>
  oldForest: {
    ndts: Array<{
      code: string
      number: string
      subzone: string | null
      /** "NDT 1 (ESSFwk2)". */
      label: string
      olderThanYears: number | null
      percent: number | null
    }>
    landscapeUnit: string | null
    beo: string | null
    /** Percent of the block a draft (non-legal) OGMA covers; null when the layer was not read. */
    ogmaPercent: number | null
    /** Draft OGMAs that touch the boundary without covering any of it. */
    ogmaTouching: SideFact[]
    statement: string | null
    source: string
  }
  patch: {
    areaHa: number | null
    /** Openings within 100 m that would join the block's patch, with their areas. */
    joined: Array<{ name: string; areaHa: number }>
    ndt: string | null
    className: string | null
    /** "a" or "an", for the class name. */
    article: string
    bin: string | null
    /** The guidebook's target for the class; null when it sets none (x-large) or the table lacks the NDT. */
    target: string | null
    currentPercent: string | null
    futureTarget: string | null
    decision: string | null
    source: string | null
  }
  tap: {
    remnant: Array<SideFact & { roadInsideMeters: number | null }>
    ogmas: SideFact[]
    /** The sides the draft OGMAs border, each once. */
    ogmaSides: string[]
    note: string | null
  }
  uwr: {
    units: Array<{
      number: string
      unit: string
      species: string
      harvestCode: string | null
      percentOfBlock: number
      touching: boolean
      roadInsideMeters: number | null
    }>
    roadCrosses: string[]
  }
  fisher: {
    /** The harvest impact classes the route card lists, worst first, quoted as the notes write them ("'warning'"). */
    classes: string[]
  }
  birds: { rankings: string[] }
  oldForestLabels: { ndts: string[] }
  visuals: { text: string; drafted: boolean } | null
  /** The reviewer's own paragraphs, by `factKey` of the consideration id. */
  own: Record<string, string>
}

/** A row id as a tag can read it: `migratory-bird-rankings` → `migratoryBirdRankings`. */
export const factKey = (id: string) => id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())

const splitNames = (text: string) =>
  text
    .split(/,\s*(?=')|\n/)
    .map((part) => part.trim().replace(/^'(.*)'$/, '$1'))
    .filter(Boolean)

function rowFact(
  row: RouteCardRow,
  state: RouteCardRowState | undefined,
  entry: RouteCardEntry | undefined,
  kind: RouteCardSubject['kind'],
): RowFact {
  const printed = printRow(row, state, entry, kind)
  const answer: RowFact['answer'] =
    printed.value === 'Y'
      ? 'Y'
      : printed.value === 'N'
        ? 'N'
        : printed.value.startsWith('Within')
          ? 'W'
          : printed.value === 'Not public'
            ? 'notPublic'
            : 'notRead'
  const names =
    answer !== 'Y'
      ? []
      : printed.by === 'entered'
        ? splitNames(entry?.names ?? '')
        : state?.status === 'read'
          ? state.finding.names
          : []
  return {
    answer,
    yes: answer === 'Y',
    near: answer === 'W',
    known: answer === 'Y' || answer === 'W' || answer === 'N',
    entered: printed.by === 'entered',
    estimated: printed.by === 'estimated',
    names,
    count: names.length,
  }
}

const matchesOf = (state: RouteCardRowState | undefined): RouteCardMatch[] =>
  state?.status === 'read' ? state.finding.matches : []

/** A row's features near the subject and those its access road runs through, each once. */
function matchesWithAccess(state: RouteCardRowState | undefined): RouteCardMatch[] {
  if (state?.status !== 'read') return []
  const near = state.finding.matches
  const seen = new Set(near.map((match) => match.shape))
  const along = (state.finding.alongAccess ?? []).filter(
    (match) =>
      !seen.has(match.shape) && !near.some((other) => other.name === match.name && other.props === match.props),
  )
  return [...near, ...along.map((match) => ({ ...match, distanceMeters: Infinity }))]
}

/** Within this many metres a draft OGMA "borders" the block: boundaries drawn at different scales rarely meet exactly. */
export const BORDERS_METERS = 5

const polygonsOf = (shape: Planar): Ring[][] => (shape.kind === 'polygon' ? shape.polygons : [])

const round = (value: number, places = 1) => Math.round(value * 10 ** places) / 10 ** places

const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : null

type Biodiversity = {
  oldSeral: Array<{ ndt: string; zone: string; beo: string; olderThanYears: number; percent: number; source: string }>
  patchSize: Array<{
    ndts: string[]
    bins: Array<{ name: string; fromHa: number; toHa: number; targetPercent: string | null }>
    source: string
  }>
}
const BIODIVERSITY = biodiversityJson as Biodiversity

/** The old-seral target for an NDT, zone and BEO, when the table holds it. */
export function oldSeralTarget(ndt: string, zone: string | null, beo: string | null) {
  if (!beo) return null
  return (
    BIODIVERSITY.oldSeral.find(
      (entry) =>
        entry.ndt === ndt &&
        entry.beo.toLowerCase() === beo.toLowerCase() &&
        (entry.zone === '*' || entry.zone === zone),
    ) ?? null
  )
}

/** The patch-size class an area falls in for an NDT, when the table holds the NDT. */
export function patchClass(ndt: string | null, areaHa: number) {
  if (!ndt) return null
  const table = BIODIVERSITY.patchSize.find((entry) => entry.ndts.includes(ndt))
  if (!table) return null
  const bin = table.bins.find((entry) => areaHa >= entry.fromHa && areaHa < entry.toHa)
  if (!bin) return null
  return {
    ...bin,
    source: table.source,
    label: bin.toHa >= 1_000_000 ? `>${bin.fromHa} ha` : `${bin.fromHa}–${bin.toHa} ha`,
  }
}

/** Distance under which an opening joins the block's patch, metres. */
export const PATCH_JOIN_METERS = 100

export type FactsInput = {
  subject: RouteCardSubject
  states: Readonly<Record<string, RouteCardRowState>>
  entries?: Readonly<Record<string, RouteCardEntry>>
  /** The block's access road, for crossings; null when the scene has none. */
  access?: Planar | null
  /** Other planned blocks in the scene, which join the patch when within 100 m. */
  planned?: ReadonlyArray<{ name: string; shape: Planar }>
  visuals?: { text: string; drafted: boolean } | null
  own?: Partial<Record<ConsiderationId, string>>
  inputs?: ConsiderationInputs
  rows?: readonly RouteCardRow[]
}

export function considerationFacts(input: FactsInput): ConsiderationFacts {
  const catalogue = input.rows ?? ROUTE_CARD_ROWS
  const entries = input.entries ?? {}
  const inputs = input.inputs ?? {}
  const subject: PreparedSubject = prepareSubject(input.subject.shape)
  const blockPolygons = polygonsOf(input.subject.shape)
  const blockArea = blockPolygons.length ? polygonsArea(blockPolygons) : null
  const rows: Record<string, RowFact> = {}
  for (const row of catalogue)
    rows[factKey(row.id)] = rowFact(row, input.states[row.id], entries[row.id], input.subject.kind)
  const state = (id: string) => input.states[id]
  const percentOfBlock = (shape: Planar) =>
    blockArea ? (overlapArea(blockPolygons, polygonsOf(shape)) / blockArea) * 100 : 0
  const sideFact = (match: RouteCardMatch, name = match.name): SideFact => ({
    name,
    side: sideOfSubject(subject, match.shape),
    touching: match.distanceMeters === 0,
    distanceMeters: Number.isFinite(match.distanceMeters) ? round(match.distanceMeters, 0) : -1,
  })
  const roadInside = (shape: Planar) =>
    input.access?.kind === 'line' && shape.kind === 'polygon'
      ? round(lengthInside(input.access.lines, shape.polygons), 0)
      : null

  // Old forest: NDTs and their main subzone, LU and BEO, draft OGMAs.
  const becMatches = matchesOf(state('bec-subzone')).filter((match) => match.distanceMeters === 0)
  const luMatch = matchesOf(state('landscape-unit')).find((match) => match.distanceMeters === 0) ?? null
  const beo = luMatch ? text(luMatch.props.BIODIVERSITY_EMPHASIS_OPTION) : null
  const ndtCodes = rows[factKey('ndt')]?.names ?? []
  const ndts = ndtCodes.map((code) => {
    // The subzone that covers most of the block within this NDT.
    const within = becMatches
      .filter((match) => `NDT${text(match.props.NATURAL_DISTURBANCE)?.replace(/^NDT/, '')}` === code)
      .map((match) => ({ match, share: blockArea ? percentOfBlock(match.shape) : 0 }))
      .sort((a, b) => b.share - a.share)
    const top = within[0]?.match ?? null
    const zone = top ? text(top.props.ZONE) : null
    const subzone = top ? [zone, text(top.props.SUBZONE), text(top.props.VARIANT)].filter(Boolean).join('') : null
    const target = oldSeralTarget(code, zone, beo)
    const number = code.replace(/^NDT/, '')
    return {
      code,
      number,
      subzone,
      label: `NDT ${number}${subzone ? ` (${subzone})` : ''}`,
      olderThanYears: target?.olderThanYears ?? null,
      percent: target?.percent ?? null,
    }
  })
  const ogmaState = state('non-legal-ogma')
  const ogmaMatches = matchesOf(ogmaState)
  const ogmaPercent =
    ogmaState?.status === 'read' && blockArea
      ? round(
          ogmaMatches
            .filter((match) => match.distanceMeters === 0)
            .reduce((sum, match) => sum + percentOfBlock(match.shape), 0),
        )
      : null
  const cofaMatches = matchesOf(state('cofa-non-legal-ogma'))
  const ogmaTouching = cofaMatches
    .filter((match) => match.distanceMeters <= BORDERS_METERS && percentOfBlock(match.shape) < 0.05)
    .map((match) => sideFact(match, text(match.props.NON_LEGAL_OGMA_PROVID) ?? match.name))

  // Patch size: the block and openings within 100 m.
  const ndt = ndtCodes[0] ?? null
  const joined = matchesOf(state('opening-results'))
    .filter((match) => match.distanceMeters <= PATCH_JOIN_METERS && percentOfBlock(match.shape) < 50)
    .map((match) => ({
      name: text(match.props.OPENING_ID) ?? match.name,
      areaHa: round(polygonsArea(polygonsOf(match.shape)) / 10_000),
    }))
  for (const other of input.planned ?? []) {
    if (other.shape.kind !== 'polygon') continue
    if (distanceToSubject(subject, other.shape, PATCH_JOIN_METERS) <= PATCH_JOIN_METERS)
      joined.push({ name: other.name, areaHa: round(polygonsArea(other.shape.polygons) / 10_000) })
  }
  const patchArea =
    blockArea === null ? null : round(blockArea / 10_000 + joined.reduce((sum, item) => sum + item.areaHa, 0))
  const patch = patchArea === null ? null : patchClass(ndt, patchArea)

  // TAP remnant polygons and draft OGMAs beside them.
  const remnant = matchesWithAccess(state('tap-remnant')).map((match) => ({
    ...sideFact(match, text(match.props.REMNANT_OLD_ECOSYS_ID) ?? match.name),
    roadInsideMeters: roadInside(match.shape),
  }))

  // Ungulate winter range units in or beside the block, and the road through them.
  const uwrUnits = matchesWithAccess(state('ungulate-winter-range'))
    .filter((match) => match.distanceMeters === 0 || (roadInside(match.shape) ?? 0) > 0)
    .map((match) => ({
      number: text(match.props.UWR_NUMBER) ?? '',
      unit: text(match.props.UWR_UNIT_NUMBER) ?? '',
      species: text(match.props.SPECIES_1) ?? '',
      harvestCode: text(match.props.TIMBER_HARVEST_CODE),
      percentOfBlock: round(percentOfBlock(match.shape)),
      touching: match.distanceMeters === 0,
      roadInsideMeters: roadInside(match.shape),
    }))

  const own = Object.fromEntries(
    Object.entries(input.own ?? {})
      .filter(([, value]) => typeof value === 'string' && value.trim())
      .map(([id, value]) => [factKey(id), value.trim()]),
  )
  const impact = rows[factKey('fisher-harvest-impact')]?.names ?? []
  const fisherClasses = [
    impact.some((name) => /^warning/i.test(name)) ? "'warning'" : null,
    impact.some((name) => /^caution/i.test(name)) ? "'caution'" : null,
  ].filter((value): value is string => value !== null)
  const kind = input.subject.kind
  const source = BIODIVERSITY.oldSeral[0]?.source ?? ''
  return {
    subject: {
      name: input.subject.name,
      kind,
      noun: kind === 'road' ? 'road' : 'block',
      areaHa: blockArea === null ? null : round(blockArea / 10_000),
    },
    rows,
    oldForest: {
      ndts,
      landscapeUnit: rows[factKey('landscape-unit')]?.names[0] ?? null,
      beo,
      ogmaPercent,
      ogmaTouching,
      statement: inputs.oldForestStatement?.trim() || null,
      source,
    },
    patch: {
      areaHa: patchArea,
      joined,
      ndt,
      className: patch?.name ?? null,
      article: patch && /^[aeiox]/i.test(patch.name) ? 'an' : 'a',
      bin: patch?.label ?? null,
      target: patch?.targetPercent ?? null,
      currentPercent: inputs.patchCurrentPercent?.trim() || null,
      futureTarget: inputs.patchFutureTarget?.trim() || null,
      decision: inputs.patchDecision?.trim() || null,
      source: patch?.source ?? null,
    },
    tap: {
      remnant,
      ogmas: ogmaTouching,
      ogmaSides: [...new Set(ogmaTouching.map((ogma) => ogma.side))],
      note: inputs.tapNote?.trim() || null,
    },
    uwr: {
      units: uwrUnits,
      roadCrosses: uwrUnits.filter((unit) => (unit.roadInsideMeters ?? 0) > 0).map((unit) => unit.unit),
    },
    fisher: { classes: fisherClasses },
    birds: { rankings: (rows[factKey('migratory-bird-rankings')]?.names ?? []).map((rank) => `'${rank}'`) },
    oldForestLabels: {
      ndts: ndts.map((entry) => entry.label),
    },
    visuals: input.visuals ?? null,
    own,
  }
}
