/**
 * The found layout beside the current (edited) one, one row per limit or key value, and where on
 * the line each row applies, so a row can be located on the D-line chart and the plan. Pure.
 */
import { intermediateSupports, type CableLayoutResult, type LayoutSupport } from './cableLayout'
import type { PlacementIssue } from './layoutEdit'
import { layoutLimitRows, type LayoutLimitState } from './limits'
import type { CableSupportLayout } from './settings'

export interface CompareRow {
  id: string
  label: string
  limit: string
  found: string
  current: string
  foundState: LayoutLimitState | null
  currentState: LayoutLimitState | null
  /** Both sides known and different. */
  changed: boolean
}

const f0 = (v: number) => Math.round(v).toLocaleString('en-CA')
const f1 = (v: number) => v.toFixed(1)
const DASH = '–'

const isAnchor = (s: LayoutSupport) => s.kind === 'anchor' || s.kind === 'ground-anchor'
/** Intermediate supports: the ones with a lift-off limit. */
const middle = (r: CableLayoutResult) => r.supports.filter((s) => s.liftOffLimitDeg !== null)
const maxBy = <T>(list: T[], value: (t: T) => number | null): T | undefined =>
  list.reduce<T | undefined>((best, t) => {
    const v = value(t)
    return v !== null && (best === undefined || v > value(best)!) ? t : best
  }, undefined)

interface KeyValue {
  id: string
  label: string
  limit: string
  value: (r: CableLayoutResult) => string
}

const KEY_VALUES: KeyValue[] = [
  {
    id: 'supports',
    label: 'Intermediate supports',
    limit: DASH,
    value: (r) => String(intermediateSupports(r).length),
  },
  {
    id: 'stations',
    label: 'Support stations',
    limit: 'm from yarder',
    value: (r) =>
      intermediateSupports(r)
        .map((s) => f0(s.stationM))
        .join(', ') || 'none',
  },
  {
    id: 'heights',
    label: 'Support heights',
    limit: 'm',
    value: (r) =>
      intermediateSupports(r)
        .map((s) => f1(s.heightM))
        .join(', ') || 'none',
  },
  {
    id: 'pre-tension',
    label: 'Pre-tension',
    limit: 'kN',
    value: (r) => (r.preTensionKN === null ? DASH : f0(r.preTensionKN)),
  },
  {
    id: 'saddle-force',
    label: 'Largest saddle force',
    limit: 'kN',
    value: (r) => {
      const s = maxBy(middle(r), (x) => x.maxForceKN)
      return s ? f1(s.maxForceKN!) : DASH
    },
  },
  {
    id: 'anchor-force',
    label: 'Largest anchor tension',
    limit: 'kN',
    value: (r) => {
      const s = maxBy(r.supports.filter(isAnchor), (x) => x.maxForceKN)
      return s ? f1(s.maxForceKN!) : DASH
    },
  },
  {
    id: 'rope-length',
    label: 'Rope between end supports',
    limit: 'm',
    value: (r) => (r.ropeLengthM === null ? DASH : f0(r.ropeLengthM)),
  },
]

/**
 * Rows comparing the found layout with the current one: the limits of `limits.ts` first, then key
 * values, then the placement rules the analysis does not check (current side only).
 */
export function compareLayouts(
  found: CableLayoutResult | null,
  current: CableLayoutResult | null,
  settings: CableSupportLayout,
  minClearanceM: number,
  placement: PlacementIssue[] | null,
): CompareRow[] {
  const foundLimits = found ? layoutLimitRows(found, settings, minClearanceM) : null
  const currentLimits = current ? layoutLimitRows(current, settings, minClearanceM) : null
  const template = currentLimits ?? foundLimits ?? []
  const rows: CompareRow[] = template.map((t, i) => {
    const f = foundLimits?.[i]
    const c = currentLimits?.[i]
    return {
      id: t.id,
      label: t.label,
      limit: t.limit,
      found: f?.value ?? DASH,
      current: c?.value ?? DASH,
      foundState: f?.state ?? null,
      currentState: c?.state ?? null,
      changed: Boolean(f && c && f.value !== c.value),
    }
  })
  for (const k of KEY_VALUES) {
    const f = found ? k.value(found) : null
    const c = current ? k.value(current) : null
    rows.push({
      id: k.id,
      label: k.label,
      limit: k.limit,
      found: f ?? DASH,
      current: c ?? DASH,
      foundState: null,
      currentState: null,
      changed: f !== null && c !== null && f !== c,
    })
  }
  if (placement)
    rows.push({
      id: 'placement',
      label: 'Placement (sectors, spacing)',
      limit: `outside sectors, ≥ ${f0(settings.minSupportSpacingM)} m apart`,
      found: DASH,
      current: placement.length === 0 ? 'kept' : `${placement.length} issue${placement.length === 1 ? '' : 's'}`,
      foundState: null,
      currentState: placement.length === 0 ? 'met' : 'not-met',
      changed: false,
    })
  return rows
}

/** Where a row applies: points to mark (station from the yarder) and, for a span, its extent. */
export interface LayoutFocusMarks {
  points: { stationM: number; label: string }[]
  range?: [number, number]
}

