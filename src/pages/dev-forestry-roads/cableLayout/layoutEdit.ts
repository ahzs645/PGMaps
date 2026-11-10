/**
 * A support layout edited by hand: the found layout taken as a starting point, or supports placed
 * from scratch. The edit is stored with the D-line (`CableSupportLayout.edited`) and analysed by the
 * crate's `cl_analyze` at its own pre-tension, without searching. This file holds the edit's shape,
 * its limits and the pure operations the sidebar table and the D-line chart share.
 *
 * Interaction modelled on SEILAPLAN 3.8's manual adjustment, from its manuals' descriptions; no code
 * from SEILAPLAN (GPL-2.0-or-later) was used. Pure: no DOM or network access.
 */
import { MAX_MECHANICS_SPAN_M } from '../cableMechanics'
import type { LayoutToAnalyse } from './cableLayout'
import type { CableSupportLayout, LayoutRun, SavedLayout, SectorEntry } from './settings'

/** Delay between the last edit and its re-check, ms. */
export const EDIT_CHECK_DELAY_MS = 300
/** Most intermediate supports an edited layout holds. */
export const MAX_EDITED_SUPPORTS = 50
/** Longest support name, characters. */
export const MAX_SUPPORT_NAME_LENGTH = 60
/** Closest two supports may stand, m (the crate needs stations strictly forwards). */
export const MIN_EDIT_SPACING_M = 1
/** Saddle height range of an intermediate support, m (the search's own range limits). */
export const EDIT_SUPPORT_HEIGHT_M = [1, 50] as const
/** Saddle height range of a support start or end, m; 0 makes it a ground anchor the carriage runs to. */
export const EDIT_END_HEIGHT_M = [0, 50] as const
/** Pre-tension range an edit accepts, kN (the search's `lowestPreTensionKN` range). */
export const EDIT_PRE_TENSION_KN = [1, 10_000] as const
/** Screen distance a support handle must move before a drag edits it, px. */
export const MIN_SUPPORT_DRAG_PX = 4
/** Shortest no-support sector drawn on the chart, m. */
export const MIN_DRAWN_SECTOR_M = 2
/** Edits round stations and heights to this, m. */
export const EDIT_ROUNDING_M = 0.1

export const SUPPORT_CATEGORIES = ['tree', 'mast', 'ground-anchor', 'other'] as const
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]
/** Labels only: a category never sizes or checks anything. */
export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  tree: 'Support tree',
  mast: 'Mast',
  'ground-anchor': 'Ground anchor',
  other: 'Other',
}

/** What the crew calls a support, and what it is. Neither changes the analysis. */
export interface SupportIdentity {
  name?: string
  category?: SupportCategory
}
export interface EditedSupport extends SupportIdentity {
  /** From the yarder, m. */
  stationM: number
  /** Saddle height above the ground, m. */
  heightM: number
}
export interface EditedEnd extends SupportIdentity {
  /** Saddle height of a support start or end, m; unused for a yarder or ground-anchor end. */
  heightM: number
}
export interface EditedLayout {
  /** Where the edit began: the found layout, or supports placed by hand. */
  origin: 'found' | 'hand'
  preTensionKN: number
  start: EditedEnd
  end: EditedEnd
  /** Intermediate supports in station order from the yarder. */
  supports: EditedSupport[]
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const round = (v: number) => Math.round(v / EDIT_ROUNDING_M) * EDIT_ROUNDING_M
const roundTo = (v: number) => Number(round(v).toFixed(1))
const clamp = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v))

function identity(raw: Record<string, unknown>, label: string): SupportIdentity {
  const out: SupportIdentity = {}
  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string' || raw.name.length > MAX_SUPPORT_NAME_LENGTH)
      throw Error(`D-line support layout: ${label} name must be text of at most ${MAX_SUPPORT_NAME_LENGTH} characters.`)
    if (raw.name.trim()) out.name = raw.name
  }
  if (raw.category !== undefined) {
    if (!SUPPORT_CATEGORIES.includes(raw.category as SupportCategory))
      throw Error(`D-line support layout: ${label} category must be one of ${SUPPORT_CATEGORIES.join(', ')}.`)
    out.category = raw.category as SupportCategory
  }
  return out
}

