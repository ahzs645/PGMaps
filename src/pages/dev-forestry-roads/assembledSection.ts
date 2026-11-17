/** Evaluates prepared ground and ordered section additions. No renderer, network or DOM state. */
import { culvertInletSide } from './culverts/culvertInlet'
import { sectionCrossfall, sideValue } from './templates'
import type { Alignment, RoadStation, RoadTemplate, SectionSample } from './types'
import { featureSectionAnchor, type SectionReferenceSources } from './sectionReferences'
import { acceptsFill } from './allocationPolicy'
import { horizonTopDepth, resolveHorizons, rockIntervals } from './groundHorizons'
import { rockCutAt } from './rockExcavation'
import { batterSource } from './groundBatters'
import {
  barriersAt,
  benchesAt,
  courseStack,
  DEFAULT_BENCH_COUNT,
  ditchRuns,
  ditchInslopeAt,
  subCutAt,
  wallsAt,
  type SectionWall,
  type StationStructure,
} from './sectionStructures'

type XY = { x: number; z: number; code?: string }
type Region = {
  start: number
  end: number
  depth: number
  materialId?: string
  purpose: 'stripping' | 'earthwork'
  keyId?: string
}
type Side = { sign: number; width: number; daylight: number | null; points: XY[]; reached: boolean }
export type AssembledSection = Pick<
  RoadStation,
  | 'section'
  | 'cutAreaM2'
  | 'fillAreaM2'
  | 'leftDaylightM'
  | 'rightDaylightM'
  | 'complete'
  | 'flags'
  | 'preparationAreas'
  | 'componentAreas'
  | 'componentPoints'
  | 'clearingWidthM'
  | 'leftClearingM'
  | 'rightClearingM'
  | 'structures'
>
const EPS = 1e-7
/** The least a cut batter's step moves on after a horizon-boundary search, so a step never stands still. */
const MIN_BATTER_ADVANCE_M = 1e-6
/** Design-line breaks and the given offsets lying strictly inside (from, to), for sampling a region's corners. */
const breaksWithin = (points: XY[], extra: number[], from: number, to: number) =>
  [...points.map((p) => p.x), ...extra].filter((x) => x > from + EPS && x < to - EPS)

const interpolate = (points: XY[], x: number) => {
  if (x < points[0].x - EPS || x > points[points.length - 1].x + EPS) return null
  for (let i = 1; i < points.length; i++)
    if (x <= points[i].x + EPS) {
      const a = points[i - 1],
        b = points[i]
      return a.z + (b.z - a.z) * Math.max(0, Math.min(1, (x - a.x) / (b.x - a.x)))
    }
  return points[points.length - 1].z
}

