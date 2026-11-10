/**
 * Places along a road worth stepping to: the profile's PVIs, the plan's curve points, flagged and
 * incomplete stations, culverts and template range ends. The station bar's jump menu and the `[` and
 * `]` keys move the shared station between the targets of one kind. No DOM.
 */
import { horizontalCurveSummary } from './engine'
import { horizontalCurveEvents } from './planAnnotations'
import { projectReadiness } from './readiness'
import { reviewRoadSight } from './sightDistance'
import type { Alignment, RoadAnalysis, RoadProject } from './types'

export type StationJumpKind = 'pvi' | 'curve' | 'flag' | 'incomplete' | 'culvert' | 'template'

export interface StationJumpTarget {
  kind: StationJumpKind
  chainage: number
  /** What is there, in a few words: "PVI 3 · VC 40 m", "EC H2", "Culvert C1". */
  label: string
  /** Set on a culvert target, so the jump can select the culvert as well as its station. */
  culvertId?: string
}

/** The kinds in menu order, with the words the menu and notices use. */
export const STATION_JUMP_KINDS: readonly {
  kind: StationJumpKind
  label: string
  /** The label inside a sentence: "Next PVI", "No culvert after …". */
  noun: string
  plural: string
}[] = [
  { kind: 'pvi', label: 'PVI', noun: 'PVI', plural: 'PVIs' },
  { kind: 'curve', label: 'Curve point', noun: 'curve point', plural: 'curve points' },
  { kind: 'flag', label: 'Flagged station', noun: 'flagged station', plural: 'flagged stations' },
  { kind: 'incomplete', label: 'Incomplete section', noun: 'incomplete section', plural: 'incomplete sections' },
  { kind: 'culvert', label: 'Culvert', noun: 'culvert', plural: 'culverts' },
  { kind: 'template', label: 'Template change', noun: 'template change', plural: 'template changes' },
]

/**
 * A target this close to the selected station is the one already shown, so the next jump passes it.
 * Jumps set the station to the target's exact chainage, so a millimetre is enough.
 */
export const JUMP_TOLERANCE_M = 0.001
/** Targets of one kind closer than this are one place; their labels are joined. */
export const JUMP_MERGE_M = 0.5

/** A finding from outside the station records (Review rows, sight distance) placed at a chainage. */
export interface StationFinding {
  chainage: number
  label: string
}

const finite = (value: number | null | undefined): value is number => value != null && Number.isFinite(value)

/** Sorted by chainage, held to the road, with targets at one place merged. */
function tidy(targets: StationJumpTarget[], length: number): StationJumpTarget[] {
  const sorted = targets
    .filter((t) => finite(t.chainage) && t.chainage >= -JUMP_MERGE_M && t.chainage <= length + JUMP_MERGE_M)
    .map((t) => ({ ...t, chainage: Math.max(0, Math.min(length, t.chainage)) }))
    .sort((a, b) => a.chainage - b.chainage)
  const out: StationJumpTarget[] = []
  for (const target of sorted) {
    const last = out[out.length - 1]
    if (last && target.chainage - last.chainage <= JUMP_MERGE_M) {
      if (!last.label.split(' · ').includes(target.label)) last.label = `${last.label} · ${target.label}`
      continue
    }
    out.push(target)
  }
  return out
}

/** Runs of consecutive stations that pass `test`, each as its first station and its length in stations. */
function runs<T extends { chainage: number }>(stations: readonly T[], test: (station: T) => boolean) {
  const out: { first: T; count: number }[] = []
  let open: { first: T; count: number } | null = null
  for (const station of stations) {
    if (!test(station)) {
      open = null
      continue
    }
    if (open) open.count++
    else out.push((open = { first: station, count: 1 }))
  }
  return out
}

const stationsWord = (count: number) => (count > 1 ? ` (${count} stations)` : '')

/**
 * Every jump target of every kind for one road. `findings` adds places that the station records do
 * not carry: short sight distance, Review rows with a station. A road whose horizontal geometry
 * cannot be fitted has no curve points rather than an error.
 */