function heightOf(raw: unknown, range: readonly [number, number], label: string): number {
  if (!isNumber(raw) || raw < range[0] || raw > range[1])
    throw Error(`D-line support layout: ${label} height must be ${range[0]}–${range[1]} m.`)
  return raw
}

/** Reads an edited layout from a project file, refusing anything outside its limits. */
export function parseEditedLayout(raw: unknown): EditedLayout {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw Error('D-line support layout: the edited layout must be an object.')
  const r = raw as Record<string, unknown>
  if (r.origin !== 'found' && r.origin !== 'hand')
    throw Error('D-line support layout: the edited layout must say whether it began from the found layout or by hand.')
  if (!isNumber(r.preTensionKN) || r.preTensionKN < EDIT_PRE_TENSION_KN[0] || r.preTensionKN > EDIT_PRE_TENSION_KN[1])
    throw Error(
      `D-line support layout: the edited pre-tension must be ${EDIT_PRE_TENSION_KN[0]}–${EDIT_PRE_TENSION_KN[1].toLocaleString('en-CA')} kN.`,
    )
  const end = (v: unknown, label: string): EditedEnd => {
    const o = (v ?? {}) as Record<string, unknown>
    if (typeof o !== 'object' || Array.isArray(o)) throw Error(`D-line support layout: the ${label} must be an object.`)
    return { heightM: heightOf(o.heightM, EDIT_END_HEIGHT_M, `the ${label}`), ...identity(o, `the ${label}`) }
  }
  if (r.supports !== undefined && (!Array.isArray(r.supports) || r.supports.length > MAX_EDITED_SUPPORTS))
    throw Error(`D-line support layout: an edited layout holds at most ${MAX_EDITED_SUPPORTS} supports.`)
  const supports = ((r.supports as unknown[] | undefined) ?? []).map((v) => {
    const o = (v ?? {}) as Record<string, unknown>
    if (!isNumber(o.stationM) || o.stationM <= 0 || o.stationM >= MAX_MECHANICS_SPAN_M)
      throw Error('D-line support layout: an edited support needs a station inside the line.')
    return {
      stationM: o.stationM,
      heightM: heightOf(o.heightM, EDIT_SUPPORT_HEIGHT_M, 'an edited support'),
      ...identity(o, 'a support'),
    }
  })
  if (supports.some((s, i) => i > 0 && s.stationM < supports[i - 1].stationM + MIN_EDIT_SPACING_M - 1e-9))
    throw Error(
      `D-line support layout: edited supports must run forwards from the yarder, at least ${MIN_EDIT_SPACING_M} m apart.`,
    )
  return {
    origin: r.origin,
    preTensionKN: r.preTensionKN,
    start: end(r.start, 'start support'),
    end: end(r.end, 'end support'),
    supports,
  }
}

/** Why the edit cannot be analysed on a line `lengthM` long, in the table's words. Empty when it can. */
export function editedLayoutErrors(edited: EditedLayout, lengthM: number): string[] {
  const errors: string[] = []
  if (
    !isNumber(edited.preTensionKN) ||
    edited.preTensionKN < EDIT_PRE_TENSION_KN[0] ||
    edited.preTensionKN > EDIT_PRE_TENSION_KN[1]
  )
    errors.push(
      `The pre-tension must be ${EDIT_PRE_TENSION_KN[0]}–${EDIT_PRE_TENSION_KN[1].toLocaleString('en-CA')} kN.`,
    )
  if (edited.supports.length > MAX_EDITED_SUPPORTS) errors.push(`At most ${MAX_EDITED_SUPPORTS} supports.`)
  edited.supports.forEach((s, i) => {
    if (!isNumber(s.stationM) || s.stationM < MIN_EDIT_SPACING_M || s.stationM > lengthM - MIN_EDIT_SPACING_M)
      errors.push(
        `Support ${i + 1} at ${fmt(s.stationM)} m is outside the line (${MIN_EDIT_SPACING_M}–${fmt(lengthM - MIN_EDIT_SPACING_M)} m).`,
      )
    else if (i > 0 && s.stationM < edited.supports[i - 1].stationM + MIN_EDIT_SPACING_M - 1e-9)
      errors.push(`Support ${i + 1} must stand at least ${MIN_EDIT_SPACING_M} m past support ${i}.`)
    if (!isNumber(s.heightM) || s.heightM < EDIT_SUPPORT_HEIGHT_M[0] || s.heightM > EDIT_SUPPORT_HEIGHT_M[1])
      errors.push(`Support ${i + 1} must be ${EDIT_SUPPORT_HEIGHT_M[0]}–${EDIT_SUPPORT_HEIGHT_M[1]} m high.`)
  })
  for (const [end, label] of [
    [edited.start, 'start'],
    [edited.end, 'end'],
  ] as const)
    if (!isNumber(end.heightM) || end.heightM < EDIT_END_HEIGHT_M[0] || end.heightM > EDIT_END_HEIGHT_M[1])
      errors.push(`The ${label} support must be ${EDIT_END_HEIGHT_M[0]}–${EDIT_END_HEIGHT_M[1]} m high.`)
  return errors
}