export function assembledSection({
  alignment,
  template: t,
  chainage,
  elevation: z,
  leftWidth,
  rightWidth,
  halfWidth,
  ground,
  curve,
  ditchDipLimit,
  coordinate,
  heading,
  references,
  surfaceAt,
  assignmentStation = chainage,
}: {
  alignment: Alignment
  template: RoadTemplate
  chainage: number
  elevation: number | null
  leftWidth: number
  rightWidth: number
  halfWidth: number
  ground: (offset: number) => number | null
  curve: { inside: 'left' | 'right'; superPercent: number; ratio: number } | null
  ditchDipLimit: number
  coordinate: [number, number]
  heading: number
  references?: SectionReferenceSources
  surfaceAt: (id: string, offset: number) => number | null
  assignmentStation?: number
}): AssembledSection {
  const e = alignment.engineering,
    step = Math.min(0.25, Math.max(0.05, halfWidth / 400)),
    maxBatterSteps = 20 * Math.ceil(halfWidth / step) + 1000
  const components = t.components ?? []
  // One non-overlapping material column for this station: a later horizon replaces an earlier one.
  const horizons = resolveHorizons(
    (e?.strata ?? []).filter((h) => assignmentStation >= h.start && assignmentStation < h.end - EPS),
  )
  // A range that removes ground "to" a material takes the depth of that material's top here. Without
  // that horizon at this station the depth is unknown, never zero: the section stays incomplete.
  const unknownPreparation: string[] = []
  const preparation = (e?.sitePreparation ?? [])
    .filter((p) => assignmentStation >= p.start && assignmentStation < p.end - EPS)
    .flatMap((p) => {
      if (p.removeToMaterialId === undefined) return [p]
      const depthM = horizonTopDepth(horizons, p.removeToMaterialId)
      if (depthM === null) {
        const name = e?.materials.find((m) => m.id === p.removeToMaterialId)?.name ?? 'the chosen material'
        unknownPreparation.push(
          `Stripping to ${name}: no ${name} horizon at this station, so the removal depth is unknown`,
        )
        return []
      }
      return [{ ...p, depthM }]
    })
    .filter((p) => p.depthM > 0)
  // Where a cut batter climbs out of rock into the ground above it, a rock ledge may be cut.
  const rockTops = rockIntervals(horizons, (id) => !!e?.materials.find((m) => m.id === id)?.rock)
    .map((r) => r.topDepthM)
    .filter((depth) => depth > EPS)
  const referenceWarnings = new Set<string>()
  const anchors = new Map<string, ReturnType<typeof featureSectionAnchor>>()
  const componentRanges = new Map<
    string,
    { id: string; name: string; materialId?: string; start: number; end: number }
  >()
  let regions: Region[] = []
  const regionAt = (x: number, r: Region) => x >= r.start - EPS && x <= r.end + EPS
  const prepared = (x: number) => {
    const g = ground(x)
    const active = regions.filter((r) => regionAt(x, r))
    return g === null
      ? null
      : g -
          Math.max(0, ...active.filter((r) => r.purpose === 'stripping').map((r) => r.depth)) -
          active.filter((r) => r.purpose === 'earthwork').reduce((sum, r) => sum + r.depth, 0)
  }
  // Foundation keys are excavated and refilled beneath the designed prism. Their bottoms do
  // not become a false above-ground toe/ditch intersection at a trench's vertical boundary.
  const constructionGround = (x: number) => {
    const g = ground(x)
    return g === null
      ? null
      : g - Math.max(0, ...regions.filter((r) => r.purpose === 'stripping' && regionAt(x, r)).map((r) => r.depth))
  }
  // Where each batter comes from (`groundBatters.ts`): `template` keeps the stated slope, `material`
  // is RoadEng's AUTO, and omitted is the material-where-it-has-one rule.
  const materialSlope = (x: number, level: number, cut: boolean, side: 'left' | 'right') => {
    const from = batterSource(t, side, cut ? 'cut' : 'fill')
    if (cut) {
      const g = ground(x),
        depth = g === null ? -1 : g - level
      const horizon = horizons.find(
        (h) => depth >= h.topDepthM - EPS && (h.bottomDepthM === null || depth < h.bottomDepthM - EPS),
      )
      const material = e?.materials.find((m) => m.id === horizon?.materialId)
      // A rock material without a batter of its own takes the template's rock batter.
      const own = from === 'template' ? undefined : material?.cutSlope
      const slope = own ?? (material?.rock ? rockCutAt(t, side)?.cutSlope : undefined)
      return slope ?? sideValue(t, side, 'CutSlope')
    }
    if (from === 'template') return sideValue(t, side, 'FillSlope')
    const requirement = e?.fillRequirements?.find(
      (r) => r.layer === 'subgrade' && assignmentStation >= r.start && assignmentStation < r.end - EPS,
    )
    if (requirement?.replaceable) {
      const slopes = (e?.materials ?? [])
        .filter((m) => m.purpose !== 'stripping' && acceptsFill(m.id, requirement, e!.materials))
        .map((m) => m.fillSlope ?? sideValue(t, side, 'FillSlope'))
      return slopes.length ? Math.max(...slopes) : sideValue(t, side, 'FillSlope')
    }
    // AUTO fill with no fill material assigned takes the top horizon's (RoadEng's stratum layer 1).
    const fillMaterial = requirement || from !== 'material' ? requirement?.materialId : horizons[0]?.materialId
    return e?.materials.find((m) => m.id === fillMaterial)?.fillSlope ?? sideValue(t, side, 'FillSlope')
  }
  // Walls found while building each side, with what their bodies add to the cut and take from the fill.
  type WallBackfillAt = { wall: SectionWall; heel: number; z0: number; height: number }
  const sideStructures = {
    left: { walls: [] as StationStructure[], cutM2: 0, fillM2: 0, backfills: [] as WallBackfillAt[] },
    right: { walls: [] as StationStructure[], cutM2: 0, fillM2: 0, backfills: [] as WallBackfillAt[] },
  }
  const makeSide = (sign: number, width: number): Side => {
    const name = sign < 0 ? 'left' : 'right',
      crossfall = sectionCrossfall(t, name, curve)
    const extra: (typeof sideStructures)['left'] = { walls: [], cutM2: 0, fillM2: 0, backfills: [] }
    sideStructures[name] = extra
    for (const c of components) if (c.side === name) componentRanges.delete(c.id)
    const edgeZ = (z ?? NaN) - (width * crossfall) / 100
    const points: XY[] = [
      { x: 0, z: z ?? NaN },
      { x: width, z: edgeZ, code: `${name}-formation-edge` },
    ]
    if (z === null) return { sign, width, daylight: null, points, reached: false }
    const edgeGround = constructionGround(sign * width),
      cutAtEdge = edgeGround !== null && edgeGround > edgeZ + EPS
    let depth = sideValue(t, name, 'DitchDepth')
    if (depth > 0)
      for (const c of e?.culverts ?? [])
        if (c.ditchDipPercent && c.inletInvertM !== null && culvertInletSide(c) === name)
          depth = Math.max(
            depth,
            Math.min(
              ditchDipLimit,
              edgeZ - c.inletInvertM - (Math.abs(chainage - c.chainage) * c.ditchDipPercent) / 100,
            ),
          )
    const ditchWidth = sideValue(t, name, 'DitchWidth')
    if (cutAtEdge && ditchWidth > 0 && depth > 0) {
      // The inslope and backslope keep their runs when a culvert dip deepens the ditch.
      const { inRun, bottom } = ditchRuns(
        ditchWidth,
        sideValue(t, name, 'DitchDepth'),
        sideValue(t, name, 'DitchBottomWidth'),
        ditchInslopeAt(t, name),
      )
      if (inRun > EPS) points.push({ x: width + inRun, z: edgeZ - depth })
      points.push({ x: width + inRun + bottom / 2, z: edgeZ - depth, code: `${name}-ditch-bottom` })
      if (bottom > EPS) points.push({ x: width + inRun + bottom, z: edgeZ - depth })
      points.push({ x: width + ditchWidth, z: edgeZ })
    }
    for (const c of components.filter(
      (c) => c.side === name && c.kind !== 'key' && (c.condition === 'always' || (c.condition === 'cut') === cutAtEdge),
    )) {
      const previous = points[points.length - 1]
      let x = previous.x + c.widthM,
        level: number | null = previous.z + c.riseM
      if (c.referenceFeatureId) {
        const key = `${name}:${c.referenceFeatureId}`
        if (!anchors.has(key)) {
          const feature = references?.context?.find((f) => f.id === c.referenceFeatureId)
          anchors.set(
            key,
            feature
              ? featureSectionAnchor(feature, coordinate, heading, name, references?.referenceBudget ?? { checks: 0 })
              : null,
          )
        }
        const anchor = anchors.get(key)
        if (!anchor) {
          referenceWarnings.add(
            `${c.name}: reference feature ${c.referenceFeatureId} does not intersect this side of the section`,
          )
          return { sign, width, daylight: null, points, reached: false }
        }
        const feature = references?.context?.find((f) => f.id === c.referenceFeatureId)
        if (
          anchor.elevation !== null &&
          !c.referenceSurfaceId &&
          (!feature?.referenceVerticalDatum ||
            !references?.verticalReference ||
            feature.referenceVerticalDatum !== references.verticalReference)
        ) {
          referenceWarnings.add(
            `${c.name}: reference feature ${c.referenceFeatureId} needs a matching vertical datum or an explicit reference surface`,
          )
          return { sign, width, daylight: null, points, reached: false }
        }
        x = Math.abs(anchor.offset) + (c.referenceOffsetM ?? 0)
        level = anchor.elevation ?? prepared(sign * x)
      } else if (c.referenceSurfaceId) x += c.referenceOffsetM ?? 0
      if (c.referenceSurfaceId)
        level =
          c.referenceSurfaceId === 'original-ground'
            ? ground(sign * x)
            : c.referenceSurfaceId === 'prepared-ground'
              ? prepared(sign * x)
              : surfaceAt(c.referenceSurfaceId, sign * x)
      if (c.referenceFeatureId || c.referenceSurfaceId)
        level = level === null ? null : level + (c.referenceElevationM ?? 0)
      if (level === null || x <= previous.x + EPS || !Number.isFinite(level)) {
        referenceWarnings.add(
          `${c.name}: reference ${c.referenceSurfaceId ?? c.referenceFeatureId ?? 'endpoint'} is unavailable or does not advance outward from the previous component`,
        )
        return { sign, width, daylight: null, points, reached: false }
      }
      if (c.widthM > EPS) {
        points.push({ x, z: level, code: c.code ?? `${name}-${c.kind}-${c.id}` })
        componentRanges.set(c.id, {
          id: c.id,
          name: c.name,
          materialId: c.materialId,
          start: sign < 0 ? -x : previous.x,
          end: sign < 0 ? -previous.x : x,
        })
      }
    }
    // Walls: a cut wall where the side is in cut, a fill wall where it is in fill (`sectionStructures.ts`).
    for (const w of wallsAt(t, name)) {
      const p = points[points.length - 1],
        g = constructionGround(sign * p.x)
      if (g === null || p.x > halfWidth || (w.kind === 'cut') !== g > p.z + EPS) continue
      const face = w.faceSlope ?? 0,
        thick = w.thicknessM,
        z0 = p.z,
        xf = p.x + (w.setbackM ?? 0),
        // A vertical face still advances a millimetre, so the design line stays a function of offset.
        run = (h: number) => Math.max(h * face, 1e-3)
      if (xf > p.x + EPS) points.push({ x: xf, z: z0 })
      const lineX = (h: number) => (w.kind === 'cut' ? xf + thick + run(h) : xf + run(h)),
        lineZ = (h: number) => (w.kind === 'cut' ? z0 + h : z0 - h)
      if (lineX(w.heightM) > halfWidth) return { sign, width, daylight: null, points, reached: true }
      // How far the ground lies past the wall's line at height h: positive while the wall is still
      // below a cut's ground or above a fill's.
      const gap = (h: number) => {
        const gh = constructionGround(sign * lineX(h))
        return gh === null ? null : w.kind === 'cut' ? gh - lineZ(h) : lineZ(h) - gh
      }
      if (w.kind === 'cut') points.push({ x: xf + thick, z: z0, code: `${name}-wall-heel` })
      let height = w.heightM
      const top = gap(w.heightM)
      if (top === null) return { sign, width, daylight: null, points, reached: false }
      if (top <= 0) {
        let lo = 0,
          hi = w.heightM
        for (let n = 0; n < 30; n++) {
          const mid = (lo + hi) / 2,
            d = gap(mid)
          if (d === null) return { sign, width, daylight: null, points, reached: false }
          if (d > 0) lo = mid
          else hi = mid
        }
        height = (lo + hi) / 2
      }
      const embed = w.kind === 'fill' ? (w.embedM ?? 0) : 0
      // A fill wall under a cover starts that far below the formation edge; the road's fill lies over it.
      const cover = w.kind === 'fill' ? Math.min(height, w.coverHeightM ?? 0) : 0
      const outline: [number, number][] =
        w.kind === 'cut'
          ? [
              [xf, z0],
              [xf + thick, z0],
              [lineX(height), z0 + height],
              [xf + run(height), z0 + height],
            ]
          : [
              [xf + run(cover) - thick, z0 - cover],
              [xf + run(cover), z0 - cover],
              [xf + run(height + embed), z0 - height - embed],
              [xf + run(height + embed) - thick, z0 - height - embed],
            ]
      extra.walls.push({
        id: w.id,
        name: w.name,
        kind: w.kind === 'cut' ? 'cut-wall' : 'fill-wall',
        side: name,
        areaM2: thick * (height - cover + embed),
        heightM: height - cover,
        outline: outline.map(([x, z]) => [sign * x, z]),
      })
      // A fill wall's body replaces fill above the ground; its embedded base is dug below it.
      if (w.kind === 'fill') {
        extra.fillM2 += thick * (height - cover)
        extra.cutM2 += thick * embed
      }
      if (w.kind === 'cut' && w.backfill) extra.backfills.push({ wall: w, heel: xf + thick, z0, height })
      if (height < w.heightM - 1e-6) {
        points.push({ x: lineX(height), z: lineZ(height), code: `${name}-daylight` })
        return { sign, width, daylight: lineX(height), points, reached: false }
      }
      points.push({ x: lineX(height), z: lineZ(height), code: `${name}-wall-${w.kind === 'cut' ? 'top' : 'foot'}` })
    }
    let a = points[points.length - 1],
      ga = constructionGround(sign * a.x)
    if (a.x > halfWidth || ga === null) return { sign, width, daylight: null, points, reached: a.x > halfWidth }
    if (Math.abs(ga - a.z) < EPS) return { sign, width, daylight: a.x, points, reached: false }
    const cut = ga > a.z
    const ledge = cut ? (rockCutAt(t, name)?.ledgeWidthM ?? 0) : 0
    // Benches on this batter: a face of the bench height, a bench, repeated (`sectionStructures.ts`).
    const bench = benchesAt(t, name, cut ? 'cut' : 'fill')
    const benchLimit = bench ? (bench.count ?? DEFAULT_BENCH_COUNT) : 0
    let benches = 0,
      faceFrom = a.z,
      steps = 0
    while (a.x < halfWidth - EPS) {
      // A backstop that never binds on real ground: each step advances (below), and horizon
      // boundaries and benches split a step only a few times. Past it the section stays incomplete.
      if (++steps > maxBatterSteps) return { sign, width, daylight: null, points, reached: false }
      let x = Math.min(halfWidth, a.x + step)
      const firstSlope = (cut ? 1 : -1) / materialSlope(sign * a.x, a.z, cut, name)
      // Probe just beyond an exact horizon boundary so the next segment takes the next material.
      const benched = bench && benches < benchLimit ? bench : undefined
      const slope =
        benched?.faceSlope !== undefined
          ? (cut ? 1 : -1) / benched.faceSlope
          : (cut ? 1 : -1) / materialSlope(sign * (a.x + 1e-5), a.z + firstSlope * 1e-5, cut, name)
      // The face ends at the bench height: stop the step there.
      if (benched) {
        const toBreak = a.x + (benched.heightM - Math.abs(a.z - faceFrom)) / Math.abs(slope)
        if (toBreak < x) x = Math.max(a.x + 1e-9, toBreak)
      }
      if (cut) {
        const g0 = ground(sign * a.x),
          g1 = ground(sign * x)
        if (g0 !== null && g1 !== null) {
          const d0 = g0 - a.z,
            d1 = g1 - (a.z + slope * (x - a.x))
          // One horizon's bottom is the next one's top: each depth is searched once.
          const boundaries = [
            ...new Set(
              horizons.flatMap((h) => (h.bottomDepthM === null ? [h.topDepthM] : [h.topDepthM, h.bottomDepthM])),
            ),
          ].filter((depth) => Math.abs(d0 - depth) > 1e-6 && (d0 - depth) * (d1 - depth) < 0)
          const stepEnd = x
          for (const depth of boundaries) {
            let lo = a.x,
              hi = x
            for (let n = 0; n < 25; n++) {
              const mid = (lo + hi) / 2,
                gm = ground(sign * mid)
              if (gm === null) break
              const dm = gm - (a.z + slope * (mid - a.x)) - depth
              if ((d0 - depth) * dm <= 0) hi = mid
              else lo = mid
            }
            x = (lo + hi) / 2
          }
          // Ground that steps across a boundary (a TIN edge read a hair apart) pins the crossing to
          // the step's start: move on by a micrometre rather than stand still and grow without end.
          if (x - a.x < MIN_BATTER_ADVANCE_M) x = Math.min(stepEnd, a.x + MIN_BATTER_ADVANCE_M)
        }
      }
      const level = a.z + slope * (x - a.x),
        gb = constructionGround(sign * x)
      if (gb === null) return { sign, width, daylight: null, points, reached: false }
      // The batter rises out of rock here: the step ended on the top of rock, coming up from below it.
      const leaving =
        ledge > EPS && gb > level + EPS
          ? rockTops.find((depth) => {
              const g0 = ground(sign * a.x),
                g1 = ground(sign * x)
              return g0 !== null && g1 !== null && g0 - a.z > depth + 1e-6 && Math.abs(g1 - level - depth) < 1e-5
            })
          : undefined
      if ((ga - a.z) * (gb - level) <= 0) {
        let lo = a.x,
          hi = x,
          dlo = ga - a.z
        for (let n = 0; n < 25; n++) {
          const mid = (lo + hi) / 2,
            gm = constructionGround(sign * mid)
          if (gm === null) return { sign, width, daylight: null, points, reached: false }
          const d = gm - (a.z + slope * (mid - a.x))
          if (dlo * d <= 0) hi = mid
          else {
            lo = mid
            dlo = d
          }
        }
        const daylight = (lo + hi) / 2
        points.push({ x: daylight, z: a.z + slope * (daylight - a.x), code: `${name}-daylight` })
        return { sign, width, daylight, points, reached: false }
      }
      a = { x, z: level }
      ga = gb
      points.push(a)
      if (benched && Math.abs(a.z - faceFrom) >= benched.heightM - 1e-7) {
        // A bench of its width at its fall, ending at the ground where it meets it.
        benches++
        a.code = `${name}-bench-${benches}-start`
        const fall = (benched.benchFallPercent ?? 0) / 100,
          from = a.x,
          z0 = a.z,
          end = from + benched.widthM
        const zAt = (u: number) => z0 - fall * (u - from)
        let u = from,
          lastGap = ga - z0
        while (u < end - EPS) {
          const next = Math.min(end, u + step)
          if (next > halfWidth + EPS) return { sign, width, daylight: null, points, reached: true }
          const gn = constructionGround(sign * next)
          if (gn === null) return { sign, width, daylight: null, points, reached: false }
          const gapNext = gn - zAt(next)
          if (lastGap * gapNext <= 0) {
            let lo = u,
              hi = next,
              dlo = lastGap
            for (let n = 0; n < 25; n++) {
              const mid = (lo + hi) / 2,
                gm = constructionGround(sign * mid)
              if (gm === null) return { sign, width, daylight: null, points, reached: false }
              const d = gm - zAt(mid)
              if (dlo * d <= 0) hi = mid
              else {
                lo = mid
                dlo = d
              }
            }
            const daylight = (lo + hi) / 2
            points.push({ x: daylight, z: zAt(daylight), code: `${name}-daylight` })
            return { sign, width, daylight, points, reached: false }
          }
          u = next
          lastGap = gapNext
          points.push({ x: u, z: zAt(u) })
        }
        a = points[points.length - 1]
        if (benched.widthM > EPS) a.code = `${name}-bench-${benches}-end`
        ga = constructionGround(sign * a.x)!
        faceFrom = a.z
        continue
      }
      if (leaving === undefined) continue
      // A ledge of the template's horizontal width along the rock surface, then the soil batter.
      a.code = `${name}-rock-cut-top`
      const end = x + ledge
      let u = x,
        lastGap = ga - a.z
      while (u < end - EPS) {
        const next = Math.min(end, u + step)
        if (next > halfWidth + EPS) return { sign, width, daylight: null, points, reached: true }
        const g = ground(sign * next),
          cg = constructionGround(sign * next)
        if (g === null || cg === null) return { sign, width, daylight: null, points, reached: false }
        const z = g - leaving,
          gap = cg - z
        if (gap <= EPS) {
          // Prepared ground drops to the ledge (stripping down to rock): that is where it daylights.
          let lo = u,
            hi = next,
            dlo = lastGap
          for (let n = 0; n < 25; n++) {
            const mid = (lo + hi) / 2,
              gm = ground(sign * mid),
              cm = constructionGround(sign * mid)
            if (gm === null || cm === null) return { sign, width, daylight: null, points, reached: false }
            const d = cm - (gm - leaving)
            if (dlo * d <= 0 || d <= EPS) hi = mid
            else {
              lo = mid
              dlo = d
            }
          }
          const daylight = (lo + hi) / 2,
            gd = ground(sign * daylight)!
          points.push({ x: daylight, z: gd - leaving, code: `${name}-daylight` })
          return { sign, width, daylight, points, reached: false }
        }
        u = next
        lastGap = gap
        points.push({ x: u, z })
      }
      points[points.length - 1].code = `${name}-rock-ledge`
      a = points[points.length - 1]
      ga = constructionGround(sign * a.x)!
    }
    return { sign, width, daylight: null, points, reached: true }
  }
  let left = makeSide(-1, leftWidth),
    right = makeSide(1, rightWidth),
    converged = preparation.length === 0
  const keys = components.filter((c) => c.kind === 'key' && (c.depthM ?? 0) > 0)
  const keyWarnings = new Set<string>()
  const nextRegions = () => {
    keyWarnings.clear()
    const result: Region[] = []
    for (const p of preparation) {
      const l = (left.daylight ?? halfWidth) + p.leftOutsideM,
        r = (right.daylight ?? halfWidth) + p.rightOutsideM
      if (l > p.leftInsideM)
        result.push({ start: -l, end: -p.leftInsideM, depth: p.depthM, materialId: p.materialId, purpose: 'stripping' })
      if (r > p.rightInsideM)
        result.push({ start: p.rightInsideM, end: r, depth: p.depthM, materialId: p.materialId, purpose: 'stripping' })
    }
    for (const c of keys) {
      const side = c.side === 'left' ? left : right,
        sign = side.sign,
        from = side.width + (c.offsetM ?? 0)
      const edge = sign * side.width,
        edgeOriginal = ground(edge),
        edgeStripping = Math.max(
          0,
          ...result.filter((r) => r.purpose === 'stripping' && regionAt(edge, r)).map((r) => r.depth),
        ),
        edgeDesign = interpolate(side.points, side.width)
      if (
        edgeOriginal !== null &&
        edgeDesign !== null &&
        c.condition !== 'always' &&
        (c.condition === 'cut') !== edgeOriginal - edgeStripping > edgeDesign + EPS
      )
        continue
      if (side.daylight === null || from + c.widthM > side.daylight + EPS) {
        // Say how much room there is, so the cure (a narrower key, or a shorter range) is plain.
        keyWarnings.add(
          side.daylight === null
            ? `${c.name}: the key cannot be placed because the batter does not reach ground here`
            : `${c.name}: the key reaches ${(from + c.widthM - side.width).toFixed(2)} m past the formation edge but the slope meets ground at ${Math.max(0, side.daylight - side.width).toFixed(2)} m; narrow the key or end its range before here`,
        )
        continue
      }
      const midpoint = sign * (from + c.widthM / 2),
        original = ground(midpoint)
      const stripDepth = Math.max(
        0,
        ...result.filter((r) => r.purpose === 'stripping' && regionAt(midpoint, r)).map((r) => r.depth),
      )
      const at = original === null ? null : original - stripDepth,
        design = interpolate(side.points, from + c.widthM / 2)
      if (at === null || design === null) {
        keyWarnings.add(`${c.name}: requested key has unavailable ground or design inside its footprint`)
        continue
      }
      const a = sign * from,
        b = sign * (from + c.widthM)
      result.push({ start: Math.min(a, b), end: Math.max(a, b), depth: c.depthM!, purpose: 'earthwork', keyId: c.id })
    }
    return result
  }
  for (let n = 0; n < 24 && (preparation.length || keys.length); n++) {
    const previous = [left.daylight, right.daylight],
      next = nextRegions()
    regions = next
    left = makeSide(-1, leftWidth)
    right = makeSide(1, rightWidth)
    converged = [left.daylight, right.daylight].every(
      (v, i) => v !== null && previous[i] !== null && Math.abs(v - previous[i]!) < 1e-5,
    )
    if (converged) break
  }
  const flags: string[] = [...referenceWarnings, ...keyWarnings, ...unknownPreparation]
  if (z === null) flags.push('Formation elevation unavailable')
  for (const [name, side] of [
    ['Left', left],
    ['Right', right],
  ] as const)
    if (side.daylight === null)
      flags.push(
        side.reached
          ? `${name} daylight unresolved: batter runs past the ${Number(halfWidth.toFixed(1))} m section reach`
          : `${name} daylight unresolved: extend section or check terrain`,
      )
  if (!converged) flags.push('Site preparation footprint did not converge; review section reach and stripping offsets')
  const offsets = [0, -halfWidth, halfWidth, ...left.points.map((p) => -p.x), ...right.points.map((p) => p.x)]
  for (let x = -halfWidth; x < halfWidth; x += step) offsets.push(x)
  for (const r of regions) for (const x of [r.start, r.end]) offsets.push(x - 1e-6, x, x + 1e-6)
  const sorted = [
    ...new Set(offsets.filter((x) => Math.abs(x) <= halfWidth).map((x) => Math.round(x * 1e9) / 1e9)),
  ].sort((a, b) => a - b)
  const hasPreparation = regions.length > 0
  const section: SectionSample[] = sorted.map((offset) => ({
    offset,
    ground: ground(offset),
    design: z === null ? null : interpolate(offset < 0 ? left.points : right.points, Math.abs(offset)),
    ...(hasPreparation ? { preparedGround: prepared(offset) } : {}),
  }))
  let complete =
    z !== null &&
    left.daylight !== null &&
    right.daylight !== null &&
    converged &&
    keyWarnings.size === 0 &&
    !unknownPreparation.length
  if (regions.some((r) => r.start < -halfWidth - EPS || r.end > halfWidth + EPS)) {
    complete = false
    flags.push(`Site preparation extends beyond the ${Number(halfWidth.toFixed(1))} m section reach`)
  }
  const inner = section.filter((p) => p.design !== null)
  if (inner.some((p) => p.ground === null || (hasPreparation && p.preparedGround === null))) {
    complete = false
    flags.push('Missing terrain inside the road footprint')
  }
  if (
    regions.some((r) => {
      for (let x = r.start; x <= r.end + EPS; x += step) if (ground(Math.min(x, r.end)) === null) return true
      return ground(r.end) === null
    })
  ) {
    complete = false
    flags.push('Missing terrain inside the site preparation footprint')
  }
  let cut = 0,
    fill = 0
  if (complete)
    for (let i = 1; i < inner.length; i++) {
      const a = inner[i - 1],
        b = inner[i],
        width = b.offset - a.offset
      const da = (a.preparedGround ?? a.ground)! - a.design!,
        db = (b.preparedGround ?? b.ground)! - b.design!
      if (da >= 0 && db >= 0) cut += ((da + db) * width) / 2
      else if (da <= 0 && db <= 0) fill -= ((da + db) * width) / 2
      else {
        const f = Math.abs(da) / (Math.abs(da) + Math.abs(db))
        cut += ((da > 0 ? da * f : db * (1 - f)) * width) / 2
        fill -= ((da < 0 ? da * f : db * (1 - f)) * width) / 2
      }
    }
  const preparationAreas: NonNullable<RoadStation['preparationAreas']> = []
  for (const r of regions) {
    if (r.purpose === 'stripping') {
      preparationAreas.push({
        materialId: r.materialId,
        purpose: 'stripping',
        areaM2: complete ? (r.end - r.start) * r.depth : 0,
      })
      continue
    }
    // A key excavates actual entered horizons, beneath any stripping already removed there.
    const cuts = [
      ...new Set([
        r.start,
        r.end,
        ...regions
          .filter((p) => p.purpose === 'stripping')
          .flatMap((p) => [Math.max(r.start, p.start), Math.min(r.end, p.end)])
          .filter((x) => x > r.start && x < r.end),
      ]),
    ].sort((a, b) => a - b)
    for (let i = 1; i < cuts.length; i++) {
      const x = (cuts[i] + cuts[i - 1]) / 2,
        width = cuts[i] - cuts[i - 1]
      const top = Math.max(0, ...regions.filter((p) => p.purpose === 'stripping' && regionAt(x, p)).map((p) => p.depth))
      let assigned = 0
      for (const horizon of horizons) {
        const depth = Math.max(
          0,
          Math.min(top + r.depth, horizon.bottomDepthM ?? Infinity) - Math.max(top, horizon.topDepthM),
        )
        if (depth > EPS) {
          const material = e?.materials.find((m) => m.id === horizon.materialId)
          preparationAreas.push({
            materialId: horizon.materialId,
            purpose: material?.purpose ?? 'earthwork',
            areaM2: complete ? width * depth : 0,
          })
          assigned += depth
        }
      }
      if (assigned < r.depth - EPS)
        preparationAreas.push({ purpose: 'earthwork', areaM2: complete ? width * (r.depth - assigned) : 0 })
    }
  }
  // A key is an excavated replacement volume, part of the subgrade fill above prepared ground.
  const componentAreas = regions
    .filter((r) => r.keyId)
    .map((r) => {
      const c = keys.find((c) => c.id === r.keyId)!
      let areaM2 = 0
      if (complete)
        for (let i = 1; i < inner.length; i++) {
          const a = inner[i - 1],
            b = inner[i],
            lo = Math.max(a.offset, r.start),
            hi = Math.min(b.offset, r.end)
          if (hi <= lo) continue
          const depth = (x: number) => {
            const f = (x - a.offset) / (b.offset - a.offset)
            return (
              a.design! +
              (b.design! - a.design!) * f -
              ((a.preparedGround ?? a.ground)! +
                ((b.preparedGround ?? b.ground)! - (a.preparedGround ?? a.ground)!) * f)
            )
          }
          const dl = depth(lo),
            dh = depth(hi),
            cuts = [lo, hi]
          for (const boundary of [0, r.depth])
            if ((dl - boundary) * (dh - boundary) < 0) cuts.push(lo + ((hi - lo) * (boundary - dl)) / (dh - dl))
          cuts.sort((a, b) => a - b)
          for (let n = 1; n < cuts.length; n++) {
            const clampDepth = (x: number) => Math.min(r.depth, Math.max(0, depth(x)))
            areaM2 += ((clampDepth(cuts[n - 1]) + clampDepth(cuts[n])) * (cuts[n] - cuts[n - 1])) / 2
          }
        }
      return { id: c.id, name: c.name, ...(c.materialId ? { materialId: c.materialId } : {}), areaM2 }
    })
  if (complete)
    for (const c of componentRanges.values()) {
      let areaM2 = 0
      for (let i = 1; i < inner.length; i++) {
        const a = inner[i - 1],
          b = inner[i],
          lo = Math.max(a.offset, c.start),
          hi = Math.min(b.offset, c.end)
        if (hi <= lo) continue
        const depth = (x: number) => {
          const f = (x - a.offset) / (b.offset - a.offset)
          const keyDepth = regions
            .filter((r) => r.purpose === 'earthwork' && regionAt(x, r))
            .reduce((sum, r) => sum + r.depth, 0)
          return (
            a.design! +
            (b.design! - a.design!) * f -
            ((a.preparedGround ?? a.ground)! +
              ((b.preparedGround ?? b.ground)! - (a.preparedGround ?? a.ground)!) * f) -
            keyDepth
          )
        }
        const da = depth(lo),
          db = depth(hi)
        if (da >= 0 && db >= 0) areaM2 += ((da + db) * (hi - lo)) / 2
        else if (da * db < 0) areaM2 += ((Math.max(da, db) ** 2 / (Math.abs(da) + Math.abs(db))) * (hi - lo)) / 2
      }
      if (areaM2 > EPS)
        componentAreas.push({ id: c.id, name: c.name, ...(c.materialId ? { materialId: c.materialId } : {}), areaM2 })
    }
  // Walls, sub-cuts and barriers (`sectionStructures.ts`).
  const structures: StationStructure[] = [...sideStructures.left.walls, ...sideStructures.right.walls]
  for (const name of ['left', 'right'] as const) {
    cut += sideStructures[name].cutM2
    fill -= sideStructures[name].fillM2
  }
  for (const [name, side] of [
    ['left', left],
    ['right', right],
  ] as const) {
    const sub = subCutAt(t, name)
    if (!sub || z === null || !(sub.widthM > EPS)) continue
    const top = (u: number) => {
      const d = interpolate(side.points, u)
      if (d === null) return null
      if (sub.reference === 'subgrade') return d
      const g = prepared(side.sign * u)
      return g === null ? null : Math.min(d, g)
    }
    // A straight bottom (`sectionStructures.ts`): the depth below the reference at the centreline,
    // at its own slope plus the road's crossfall where it follows it, reached down the inside slope.
    const straight =
      sub.bottomSlopePercent !== undefined || sub.followsCrossfall === false || sub.insideSlope !== undefined
    const ref0 = straight ? top(0) : null,
      edge = interpolate(side.points, side.width)
    const crossfall =
      ref0 !== null && edge !== null && side.width > EPS
        ? (edge - (interpolate(side.points, 0) ?? edge)) / side.width
        : 0
    const fall = (sub.bottomSlopePercent ?? 0) / 100 + (sub.followsCrossfall === false ? 0 : crossfall)
    const line = (u: number) => (ref0 ?? 0) - sub.depthM + fall * u
    const insideRun = Math.min(sub.widthM, sub.depthM * (sub.insideSlope ?? 0))
    const refAtWidth = straight ? top(sub.widthM) : null
    // How deep the bottom lies under the reference at the width, where the outside slope starts.
    const depthAtWidth = straight ? Math.max(0, (refAtWidth ?? line(sub.widthM)) - line(sub.widthM)) : sub.depthM
    const outer = sub.widthM + depthAtWidth * (sub.outsideSlope ?? 0)
    // The bottom lies the depth below the reference out to the width, then rises to it at the outside slope.
    const bottom = (u: number, ref: number) => {
      if (u > sub.widthM)
        return ref - depthAtWidth * Math.max(0, 1 - (u - sub.widthM) / Math.max(outer - sub.widthM, EPS))
      if (!straight) return ref - sub.depthM
      if (u < insideRun && ref0 !== null) return ref0 + ((line(insideRun) - ref0) * u) / insideRun
      return line(u)
    }
    const n = Math.max(8, Math.ceil(outer / step)),
      tops: [number, number][] = [],
      bottoms: [number, number][] = []
    // A straight bottom also samples its corners and the design line's breaks.
    const offsets = Array.from({ length: n + 1 }, (_, k) => (outer * k) / n)
    if (straight) offsets.push(...breaksWithin(side.points, [insideRun, sub.widthM], 0, outer))
    const us = straight ? [...new Set(offsets)].sort((a, b) => a - b) : offsets
    let areaM2 = 0,
      previous: number | null = null,
      previousU = 0,
      known = true
    for (const u of us) {
      const ref = top(u),
        g = prepared(side.sign * u)
      if (ref === null || g === null) {
        known = false
        break
      }
      const b = bottom(u, ref)
      tops.push([side.sign * u, ref])
      bottoms.push([side.sign * u, b])
      // Ground removed: what lies above the bottom and below the reference.
      const removed = Math.max(0, Math.min(g, ref) - b)
      if (previous !== null) areaM2 += ((previous + removed) * (u - previousU)) / 2
      previous = removed
      previousU = u
    }
    if (!known) {
      flags.push(`${sub.name}: missing ground or design inside the sub-cut`)
      complete = false
      continue
    }
    structures.push({
      id: sub.id,
      name: sub.name,
      kind: 'sub-cut',
      side: name,
      areaM2,
      heightM: sub.depthM,
      outline: [...tops, ...bottoms.reverse()],
    })
    // Dug out and refilled: the excavation is cut, the backfill fill, and a material demand when it names one.
    cut += areaM2
    fill += areaM2
    if (complete && areaM2 > EPS)
      componentAreas.push({
        id: sub.id,
        name: sub.name,
        ...(sub.materialId ? { materialId: sub.materialId } : {}),
        areaM2,
      })
  }
  // A cut wall's backfill: dug from its heel, level and then up its base slope to the cut surface,
  // and refilled to that surface or to the top slope from the wall's top (`sectionStructures.ts`).
  for (const [name, side] of [
    ['left', left],
    ['right', right],
  ] as const) {
    for (const { wall, heel, z0, height } of sideStructures[name].backfills) {
      const b = wall.backfill!
      const base = (u: number) =>
        u <= heel + b.offsetM ? z0 : b.baseSlope > EPS ? z0 + (u - heel - b.offsetM) / b.baseSlope : Infinity
      // The cut surface: the design line while it runs, the ground past its daylight.
      const surface = (u: number) => {
        const d = interpolate(side.points, u),
          g = prepared(side.sign * u)
        return g === null ? null : d === null ? g : Math.min(d, g)
      }
      const refillTop = (u: number, cutSurface: number) =>
        b.toGround ? cutSurface : Math.min(cutSurface, z0 + height + ((b.topSlopePercent ?? 0) / 100) * (u - heel))
      // Out to where the base meets the cut surface, at most the slope's reach over 30 m of height.
      const reach = heel + b.offsetM + Math.max(b.baseSlope, 0) * 30
      const n = Math.max(8, Math.ceil((reach - heel) / step))
      const us = [
        ...new Set([
          ...Array.from({ length: n + 1 }, (_, k) => heel + ((reach - heel) * k) / n),
          ...breaksWithin(side.points, [heel + b.offsetM], heel, reach),
        ]),
      ].sort((x, y) => x - y)
      let dug = 0,
        refilled = 0,
        known = true,
        last: [number, number, number] | null = null
      const tops: [number, number][] = [],
        bottoms: [number, number][] = []
      for (const [k, u] of us.entries()) {
        const top = surface(u)
        if (top === null) {
          known = false
          break
        }
        const bottom = Math.min(base(u), top)
        const d = top - bottom,
          r = Math.max(0, refillTop(u, top) - bottom)
        if (last) {
          // Where the base crosses the cut surface inside this step, only the part before it counts.
          const below = top - base(u)
          const du = (u - last[2]) * (below < 0 && last[0] > 0 ? last[0] / (last[0] - below) : 1)
          dug += ((last[0] + d) * du) / 2
          refilled += ((last[1] + r) * du) / 2
        }
        last = [d, r, u]
        tops.push([side.sign * u, top])
        bottoms.push([side.sign * u, bottom])
        if (k > 0 && d <= EPS) break
      }
      if (!known) {
        flags.push(`${wall.name}: missing ground or design behind the wall's backfill`)
        complete = false
        continue
      }
      if (!(dug > EPS)) continue
      structures.push({
        id: `${wall.id}-backfill`,
        name: `${wall.name} backfill`,
        kind: 'wall-backfill',
        side: name,
        areaM2: dug,
        heightM: height,
        outline: [...tops, ...bottoms.reverse()],
      })
      cut += dug
      fill += refilled
    }
  }
  // Barriers stand on the running surface: the design line raised by the courses there.
  for (const [name, side] of [
    ['left', left],
    ['right', right],
  ] as const) {
    const stack = courseStack(t.layers, name, side.width)
    for (const b of barriersAt(t, name)) {
      const inner = b.offsetM,
        outerEdge = b.offsetM + b.widthM
      const surface = (u: number) => {
        const d = interpolate(side.points, u)
        if (d === null) return null
        // The courses that reach this offset add their thickness.
        return d + stack.filter((c) => u <= c.topWidthM + EPS).reduce((sum, c) => sum + c.layer.depthM, 0)
      }
      const base = surface((inner + outerEdge) / 2)
      if (base === null) continue
      const narrow = b.kind === 'concrete' ? b.widthM * 0.35 : b.widthM
      const inset = (b.widthM - narrow) / 2
      structures.push({
        id: b.id,
        name: b.name,
        kind: 'barrier',
        side: name,
        areaM2: 0,
        heightM: b.heightM,
        outline: (
          [
            [inner, base],
            [outerEdge, base],
            [outerEdge - inset, base + b.heightM],
            [inner + inset, base + b.heightM],
          ] as [number, number][]
        ).map(([x, zz]) => [side.sign * x, zz]),
      })
    }
  }
  return {
    section,
    cutAreaM2: complete ? Math.max(0, cut) : null,
    fillAreaM2: complete ? Math.max(0, fill) : null,
    ...(structures.length ? { structures } : {}),
    leftDaylightM: left.daylight,
    rightDaylightM: right.daylight,
    complete,
    flags,
    clearingWidthM:
      Math.max(left.daylight ?? 0, ...regions.map((r) => Math.max(0, -r.start))) +
      Math.max(right.daylight ?? 0, ...regions.map((r) => Math.max(0, r.end))),
    leftClearingM: Math.max(left.daylight ?? 0, ...regions.map((r) => Math.max(0, -r.start))),
    rightClearingM: Math.max(right.daylight ?? 0, ...regions.map((r) => Math.max(0, r.end))),
    ...(hasPreparation ? { preparationAreas } : {}),
    ...(componentAreas.length ? { componentAreas } : {}),
    componentPoints: [...left.points.map((p) => ({ ...p, x: -p.x })), ...right.points]
      .filter((p) => p.code)
      .map((p) => ({ code: p.code!, offset: p.x, design: p.z })),
  }
}