export function stationJumpTargets(
  alignment: Pick<Alignment, 'vertical' | 'engineering'> & Partial<Alignment>,
  analysis: Pick<RoadAnalysis, 'stations' | 'length'> & Partial<Pick<RoadAnalysis, 'engineering'>>,
  findings: readonly StationFinding[] = [],
): Record<StationJumpKind, StationJumpTarget[]> {
  const length = analysis.length
  const pvis = [...alignment.vertical]
    .sort((a, b) => a.chainage - b.chainage)
    .map<StationJumpTarget>((p, index) => ({
      kind: 'pvi',
      chainage: p.chainage,
      label: `PVI ${index + 1}${p.curveLength > 0 ? ` · VC ${Number(p.curveLength.toFixed(1))} m` : ''}`,
    }))
  let curve: StationJumpTarget[] = []
  if (alignment.points)
    try {
      curve = horizontalCurveSummary(alignment as Alignment).flatMap((c, index) =>
        horizontalCurveEvents(c).map((event) => ({
          kind: 'curve' as const,
          chainage: event.chainage,
          label: `${event.label} H${index + 1}`,
        })),
      )
    } catch {
      // Invalid intermediate geometry has no fitted curves to visit; the workspace reports it.
      curve = []
    }
  const flag = [
    ...runs(analysis.stations, (s) => s.flags.length > 0).map(({ first, count }) => ({
      kind: 'flag' as const,
      chainage: first.chainage,
      label: `${first.flags[0]}${stationsWord(count)}`,
    })),
    ...findings.map((f) => ({ kind: 'flag' as const, chainage: f.chainage, label: f.label })),
  ]
  const incomplete = runs(analysis.stations, (s) => !s.complete).map(({ first, count }) => ({
    kind: 'incomplete' as const,
    chainage: first.chainage,
    label: `${first.incompleteReasons?.[0] ?? 'Incomplete section'}${stationsWord(count)}`,
  }))
  const culvert = (analysis.engineering?.culverts ?? []).map((c) => ({
    kind: 'culvert' as const,
    chainage: c.chainage,
    label: `Culvert ${c.name}`,
    culvertId: c.id,
  }))
  const names = new Map(alignment.engineering?.templates.map((t) => [t.id, t.name]))
  const template = (alignment.engineering?.assignments ?? []).flatMap((a) => {
    const name = names.get(a.templateId) ?? 'Template'
    const side = a.side === 'both' ? '' : ` (${a.side})`
    return [
      { kind: 'template' as const, chainage: a.start, label: `${name}${side} starts` },
      { kind: 'template' as const, chainage: a.end, label: `${name}${side} ends` },
    ]
  })
  return {
    pvi: tidy(pvis, length),
    curve: tidy(curve, length),
    flag: tidy(flag, length),
    incomplete: tidy(incomplete, length),
    culvert: tidy(culvert, length),
    template: tidy(template, length),
  }
}

/**
 * The first target past `from` in `direction`, or null at the end of the list. Targets within
 * `JUMP_TOLERANCE_M` of `from` are where the station already is, so a jump never stays put.
 */
export function adjacentJump(
  targets: readonly StationJumpTarget[],
  from: number,
  direction: 1 | -1,
): StationJumpTarget | null {
  if (direction > 0) return targets.find((t) => t.chainage > from + JUMP_TOLERANCE_M) ?? null
  for (let i = targets.length - 1; i >= 0; i--) if (targets[i].chainage < from - JUMP_TOLERANCE_M) return targets[i]
  return null
}

/**
 * The findings a flagged-station jump visits beyond the station flags: Review rows that need
 * attention and name a station, and eyes whose stopping sight distance is short. Either check that
 * cannot run adds nothing; the Review step and the sight band report why.
 */
export function reviewJumpFindings(
  project: Parameters<typeof projectReadiness>[0] & Pick<RoadProject, 'settings'>,
  alignment: Alignment,
  analysis: RoadAnalysis,
): StationFinding[] {
  const out: StationFinding[] = []
  try {
    for (const row of projectReadiness(project, alignment, analysis, { drainageStale: false }).rows)
      if (row.state === 'attention' && row.action?.chainage !== undefined)
        out.push({ chainage: row.action.chainage, label: `${row.check}: ${row.result}` })
  } catch {
    // A road the Review step cannot assess yet has no rows to visit.
  }
  try {
    const sight = reviewRoadSight({
      analysis,
      alignment,
      standards: project.standards,
      stationIntervalM: project.settings.stationInterval,
    })
    // One finding per stretch of short eyes looking one way, as the flags are taken per run.
    for (const direction of ['ahead', 'back'] as const) {
      const eyes = sight.short.filter((eye) => eye.direction === direction).sort((a, b) => a.chainage - b.chainage)
      let start = 0
      for (let i = 1; i <= eyes.length; i++)
        if (i === eyes.length || eyes[i].chainage - eyes[i - 1].chainage > 1.5 * sight.eyeSpacingM) {
          out.push(sightFinding(eyes[start].chainage, direction, i - start))
          start = i
        }
    }
  } catch {
    // As above: the sight band states what it could not check.
  }
  return out
}

const sightFinding = (chainage: number, direction: 'ahead' | 'back', count: number): StationFinding => ({
  chainage,
  label: `Stopping sight distance short looking ${direction}${stationsWord(count)}`,
})

type KeyInput = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>

/**
 * `]` jumps forward and `[` back. ⌘[ and Ctrl+[ belong to the browser (back, and Escape on some
 * systems) and are left alone; AltGr, which reports Ctrl and Alt together, is how several keyboard
 * layouts type a bracket, so it counts.
 */
export function jumpShortcut(event: KeyInput): 1 | -1 | null {
  if (event.metaKey || (event.ctrlKey && !event.altKey)) return null
  if (event.key === ']') return 1
  if (event.key === '[') return -1
  return null
}
