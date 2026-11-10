/**
 * What the D-line profile draws for a support layout: the multi-span loaded path and empty rope,
 * supports, fixed supports, no-support sectors and convexity peaks, in the chart's own distance
 * (from the D-line's physical start). Pure.
 */
import { intermediateSupports, type CableLayoutResult, type LayoutSupportKind } from './cableLayout'
import type { LayoutFocusMarks } from './layoutCompare'
import { groundAtStation, type EditedLayout, type SupportCategory } from './layoutEdit'
import { chartDistance, type CableSupportLayout, type LayoutRun } from './settings'

/** Which part of an edited layout a support handle edits: an intermediate support's index or an end. */
export type SupportHandle = number | 'start' | 'end'

export interface CableLayoutOverlay {
  /** Loaded carriage path (with the ground under it) and empty rope, by chart distance. */
  loadPath: { x: number; z: number | null; ground: number | null }[]
  emptyRope: { x: number; z: number | null }[]
  supports: {
    x: number
    ground: number
    top: number
    kind: LayoutSupportKind
    label: string
    /** Edited layouts only: what the crew calls it and what it is (labels, never checked). */
    name?: string
    category?: SupportCategory
    /** Edited layouts only: what dragging this support edits, when it can be dragged. */
    handle?: SupportHandle
  }[]
  fixed: { x: number; heightM?: number }[]
  sectors: [number, number][]
  peaks: number[]
  /** One line for the chart footer; null before a run. */
  summary: string | null
  /** Present while the layout is being edited by hand. */
  editing?: {
    /** The rope drawn is from an earlier check; the current edit is still being checked. */
    pending: boolean
    lengthM: number
    yarderAtEnd: boolean
    /** Ground at a chart distance, or null where unknown. */
    groundAt: (x: number) => number | null
  }
  /** Where the limit or row picked in the sidebar applies, in chart distance. */
  focus?: { points: { x: number; label: string }[]; range?: [number, number] }
}

export interface LayoutOverlayOptions {
  /** The edit being made, drawn in place of the result's supports. */
  edited?: {
    layout: EditedLayout
    profile: LayoutRun['input']['profile']
    towerHeightM: number
    /** The result is from an earlier check than the edit drawn. */
    pending: boolean
  }
  focus?: LayoutFocusMarks
}

const n0 = (v: number | null) => (v === null ? '–' : Math.round(v).toLocaleString('en-CA'))
const n1 = (v: number | null) => (v === null ? '–' : v.toFixed(1))