const top = (s: LayoutSupport) => s.groundM + s.heightM

/** Where the limit or key value of `rowId` (or `span:<index>`) applies on `result`. */
export function focusMarks(
  rowId: string,
  result: CableLayoutResult,
  settings: CableSupportLayout,
  placement: PlacementIssue[] = [],
): LayoutFocusMarks {
  const at = (stationM: number | null, label: string) => (stationM === null ? [] : [{ stationM, label }])
  const supports = (list: LayoutSupport[], label: (s: LayoutSupport) => string) =>
    list.map((s) => ({ stationM: s.stationM, label: label(s) }))
  const span = /^span:(\d+)$/.exec(rowId)
  if (span) {
    const s = result.spans[Number(span[1])]
    if (!s) return { points: [] }
    const where = s.unknownGroundAtM ?? s.worstAtM ?? s.minClearanceAtM ?? (s.fromM + s.toM) / 2
    const label =
      s.unknownGroundAtM !== null
        ? 'unknown ground'
        : s.minClearanceM === null
          ? 'unsolved'
          : `clearance ${f1(s.minClearanceM)} m`
    return { points: [{ stationM: where, label }], range: [s.fromM, s.toM] }
  }
  const mids = middle(result)
  const ends = result.supports.filter((s) => s.liftOffLimitDeg === null && s.loadedLimitDeg !== null)
  switch (rowId) {
    case 'clearance': {
      const failing = result.spans.filter((s) => !s.clearanceOk && s.worstAtM !== null)
      if (failing.length)
        return {
          points: failing.map((s) => ({
            stationM: s.worstAtM!,
            label: `short ${f1(Math.max(0, s.worstShortfallM ?? 0))} m`,
          })),
        }
      const unknown = result.spans.find((s) => s.unknownGroundAtM !== null)
      if (unknown) return { points: at(unknown.unknownGroundAtM, 'unknown ground') }
      return {
        points: at(
          result.minClearanceAtM,
          result.minClearanceM === null ? 'min clearance' : `min ${f1(result.minClearanceM)} m`,
        ),
      }
    }
    case 'tension': {
      const s = result.maxTensionSpan === null ? undefined : result.spans[result.maxTensionSpan]
      if (!s || result.maxTensionKN === null) return { points: [] }
      // Tension is highest at the higher end of the span that carries the load.
      const from = result.supports.find((p) => Math.abs(p.stationM - s.fromM) < 1e-6)
      const to = result.supports.find((p) => Math.abs(p.stationM - s.toM) < 1e-6)
      const higher = from && to ? (top(from) >= top(to) ? from : to) : (from ?? to)
      return {
        points: at(higher?.stationM ?? s.fromM, `${f0(result.maxTensionKN)} kN`),
        range: [s.fromM, s.toM],
      }
    }
    case 'gravity':
      return {
        points: result.spans.filter((s) => !s.gravityOk).flatMap((s) => at(s.gravityFailsAtM ?? s.fromM, 'stops')),
      }
    case 'loaded-intermediate':
    case 'loaded-end': {
      const list = rowId === 'loaded-end' ? ends : mids
      const over = list.filter((s) => s.loadedBreakDeg !== null && s.loadedBreakDeg > (s.loadedLimitDeg ?? Infinity))
      const shown = over.length ? over : [maxBy(list, (s) => s.loadedBreakDeg)].filter((s) => s !== undefined)
      return { points: supports(shown, (s) => `${f1(s.loadedBreakDeg ?? NaN)}°`) }
    }
    case 'lift-off': {
      const under = mids.filter((s) => s.emptyBreakDeg !== null && s.emptyBreakDeg < settings.liftOffDeg)
      const shown = under.length
        ? under
        : [maxBy(mids, (s) => (s.emptyBreakDeg === null ? null : -s.emptyBreakDeg))].filter((s) => s !== undefined)
      return { points: supports(shown, (s) => `${f1(s.emptyBreakDeg ?? NaN)}°`) }
    }
    case 'hold-down':
      return {
        points: supports(
          mids.filter((s) => s.emptyBreakDeg !== null && s.emptyBreakDeg < settings.holdDownDeg),
          () => 'lug',
        ),
      }
    case 'supports':
    case 'stations':
    case 'heights':
      return {
        points: supports(intermediateSupports(result), (s) =>
          rowId === 'heights' ? `${f1(s.heightM)} m` : `${f0(s.stationM)} m`,
        ),
      }
    case 'pre-tension':
      return { points: result.preTensionKN === null ? [] : [{ stationM: 0, label: `${f0(result.preTensionKN)} kN` }] }
    case 'saddle-force': {
      const s = maxBy(mids, (x) => x.maxForceKN)
      return { points: s ? supports([s], (x) => `${f1(x.maxForceKN!)} kN`) : [] }
    }
    case 'anchor-force': {
      const s = maxBy(result.supports.filter(isAnchor), (x) => x.maxForceKN)
      return { points: s ? supports([s], (x) => `${f1(x.maxForceKN!)} kN`) : [] }
    }
    case 'placement':
      return { points: placement.map((p) => ({ stationM: p.stationM, label: 'placement' })) }
    default:
      return { points: [] }
  }
}