const fmt = (v: number) => (Number.isFinite(v) ? Number(v.toFixed(1)).toLocaleString('en-CA') : '?')

/** Ground at a station from the run's profile (linear between samples), NaN where unknown. */
export function groundAtStation(profile: LayoutRun['input']['profile'], stationM: number): number {
  const t = (stationM - profile.x0) / profile.dx
  const i = Math.floor(t)
  if (i < 0 || i >= profile.z.length) return NaN
  if (i === profile.z.length - 1) return t - i < 1e-9 ? profile.z[i] : NaN
  const a = profile.z[i],
    b = profile.z[i + 1]
  return a + (b - a) * (t - i)
}

/**
 * The edit as the crate's analysis input: the ends follow the D-line as it is now (the yarder's
 * height, a ground anchor's zero), and every support must stand on known ground.
 */
export function editedLayoutToAnalyse(
  run: LayoutRun,
  edited: EditedLayout,
): { ok: true; layout: LayoutToAnalyse } | { ok: false; error: string } {
  const errors = editedLayoutErrors(edited, run.lengthM)
  if (errors.length) return { ok: false, error: errors[0] }
  const { input } = run
  const supports = [
    {
      stationM: 0,
      heightM:
        input.startKind === 'yarder' ? input.towerHeightM : input.startKind === 'anchor' ? 0 : edited.start.heightM,
    },
    ...edited.supports.map((s) => ({ stationM: s.stationM, heightM: s.heightM })),
    { stationM: run.lengthM, heightM: input.endKind === 'anchor' ? 0 : edited.end.heightM },
  ]
  for (const s of supports)
    if (Number.isNaN(groundAtStation(input.profile, s.stationM)))
      return { ok: false, error: `Ground is unknown under the support at ${fmt(s.stationM)} m.` }
  return { ok: true, layout: { preTensionKN: edited.preTensionKN, complete: true, supports } }
}

/** What re-check an edit needs: changes to names and categories never re-run it. */
export function editCheckKey(edited: EditedLayout): string {
  return JSON.stringify([
    edited.preTensionKN,
    edited.start.heightM,
    edited.end.heightM,
    edited.supports.map((s) => [s.stationM, s.heightM]),
  ])
}

/** A pre-tension inside the run's searched range, for a layout placed by hand. */
export function defaultPreTension(run: Pick<LayoutRun, 'input'>): number {
  const { tensionLowKN: low, tensionHighKN: high } = run.input
  return clamp(Math.round((low + high) / 2), EDIT_PRE_TENSION_KN[0], EDIT_PRE_TENSION_KN[1])
}

/** The found layout as an edit. A line that stopped short keeps its last support and gains the end. */
export function editFromFound(saved: SavedLayout, settings: CableSupportLayout, lengthM: number): EditedLayout {
  const points = saved.supports
  const middle = saved.complete ? points.slice(1, -1) : points.slice(1)
  const supports: EditedSupport[] = []
  for (const p of middle) {
    if (p.stationM < MIN_EDIT_SPACING_M || p.stationM > lengthM - MIN_EDIT_SPACING_M) continue
    if (supports.length && p.stationM < supports.at(-1)!.stationM + MIN_EDIT_SPACING_M) continue
    supports.push({ stationM: p.stationM, heightM: clamp(p.heightM, ...EDIT_SUPPORT_HEIGHT_M) })
  }
  return {
    origin: 'found',
    preTensionKN: clamp(saved.preTensionKN, ...EDIT_PRE_TENSION_KN),
    start: { heightM: clamp(points[0].heightM, ...EDIT_END_HEIGHT_M) },
    end: {
      heightM: clamp(saved.complete ? points.at(-1)!.heightM : settings.minSupportHeightM, ...EDIT_END_HEIGHT_M),
    },
    supports,
  }
}

