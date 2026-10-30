/** Evaluates prepared ground and ordered section additions. No renderer, network or DOM state. */
import { sectionCrossfall, sideValue } from './templates'
import type { Alignment, RoadStation, RoadTemplate, SectionSample } from './types'
import { featureSectionAnchor, type SectionReferenceSources } from './sectionReferences'
import { acceptsFill } from './allocationPolicy'

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
>
const EPS = 1e-7
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
    step = Math.min(0.25, Math.max(0.05, halfWidth / 400))
  const preparation = (e?.sitePreparation ?? []).filter(
    (p) => p.depthM > 0 && assignmentStation >= p.start && assignmentStation < p.end - EPS,
  )
  const components = t.components ?? []
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
  const materialSlope = (x: number, level: number, cut: boolean, side: 'left' | 'right') => {
    if (cut) {
      const g = ground(x),
        depth = g === null ? -1 : g - level
      const horizon = e?.strata.find(
        (h) =>
          assignmentStation >= h.start &&
          assignmentStation < h.end - EPS &&
          depth >= h.topDepthM - EPS &&
          (h.bottomDepthM === null || depth < h.bottomDepthM - EPS),
      )
      const slope = e?.materials.find((m) => m.id === horizon?.materialId)?.cutSlope
      return slope ?? sideValue(t, side, 'CutSlope')
    }
    const requirement = e?.fillRequirements?.find(
      (r) => r.layer === 'subgrade' && assignmentStation >= r.start && assignmentStation < r.end - EPS,
    )
    if (requirement?.replaceable) {
      const slopes = (e?.materials ?? [])
        .filter((m) => m.purpose !== 'stripping' && acceptsFill(m.id, requirement, e!.materials))
        .map((m) => m.fillSlope ?? sideValue(t, side, 'FillSlope'))
      return slopes.length ? Math.max(...slopes) : sideValue(t, side, 'FillSlope')
    }
    return e?.materials.find((m) => m.id === requirement?.materialId)?.fillSlope ?? sideValue(t, side, 'FillSlope')
  }
  const makeSide = (sign: number, width: number): Side => {
    const name = sign < 0 ? 'left' : 'right',
      crossfall = sectionCrossfall(t, name, curve)
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
    if (name === 'left' && depth > 0)
      for (const c of e?.culverts ?? [])
        if (c.ditchDipPercent && c.inletInvertM !== null)
          depth = Math.max(
            depth,
            Math.min(
              ditchDipLimit,
              edgeZ - c.inletInvertM - (Math.abs(chainage - c.chainage) * c.ditchDipPercent) / 100,
            ),
          )
    const ditchWidth = sideValue(t, name, 'DitchWidth')
    if (cutAtEdge && ditchWidth > 0 && depth > 0) {
      const bottom = Math.min(ditchWidth, sideValue(t, name, 'DitchBottomWidth')),
        run = (ditchWidth - bottom) / 2
      if (run > EPS) points.push({ x: width + run, z: edgeZ - depth })
      points.push({ x: width + ditchWidth / 2, z: edgeZ - depth, code: `${name}-ditch-bottom` })
      if (bottom > EPS) points.push({ x: width + run + bottom, z: edgeZ - depth })
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
    let a = points[points.length - 1],
      ga = constructionGround(sign * a.x)
    if (a.x > halfWidth || ga === null) return { sign, width, daylight: null, points, reached: a.x > halfWidth }
    if (Math.abs(ga - a.z) < EPS) return { sign, width, daylight: a.x, points, reached: false }
    const cut = ga > a.z
    while (a.x < halfWidth - EPS) {
      let x = Math.min(halfWidth, a.x + step)
      const firstSlope = (cut ? 1 : -1) / materialSlope(sign * a.x, a.z, cut, name)
      // Probe just beyond an exact horizon boundary so the next segment takes the next material.
      const slope = (cut ? 1 : -1) / materialSlope(sign * (a.x + 1e-5), a.z + firstSlope * 1e-5, cut, name)
      if (cut) {
        const g0 = ground(sign * a.x),
          g1 = ground(sign * x)
        if (g0 !== null && g1 !== null) {
          const d0 = g0 - a.z,
            d1 = g1 - (a.z + slope * (x - a.x))
          const boundaries = (e?.strata ?? [])
            .filter((h) => assignmentStation >= h.start && assignmentStation < h.end - EPS)
            .flatMap((h) => (h.bottomDepthM === null ? [h.topDepthM] : [h.topDepthM, h.bottomDepthM]))
            .filter((depth) => Math.abs(d0 - depth) > 1e-6 && (d0 - depth) * (d1 - depth) < 0)
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
        }
      }
      const level = a.z + slope * (x - a.x),
        gb = constructionGround(sign * x)
      if (gb === null) return { sign, width, daylight: null, points, reached: false }
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
        keyWarnings.add(
          `${c.name}: requested key extends outside the constructed section footprint; revise its width or offset`,
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
  const flags: string[] = [...referenceWarnings, ...keyWarnings]
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
  let complete = z !== null && left.daylight !== null && right.daylight !== null && converged && keyWarnings.size === 0
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
      for (const horizon of e?.strata ?? [])
        if (assignmentStation >= horizon.start && assignmentStation < horizon.end - EPS) {
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
  return {
    section,
    cutAreaM2: complete ? Math.max(0, cut) : null,
    fillAreaM2: complete ? Math.max(0, fill) : null,
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
