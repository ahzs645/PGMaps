/**
 * What the D-line profile draws for a support layout: the multi-span loaded path and empty rope,
 * supports, fixed supports, no-support sectors and convexity peaks, in the chart's own distance
 * (from the D-line's physical start). Pure.
 */
import { intermediateSupports, type CableLayoutResult, type LayoutSupportKind } from './cableLayout'
import { chartDistance, type CableSupportLayout, type LayoutRun } from './settings'

export interface CableLayoutOverlay {
  /** Loaded carriage path (with the ground under it) and empty rope, by chart distance. */
  loadPath: { x: number; z: number | null; ground: number | null }[]
  emptyRope: { x: number; z: number | null }[]
  supports: { x: number; ground: number; top: number; kind: LayoutSupportKind; label: string }[]
  fixed: { x: number; heightM?: number }[]
  sectors: [number, number][]
  peaks: number[]
  /** One line for the chart footer; null before a run. */
  summary: string | null
}

const n0 = (v: number | null) => (v === null ? '–' : Math.round(v).toLocaleString('en-CA'))
const n1 = (v: number | null) => (v === null ? '–' : v.toFixed(1))

export function layoutOverlay(
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