export function layoutOverlay(
  frame: Pick<LayoutRun, 'lengthM' | 'yarderAtEnd'>,
  settings: CableSupportLayout,
  result: CableLayoutResult | null,
  options: LayoutOverlayOptions = {},
): CableLayoutOverlay {
  const base = resultOverlay(frame, settings, result)
  const x = (s: number) => chartDistance(frame, s)
  const focus = options.focus && {
    points: options.focus.points.map((p) => ({ x: x(p.stationM), label: p.label })),
    range:
      options.focus.range &&
      ([x(options.focus.range[0]), x(options.focus.range[1])].sort((a, b) => a - b) as [number, number]),
  }
  if (!options.edited) return focus ? { ...base, focus } : base
  const { layout, profile, towerHeightM, pending } = options.edited
  const ground = (stationM: number) => {
    const z = groundAtStation(profile, stationM)
    return Number.isNaN(z) ? null : z
  }
  const endKind = (h: number): LayoutSupportKind => (h > 0 ? 'support' : 'ground-anchor')
  const startHeight =
    settings.startKind === 'yarder' ? towerHeightM : settings.startKind === 'anchor' ? 0 : layout.start.heightM
  const endHeight = settings.endKind === 'anchor' ? 0 : layout.end.heightM
  const points = [
    {
      stationM: 0,
      heightM: startHeight,
      kind: settings.startKind === 'yarder' ? ('yarder' as const) : endKind(startHeight),
      label: settings.startKind === 'yarder' ? 'Y' : startHeight > 0 ? 'S' : 'A',
      name: layout.start.name,
      category: layout.start.category,
      handle: settings.startKind === 'support' ? ('start' as const) : undefined,
    },
    ...layout.supports.map((s, i) => ({
      stationM: s.stationM,
      heightM: s.heightM,
      kind: 'support' as const,
      label: String(i + 1),
      name: s.name,
      category: s.category,
      handle: i as SupportHandle,
    })),
    {
      stationM: frame.lengthM,
      heightM: endHeight,
      kind: endKind(endHeight),
      label: endHeight > 0 ? 'E' : 'A',
      name: layout.end.name,
      category: layout.end.category,
      handle: settings.endKind === 'support' ? ('end' as const) : undefined,
    },
  ]
  const supports: CableLayoutOverlay['supports'] = points.flatMap((p) => {
    const g = ground(p.stationM)
    if (g === null) return []
    return [
      {
        x: x(p.stationM),
        ground: g,
        top: g + p.heightM,
        kind: p.kind,
        label: p.label,
        ...(p.name ? { name: p.name } : {}),
        ...(p.category ? { category: p.category } : {}),
        ...(p.handle === undefined ? {} : { handle: p.handle }),
      },
    ]
  })
  // Anchors behind support ends come from the check, when there is one.
  for (const s of result?.supports ?? [])
    if (s.kind === 'anchor')
      supports.push({ x: x(s.stationM), ground: s.groundM, top: s.groundM, kind: s.kind, label: 'A' })
  const n = layout.supports.length
  const summary = base.summary
    ? `Edited layout · ${n} support${n === 1 ? '' : 's'}${pending ? ' · re-checking' : ''} · ${base.summary.replace(/^(Layout|Partial layout) · \d+ supports? · /, '')}`
    : `Edited layout · ${n} support${n === 1 ? '' : 's'} · ${pending ? 'checking' : 'not checked'}`
  return {
    ...base,
    supports,
    summary,
    editing: {
      pending,
      lengthM: frame.lengthM,
      yarderAtEnd: frame.yarderAtEnd,
      groundAt: (cx) => ground(frame.yarderAtEnd ? frame.lengthM - cx : cx),
    },
    ...(focus ? { focus } : {}),
  }
}

function resultOverlay(
  frame: Pick<LayoutRun, 'lengthM' | 'yarderAtEnd'>,
  settings: CableSupportLayout,
  result: CableLayoutResult | null,
): CableLayoutOverlay {
  const x = (s: number) => chartDistance(frame, s)
  const sectors = settings.noSupportSectors.map((r) => {
    const [a, b] = [x(r.fromM), x(r.toM)]
    return [Math.min(a, b), Math.max(a, b)] as [number, number]
  })
  const fixed = settings.fixedSupports.map((f) => ({ x: x(f.stationM), heightM: f.heightM }))
  if (!result || result.supports.length === 0)
    return { loadPath: [], emptyRope: [], supports: [], fixed, sectors, peaks: [], summary: null }
  const order = (a: { x: number }, b: { x: number }) => a.x - b.x
  const middle = new Set(intermediateSupports(result))
  let number = 0
  const supports = result.supports.map((s, i) => ({
    x: x(s.stationM),
    ground: s.groundM,
    top: s.groundM + s.heightM,
    kind: s.kind,
    label: middle.has(s)
      ? String(++number)
      : s.kind === 'yarder'
        ? 'Y'
        : s.kind === 'anchor' || s.kind === 'ground-anchor'
          ? 'A'
          : i === 0 || result.supports[i - 1].kind === 'anchor'
            ? 'S'
            : 'E',
  }))
  const intermediate = middle.size
  const summary =
    `${result.status === 'complete' ? 'Layout' : 'Partial layout'} · ${intermediate} support${intermediate === 1 ? '' : 's'}` +
    ` · pre-tension ${n0(result.preTensionKN)} kN · min clearance ${n1(result.minClearanceM)} m` +
    ` · max tension ${n0(result.maxTensionKN)} of ${n0(result.allowableKN)} kN${result.tensionOk ? '' : ' (exceeded)'}`
  return {
    loadPath: result.samples.map((p) => ({ x: x(p.stationM), z: p.loadM, ground: p.groundM })).sort(order),
    emptyRope: result.samples.map((p) => ({ x: x(p.stationM), z: p.emptyM })).sort(order),
    supports,
    fixed,
    sectors,
    peaks: result.peaksM.map(x),
    summary,
  }
}