/** An edit with no intermediate supports, to place them by hand. */
export function emptyEdit(settings: CableSupportLayout, preTensionKN: number): EditedLayout {
  return {
    origin: 'hand',
    preTensionKN: clamp(Math.round(preTensionKN), ...EDIT_PRE_TENSION_KN),
    start: { heightM: settings.maxSupportHeightM },
    end: { heightM: settings.minSupportHeightM },
    supports: [],
  }
}

/** Where support `index` may stand: between its neighbours (or the ends), less the spacing. */
export function stationBounds(edited: EditedLayout, index: number, lengthM: number): [number, number] {
  const before = index > 0 ? edited.supports[index - 1].stationM : 0
  const after = index < edited.supports.length - 1 ? edited.supports[index + 1].stationM : lengthM
  return [before + MIN_EDIT_SPACING_M, after - MIN_EDIT_SPACING_M]
}

/**
 * Moves or re-heights support `index`, keeping it between its neighbours (it never passes one) and
 * its height within range. Rounds to `EDIT_ROUNDING_M`.
 */
export function moveSupport(
  edited: EditedLayout,
  index: number,
  patch: Partial<Pick<EditedSupport, 'stationM' | 'heightM'>>,
  lengthM: number,
): EditedLayout {
  const s = edited.supports[index]
  if (!s) return edited
  const [low, high] = stationBounds(edited, index, lengthM)
  const stationM =
    patch.stationM === undefined || !isNumber(patch.stationM)
      ? s.stationM
      : low > high
        ? s.stationM
        : roundTo(clamp(patch.stationM, low, high))
  const heightM =
    patch.heightM === undefined || !isNumber(patch.heightM)
      ? s.heightM
      : roundTo(clamp(patch.heightM, ...EDIT_SUPPORT_HEIGHT_M))
  if (stationM === s.stationM && heightM === s.heightM) return edited
  return { ...edited, supports: edited.supports.map((x, i) => (i === index ? { ...x, stationM, heightM } : x)) }
}

/** Sets a support's (or an end's) name and category. */
export function nameSupport(
  edited: EditedLayout,
  which: number | 'start' | 'end',
  patch: SupportIdentity,
): EditedLayout {
  const apply = <T extends SupportIdentity>(x: T): T => {
    const next = { ...x, ...patch }
    if (next.name !== undefined) next.name = next.name.slice(0, MAX_SUPPORT_NAME_LENGTH)
    if (!next.name?.trim()) delete next.name
    if (!next.category) delete next.category
    return next
  }
  if (which === 'start') return { ...edited, start: apply(edited.start) }
  if (which === 'end') return { ...edited, end: apply(edited.end) }
  return { ...edited, supports: edited.supports.map((x, i) => (i === which ? apply(x) : x)) }
}

/** Sets the start or end support's saddle height. */
export function setEndHeight(edited: EditedLayout, which: 'start' | 'end', heightM: number): EditedLayout {
  if (!isNumber(heightM)) return edited
  const h = roundTo(clamp(heightM, ...EDIT_END_HEIGHT_M))
  return { ...edited, [which]: { ...edited[which], heightM: h } }
}

/** The heights either side of a station, for a new support's starting height. */
function neighbourHeight(edited: EditedLayout, stationM: number, settings: CableSupportLayout) {
  const before = [...edited.supports].reverse().find((s) => s.stationM < stationM)
  const after = edited.supports.find((s) => s.stationM > stationM)
  const known = [before?.heightM, after?.heightM].filter(isNumber)
  const h = known.length ? known.reduce((a, b) => a + b, 0) / known.length : settings.minSupportHeightM
  return roundTo(clamp(h, Math.max(EDIT_SUPPORT_HEIGHT_M[0], settings.minSupportHeightM), EDIT_SUPPORT_HEIGHT_M[1]))
}

/**
 * Adds a support at a station, its height between its neighbours'. Returns null where it would
 * stand within `MIN_EDIT_SPACING_M` of another support or an end, or the layout is full.
 */
export function addSupportAt(
  edited: EditedLayout,
  stationM: number,
  settings: CableSupportLayout,
  lengthM: number,
): { edited: EditedLayout; index: number } | null {
  if (!isNumber(stationM) || edited.supports.length >= MAX_EDITED_SUPPORTS) return null
  const s = roundTo(stationM)
  if (s < MIN_EDIT_SPACING_M || s > lengthM - MIN_EDIT_SPACING_M) return null
  if (edited.supports.some((x) => Math.abs(x.stationM - s) < MIN_EDIT_SPACING_M)) return null
  const support = { stationM: s, heightM: neighbourHeight(edited, s, settings) }
  const supports = [...edited.supports, support].sort((a, b) => a.stationM - b.stationM)
  return { edited: { ...edited, supports }, index: supports.indexOf(support) }
}

/** Adds a support halfway to the next one (or the end), after support `index` (−1: after the start). */
export function addSupportAfter(
  edited: EditedLayout,
  index: number,
  settings: CableSupportLayout,
  lengthM: number,
): { edited: EditedLayout; index: number } | null {
  const from = index < 0 ? 0 : edited.supports[index]?.stationM
  const to = index + 1 < edited.supports.length ? edited.supports[index + 1].stationM : lengthM
  if (from === undefined) return null
  return addSupportAt(edited, (from + to) / 2, settings, lengthM)
}

/** Adds a support in the middle of the longest span. */
export function addSupportInLongestSpan(edited: EditedLayout, settings: CableSupportLayout, lengthM: number) {
  const stations = [0, ...edited.supports.map((s) => s.stationM), lengthM]
  let best = 0
  for (let i = 1; i < stations.length - 1; i++)
    if (stations[i + 1] - stations[i] > stations[best + 1] - stations[best]) best = i
  return addSupportAfter(edited, best - 1, settings, lengthM)
}

export function removeSupport(edited: EditedLayout, index: number): EditedLayout {
  return { ...edited, supports: edited.supports.filter((_, i) => i !== index) }
}

/** A drag along the chart's ground as a no-support sector, or null when it is too short. */
export function sectorFromDrag(aM: number, bM: number, lengthM: number): SectorEntry | null {
  const fromM = Math.round(clamp(Math.min(aM, bM), 0, lengthM))
  const toM = Math.round(clamp(Math.max(aM, bM), 0, lengthM))
  return toM - fromM >= MIN_DRAWN_SECTOR_M ? { fromM, toM } : null
}

export interface PlacementIssue {
  stationM: number
  text: string
}

/**
 * Where the edit breaks a search rule the analysis does not check: a support inside a no-support
 * sector, or closer to the next than the search's minimum spacing.
 */
export function placementIssues(edited: EditedLayout, settings: CableSupportLayout): PlacementIssue[] {
  const out: PlacementIssue[] = []
  edited.supports.forEach((s, i) => {
    const sector = settings.noSupportSectors.find((r) => s.stationM > r.fromM && s.stationM < r.toM)
    if (sector)
      out.push({
        stationM: s.stationM,
        text: `Support ${i + 1} at ${fmt(s.stationM)} m stands in the no-support sector ${fmt(sector.fromM)}–${fmt(sector.toM)} m.`,
      })
    const next = edited.supports[i + 1]
    if (next && next.stationM - s.stationM < settings.minSupportSpacingM - 1e-9)
      out.push({
        stationM: next.stationM,
        text: `Supports ${i + 1} and ${i + 2} are ${fmt(next.stationM - s.stationM)} m apart, under the ${fmt(settings.minSupportSpacingM)} m minimum spacing.`,
      })
  })
  return out
}

/** True when the found layout has a support at this station and height. */
export function matchesFound(saved: SavedLayout | undefined, support: Pick<EditedSupport, 'stationM' | 'heightM'>) {
  return Boolean(
    saved?.supports.some(
      (p) => Math.abs(p.stationM - support.stationM) < 0.05 && Math.abs(p.heightM - support.heightM) < 0.05,
    ),
  )
}

/** Station from the yarder for a chart distance (the mapping is its own inverse). */
export function stationFromChart(frame: { lengthM: number; yarderAtEnd: boolean }, x: number) {
  return frame.yarderAtEnd ? frame.lengthM - x : x
}
