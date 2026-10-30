import type { RoadSelectionRange } from './roadSelection'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChartViewport, SizedChart } from '@pgmaps/geo-toolkit/visualizations/react'
import { Button } from '@/components/ui/button'
import { AppSelect } from '@/components/ui/select'
import { Plus, Minus, RotateCcw } from 'lucide-react'
import { TerrainGround, type TerrainFace as Face } from './TerrainGround'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ROAD_CHART_COLORS, formatRoadStation } from './Charts'
import { sectionCodePoints, sectionSampleAt } from './sectionGeometry'
import { terrainMesh, cachedTerrainSampler, type TerrainVertex as Vertex } from './terrainMesh'
import type { Coordinate, RoadAnalysis, RoadStation, TerrainSource } from './types'

const NO_FACES: Face[] = []
const radians = Math.PI / 180
const radius = 6371008.8
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))
const finite = (value: number | null | undefined): value is number => value != null && Number.isFinite(value)
const interpolate = (a: Vertex, b: Vertex, t: number): Vertex => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
})

/** Clip preview overlays to the sampled ground window, retaining their elevations. */
function clipFace(vertices: Vertex[], bounds: number[]): Vertex[] {
  let result = vertices
  for (const [axis, boundary, minimum] of [
    ['x', bounds[0], true],
    ['x', bounds[2], false],
    ['y', bounds[1], true],
    ['y', bounds[3], false],
  ] as const) {
    const input = result
    result = []
    for (let i = 0; i < input.length; i++) {
      const a = input[(i + input.length - 1) % input.length],
        b = input[i]
      const aInside = minimum ? a[axis] >= boundary : a[axis] <= boundary
      const bInside = minimum ? b[axis] >= boundary : b[axis] <= boundary
      if (aInside !== bInside) result.push(interpolate(a, b, (boundary - a[axis]) / (b[axis] - a[axis])))
      if (bInside) result.push(b)
    }
  }
  return result
}
function clipLine(a: Vertex, b: Vertex, bounds: number[]): [Vertex, Vertex] | null {
  let first = 0,
    last = 1
  for (const [axis, low, high] of [
    ['x', bounds[0], bounds[2]],
    ['y', bounds[1], bounds[3]],
  ] as const) {
    const delta = b[axis] - a[axis]
    if (Math.abs(delta) < 1e-10) {
      if (a[axis] < low || a[axis] > high) return null
      continue
    }
    const p = (low - a[axis]) / delta,
      q = (high - a[axis]) / delta
    first = Math.max(first, Math.min(p, q))
    last = Math.min(last, Math.max(p, q))
    if (last < first) return null
  }
  return [interpolate(a, b, first), interpolate(a, b, last)]
}

/** Display-only local frame; analysis continues to use its own source sampler. */
function localFrame(origin: Coordinate) {
  const cos = Math.cos(origin[1] * radians)
  return {
    point: ([lng, lat]: Coordinate): [number, number] => [
      (lng - origin[0]) * radians * radius * cos,
      (lat - origin[1]) * radians * radius,
    ],
    coordinate: (x: number, y: number): Coordinate => [
      origin[0] + x / (radius * cos * radians),
      origin[1] + y / (radius * radians),
    ],
  }
}

function sampleSection(station: RoadStation, offset: number): number | null {
  return sectionSampleAt(station, offset).design
}

function sideways(station: RoadStation, offset: number, frame: ReturnType<typeof localFrame>): Vertex | null {
  const elevation = sampleSection(station, offset)
  if (!finite(elevation)) return null
  const [x, y] = frame.point(station.coordinate)
  const bearing = station.bearing * radians
  return { x: x + Math.cos(bearing) * offset, y: y - Math.sin(bearing) * offset, z: elevation }
}

function shade(a: Vertex, b: Vertex, c: Vertex) {
  const ux = b.x - a.x,
    uy = b.y - a.y,
    uz = b.z - a.z
  const vx = c.x - a.x,
    vy = c.y - a.y,
    vz = c.z - a.z
  let nx = uy * vz - uz * vy,
    ny = uz * vx - ux * vz,
    nz = ux * vy - uy * vx
  if (nz < 0) {
    nx = -nx
    ny = -ny
    nz = -nz
  }
  const magnitude = Math.hypot(nx, ny, nz) || 1
  const light = clamp((nx * -0.35 + ny * -0.45 + nz * 0.82) / magnitude, -0.5, 1)
  return `hsl(153 18% ${38 + light * 20}%)`
}

export function TerrainPreview({
  selectedRange,
  analysis,
  terrain,
  station,
  onStation,
  playing = false,
  terrainOnly = false,
  sourceLabel = 'Project terrain',
  selectedCulvertId,
  onSelectCulvert,
}: {
  selectedRange?: RoadSelectionRange
  analysis: RoadAnalysis
  terrain: TerrainSource
  station: number
  onStation: (chainage: number) => void
  playing?: boolean
  terrainOnly?: boolean
  sourceLabel?: string
  selectedCulvertId?: string
  onSelectCulvert?: (id: string) => void
}) {
  const [mode, setMode] = useState<'orbit' | 'follow'>('orbit')
  const [yaw, setYaw] = useState(28)
  const [pitch, setPitch] = useState(42)
  const [exaggeration, setExaggeration] = useState(1)
  const [wireframe, setWireframe] = useState(false)
  const [showEarthwork, setShowEarthwork] = useState(true)
  const [fillGaps, setFillGaps] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [wheelSvg, setWheelSvg] = useState<SVGSVGElement | null>(null)
  const dragFrame = useRef<number>()
  const pointerStart = useRef<[number, number]>()
  const drag = useRef<{
    x: number
    y: number
    yaw: number
    pitch: number
    panX: number
    panY: number
    panning: boolean
  } | null>(null)
  const resetCamera = () => {
    setYaw(28)
    setPitch(42)
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }
  useEffect(() => {
    if (!wheelSvg) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      setZoom((value) => clamp(value * Math.exp(-clamp(event.deltaY, -200, 200) * 0.0025), 0.35, 8))
    }
    wheelSvg.addEventListener('wheel', wheel, { passive: false })
    return () => wheelSvg.removeEventListener('wheel', wheel)
  }, [wheelSvg])
  useEffect(
    () => () => {
      if (dragFrame.current) cancelAnimationFrame(dragFrame.current)
    },
    [],
  )
  const cachedElevation = useMemo(() => {
    const frame = localFrame(analysis.stations[0]?.coordinate ?? [0, 0])
    return cachedTerrainSampler((x, y) => terrain.elevationAt(...frame.coordinate(x, y)))
  }, [analysis, terrain])
  const active = analysis.stations.reduce<RoadStation | undefined>(
    (best, candidate) =>
      !best || Math.abs(candidate.chainage - station) < Math.abs(best.chainage - station) ? candidate : best,
    undefined,
  )
  const followingStation = mode === 'follow' ? active : undefined
  const selectedCulvert = terrainOnly
    ? undefined
    : analysis.engineering?.culverts.find((c) => c.id === selectedCulvertId)
  const sourceGeometry = useMemo(() => {
    if (!analysis.stations.length) return null
    const origin = analysis.stations[0].coordinate
    const frame = localFrame(origin)
    const route = analysis.stations.map((s) => frame.point(s.coordinate))
    const east = route.map((p) => p[0]),
      north = route.map((p) => p[1])
    const routeX = Math.max(...east) - Math.min(...east),
      routeY = Math.max(...north) - Math.min(...north)
    const margin = Math.max(35, Math.max(routeX, routeY) * 0.13)
    let bounds = [
      Math.min(...east) - margin,
      Math.min(...north) - margin,
      Math.max(...east) + margin,
      Math.max(...north) + margin,
    ]
    if (followingStation) {
      const [x, y] = frame.point(followingStation.coordinate)
      bounds = [x - 120, y - 120, x + 120, y + 120]
    }
    // A coarse cell can have four valid corners around a real source gap.
    // Carry the analysis's missing samples into the display mesh as well.
    const missing: Array<[number, number]> = []
    for (const s of analysis.stations) {
      const [x, y] = frame.point(s.coordinate),
        bearing = s.bearing * radians
      if (!finite(s.groundElevation)) missing.push([x, y])
      for (const p of s.section)
        if (!finite(p.ground)) missing.push([x + Math.cos(bearing) * p.offset, y - Math.sin(bearing) * p.offset])
    }
    const mesh = terrainMesh(bounds, cachedElevation, missing, fillGaps)
    const ground: Face[] = [
      ...mesh.faces.map((vertices) => ({ vertices, fill: shade(vertices[0], vertices[1], vertices[2]) })),
      ...mesh.estimatedFaces.map((vertices) => ({
        vertices,
        fill: shade(vertices[0], vertices[1], vertices[2]),
        estimated: true,
      })),
    ]
    const step = Math.max(1, Math.ceil(analysis.stations.length / 180))
    const selected = analysis.stations.filter((_, i) => i % step === 0 || i === analysis.stations.length - 1)
    const road: Face[] = []
    const earthwork: Face[] = []
    const line: Array<{ vertex: Vertex | null; chainage: number; connected: boolean }> = []
    for (let i = 0; i < selected.length; i++) {
      const s = selected[i]
      const connected =
        i > 0 &&
        analysis.stations
          .slice(selected[i - 1].index, s.index + 1)
          .every((p) => (terrainOnly ? finite(p.groundElevation) : finite(p.designElevation)))
      const lineElevation = terrainOnly ? s.groundElevation : s.designElevation
      if (finite(lineElevation)) {
        const [x, y] = frame.point(s.coordinate)
        line.push({ vertex: { x, y, z: lineElevation }, chainage: s.chainage, connected })
      } else line.push({ vertex: null, chainage: s.chainage, connected: false })
    }
    for (let i = 1; !terrainOnly && i < selected.length; i++) {
      const a = selected[i - 1],
        b = selected[i]
      if (!finite(a.designElevation) || !finite(b.designElevation)) continue
      // A known design surface does not depend on ground coverage. Only unknown design
      // levels break the formation; batters below still require complete terrain sections.
      if (analysis.stations.slice(a.index, b.index + 1).some((s) => !finite(s.designElevation))) continue
      const leftA = sideways(a, -a.leftWidth, frame),
        rightA = sideways(a, a.rightWidth, frame)
      const leftB = sideways(b, -b.leftWidth, frame),
        rightB = sideways(b, b.rightWidth, frame)
      if (leftA && rightA && leftB && rightB) {
        const vertices = clipFace([leftA, rightA, rightB, leftB], bounds)
        if (vertices.length >= 3)
          road.push({
            vertices,
            fill: '#e8c886',
            station: (a.chainage + b.chainage) / 2,
            terrainGap: analysis.stations.slice(a.index, b.index + 1).some((s) => !finite(s.groundElevation)),
          })
      }
      if (analysis.stations.slice(a.index, b.index + 1).every((sample) => sample.complete)) {
        for (const side of [-1, 1]) {
          const edgeA = side < 0 ? -a.leftWidth : a.rightWidth
          const edgeB = side < 0 ? -b.leftWidth : b.rightWidth
          const daylightA = side < 0 ? (a.leftDaylightM === null ? null : -Math.abs(a.leftDaylightM)) : a.rightDaylightM
          const daylightB = side < 0 ? (b.leftDaylightM === null ? null : -Math.abs(b.leftDaylightM)) : b.rightDaylightM
          if (!finite(daylightA) || !finite(daylightB)) continue
          for (let part = 0; part < 6; part++) {
            const t0 = part / 6,
              t1 = (part + 1) / 6
            const face = [
              sideways(a, edgeA + (daylightA - edgeA) * t0, frame),
              sideways(a, edgeA + (daylightA - edgeA) * t1, frame),
              sideways(b, edgeB + (daylightB - edgeB) * t1, frame),
              sideways(b, edgeB + (daylightB - edgeB) * t0, frame),
            ]
            if (!face.every((vertex): vertex is Vertex => vertex !== null)) continue
            const vertices = clipFace(face, bounds)
            const midpoint = edgeA + ((daylightA - edgeA) * (t0 + t1)) / 2
            const sample = a.section.reduce(
              (best, value) => (Math.abs(value.offset - midpoint) < Math.abs(best.offset - midpoint) ? value : best),
              a.section[0],
            )
            if (vertices.length >= 3 && sample && finite(sample.ground) && finite(sample.design))
              earthwork.push({
                vertices,
                fill: sample.ground >= sample.design ? '#dca365' : '#79a9d9',
                station: (a.chainage + b.chainage) / 2,
              })
          }
        }
      }
    }
    const zValues = mesh.elevations
    const templates = new Map(analysis.engineering?.stations.map((s) => [s.chainage, s.template]))
    const ditchPoints = analysis.stations.map((s) => {
      const template = templates.get(s.chainage)
      return !terrainOnly && template ? sectionCodePoints(s, template) : []
    })
    const ditches = analysis.stations.slice(1).flatMap((b, index) => {
      const a = analysis.stations[index]
      return (['left', 'right'] as const).flatMap((side) => {
        const pa = ditchPoints[index].find((p) => p.code === `${side}-ditch-bottom`),
          pb = ditchPoints[index + 1].find((p) => p.code === `${side}-ditch-bottom`)
        if (!pa || !pb || !finite(pa.ground) || !finite(pb.ground) || !finite(pa.design) || !finite(pb.design))
          return []
        const va = sideways(a, pa.offset, frame),
          vb = sideways(b, pb.offset, frame)
        const clipped = va && vb ? clipLine(va, vb, bounds) : null
        return clipped ? [{ a: clipped[0], b: clipped[1], chainage: (a.chainage + b.chainage) / 2, side }] : []
      })
    })
    const medianZ = zValues.length ? [...zValues].sort((a, b) => a - b)[Math.floor(zValues.length / 2)] : 0
    return {
      frame,
      bounds,
      ground,
      road,
      earthwork,
      ditches,
      line,
      medianZ,
      low: zValues.length ? Math.min(...zValues) : 0,
      high: zValues.length ? Math.max(...zValues) : 0,
      meshSpacing: mesh.spacing,
      cells: ground.length,
      infilledCells: mesh.infilledCells,
      openGapCells: mesh.openGapCells,
    }
  }, [analysis, followingStation, terrainOnly, cachedElevation, fillGaps])

  return (
    <div
      className="relative flex h-full min-h-0 min-w-0 flex-col"
      data-testid="road-terrain-preview"
      data-station={active?.chainage ?? station}
      data-terrain-only={terrainOnly}
      data-zoom={zoom}
      data-infilled-cells={sourceGeometry?.infilledCells ?? 0}
      data-open-gap-cells={sourceGeometry?.openGapCells ?? 0}
      aria-label={`${sourceLabel} 3D preview`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 overflow-x-auto border-b px-2 py-1.5 [&>*]:shrink-0">
        <SegmentedControl
          value={mode}
          onChange={(value) => setMode(value as 'orbit' | 'follow')}
          options={[
            { value: 'orbit', label: 'Orbit' },
            { value: 'follow', label: 'Follow station' },
          ]}
          label="Terrain camera mode"
          size="sm"
          fullWidth={false}
        />
        {!terrainOnly && !!analysis.engineering?.culverts.length && (
          <label className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
            Structure
            <AppSelect
              triggerAriaLabel="3D structure"
              contentClassName="z-[1600] text-xs"
              triggerClassName="h-7 max-w-48 text-xs"
              value={selectedCulvert?.id ?? ''}
              options={[
                { value: '', label: 'Select a culvert', disabled: true },
                ...(analysis.engineering?.culverts ?? []).map((culvert) => ({
                  value: culvert.id,
                  label: `${culvert.name} · ${formatRoadStation(culvert.chainage)}`,
                })),
              ]}
              onValueChange={(id) => {
                const culvert = analysis.engineering?.culverts.find((c) => c.id === id)
                if (culvert) {
                  onSelectCulvert?.(culvert.id)
                  onStation(culvert.chainage)
                }
              }}
            />
          </label>
        )}
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label="Zoom terrain in"
            onClick={() => setZoom((value) => clamp(value * 1.25, 0.35, 8))}
          >
            <Plus className="size-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label="Zoom terrain out"
            onClick={() => setZoom((value) => clamp(value / 1.25, 0.35, 8))}
          >
            <Minus className="size-3" />
          </Button>
          <Button size="icon" variant="ghost" className="size-7" aria-label="Fit terrain view" onClick={resetCamera}>
            <RotateCcw className="size-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            aria-label="Rotate terrain left"
            onClick={() => setYaw((value) => value - 15)}
          >
            ↶
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            aria-label="Rotate terrain right"
            onClick={() => setYaw((value) => value + 15)}
          >
            ↷
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            aria-pressed={wireframe}
            onClick={() => setWireframe((value) => !value)}
          >
            Mesh
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            aria-label="Fill small gaps in 3D display"
            aria-pressed={fillGaps}
            title="Estimate small enclosed gaps for the 3D display only. Turn off to show the original source gaps. Calculations always use the original terrain."
            onClick={() => setFillGaps((value) => !value)}
          >
            Fill gaps
          </Button>
          {!terrainOnly && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              aria-pressed={showEarthwork}
              onClick={() => setShowEarthwork((value) => !value)}
            >
              Batters
            </Button>
          )}
          <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
            Vertical
            <AppSelect
              triggerAriaLabel="Terrain vertical exaggeration"
              contentClassName="z-[1600] text-xs"
              triggerClassName="h-7 w-16 text-xs"
              value={String(exaggeration)}
              onValueChange={(value) => setExaggeration(Number(value))}
              options={[1, 2, 4].map((value) => ({ value: String(value), label: `×${value}` }))}
            />
          </label>
        </div>
      </div>
      {!!sourceGeometry?.infilledCells && (
        <p
          role="status"
          data-testid="road-terrain-infill-note"
          className="pointer-events-none absolute bottom-2 left-2 z-10 rounded border bg-background/90 px-2 py-1 text-[10px] text-muted-foreground"
          title="Small enclosed gaps are estimated from surrounding terrain for display. Station elevations, quantities and reports retain the original missing data."
        >
          Estimated patches · display only
        </p>
      )}
      <ChartViewport className="min-h-0 flex-1" minHeight={1} initialHeight={240}>
        {(height) => (
          <SizedChart height={height}>
            {(width) => {
              if (!sourceGeometry)
                return (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    Draw an alignment to inspect its terrain.
                  </div>
                )
              const { bounds, frame, medianZ } = sourceGeometry
              const following = mode === 'follow' && active
              const target = following
                ? frame.point(active.coordinate)
                : [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]
              const activeElevation = terrainOnly
                ? active?.groundElevation
                : (active?.designElevation ?? active?.groundElevation)
              const targetZ = following ? (activeElevation ?? medianZ) : medianZ
              const angle = (following ? active.bearing + yaw - 28 : yaw) * radians
              const tilt = (following ? clamp(pitch - 10, 15, 80) : pitch) * radians
              const span = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1], 30)
              const scale =
                zoom *
                Math.min(
                  (width - 20) / (span * 1.35),
                  (height - 24) / (span * 0.85 + (sourceGeometry.high - sourceGeometry.low) * exaggeration * 0.4),
                )
              const cameraDistance = span * 2.5
              const project = (vertex: Vertex) => {
                const x = vertex.x - target[0],
                  y = vertex.y - target[1],
                  z = (vertex.z - targetZ) * exaggeration
                const across = x * Math.cos(angle) - y * Math.sin(angle)
                const ahead = x * Math.sin(angle) + y * Math.cos(angle)
                const depth = ahead * Math.cos(tilt) - z * Math.sin(tilt)
                const vertical = ahead * Math.sin(tilt) + z * Math.cos(tilt)
                const perspective = cameraDistance / Math.max(cameraDistance * 0.15, cameraDistance + depth)
                return {
                  x: width / 2 + pan.x + across * scale * perspective,
                  y: height * 0.57 + pan.y - vertical * scale * perspective,
                  depth,
                }
              }
              const faces = (items: Face[]) =>
                items
                  .map((face) => {
                    const projected = face.vertices.map(project)
                    return {
                      ...face,
                      points: projected.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
                      depth: projected.reduce((sum, p) => sum + p.depth, 0) / projected.length,
                    }
                  })
                  .sort((a, b) => b.depth - a.depth)
              const route = sourceGeometry.line.slice(1).flatMap((s, index) => {
                const previous = sourceGeometry.line[index]
                if (!s.vertex || !previous.vertex || !s.connected) return []
                const clipped = clipLine(previous.vertex, s.vertex, bounds)
                return clipped ? [{ first: project(clipped[0]), last: project(clipped[1]), chainage: s.chainage }] : []
              })
              const section =
                active?.section.map((p) => {
                  if (!finite(p.ground)) return null
                  const [x, y] = frame.point(active.coordinate)
                  const bearing = active.bearing * radians
                  return {
                    x: x + Math.cos(bearing) * p.offset,
                    y: y - Math.sin(bearing) * p.offset,
                    z: p.ground as number,
                  }
                }) ?? []
              const activePoint =
                active && finite(activeElevation)
                  ? (() => {
                      const [x, y] = frame.point(active.coordinate)
                      return project({ x, y, z: activeElevation })
                    })()
                  : null
              const culverts = terrainOnly
                ? []
                : (analysis.engineering?.culverts ?? []).map((culvert) => {
                    const segments = culvert.profile.slice(1).flatMap((p, i) => {
                      const previous = culvert.profile[i]
                      if (!finite(previous.crownElevation) || !finite(p.crownElevation)) return []
                      const [ax, ay] = frame.point(previous.coordinate),
                        [bx, by] = frame.point(p.coordinate)
                      const clipped = clipLine(
                        { x: ax, y: ay, z: previous.crownElevation },
                        { x: bx, y: by, z: p.crownElevation },
                        bounds,
                      )
                      return clipped ? [{ a: project(clipped[0]), b: project(clipped[1]) }] : []
                    })
                    return { culvert, segments }
                  })
              return (
                <svg
                  ref={setWheelSvg}
                  width={width}
                  height={height}
                  role="group"
                  tabIndex={0}
                  aria-label={
                    terrainOnly
                      ? 'Three dimensional terrain surface and sampled transect. Drag to orbit, or use arrow keys to rotate.'
                      : 'Three dimensional terrain surface and road formation overlay. Drag to orbit, or use arrow keys to rotate.'
                  }
                  className="select-none touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onContextMenu={(event) => event.preventDefault()}
                  onClick={(event) => {
                    if (!showEarthwork || !pointerStart.current || (event.target as Element).closest('.cursor-pointer'))
                      return
                    if (
                      Math.hypot(event.clientX - pointerStart.current[0], event.clientY - pointerStart.current[1]) > 3
                    )
                      return
                    const rectangle = event.currentTarget.getBoundingClientRect()
                    const x = ((event.clientX - rectangle.left) * width) / rectangle.width,
                      y = ((event.clientY - rectangle.top) * height) / rectangle.height
                    const picked = [...sourceGeometry.earthwork]
                      .sort(
                        (a, b) =>
                          b.vertices.reduce((sum, v) => sum + project(v).depth, 0) / b.vertices.length -
                          a.vertices.reduce((sum, v) => sum + project(v).depth, 0) / a.vertices.length,
                      )
                      .reverse()
                      .find((face) => {
                        const points = face.vertices.map(project)
                        let inside = false
                        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
                          const a = points[i],
                            b = points[j]
                          if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
                        }
                        return inside
                      })
                    if (picked?.station !== undefined) onStation(picked.station)
                  }}
                  onPointerDown={(event) => {
                    if (event.button !== 0 && event.button !== 2) return
                    event.preventDefault()
                    event.currentTarget.focus({ preventScroll: true })
                    pointerStart.current = [event.clientX, event.clientY]
                    drag.current = {
                      x: event.clientX,
                      y: event.clientY,
                      yaw,
                      pitch,
                      panX: pan.x,
                      panY: pan.y,
                      panning: event.shiftKey || event.button === 2,
                    }
                    event.currentTarget.setPointerCapture(event.pointerId)
                  }}
                  onPointerMove={(event) => {
                    const start = drag.current
                    if (!start) return
                    const dx = event.clientX - start.x,
                      dy = event.clientY - start.y
                    if (dragFrame.current) cancelAnimationFrame(dragFrame.current)
                    dragFrame.current = requestAnimationFrame(() => {
                      if (start.panning) setPan({ x: start.panX + dx, y: start.panY + dy })
                      else {
                        setYaw(start.yaw - dx * 0.35)
                        setPitch(clamp(start.pitch + dy * 0.2, 15, 80))
                      }
                    })
                  }}
                  onPointerUp={() => {
                    drag.current = null
                  }}
                  onPointerCancel={() => {
                    drag.current = null
                  }}
                  onKeyDown={(event) => {
                    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key))
                      event.preventDefault()
                    if (event.key === 'ArrowLeft') setYaw((value) => value - 10)
                    if (event.key === 'ArrowRight') setYaw((value) => value + 10)
                    if (event.key === 'ArrowUp') setPitch((value) => clamp(value + 5, 15, 80))
                    if (event.key === 'ArrowDown') setPitch((value) => clamp(value - 5, 15, 80))
                    if (event.key === 'Home') resetCamera()
                    if (event.key === '+' || event.key === '=') {
                      event.preventDefault()
                      setZoom((value) => clamp(value * 1.25, 0.35, 8))
                    }
                    if (event.key === '-') {
                      event.preventDefault()
                      setZoom((value) => clamp(value / 1.25, 0.35, 8))
                    }
                  }}
                >
                  <title>
                    {terrainOnly
                      ? 'Decimated surface and transect sampled from the same elevation source as the terrain profile.'
                      : 'Decimated surface sampled from the same elevation source as the road calculations. Road formation is overlaid to remain visible in cut.'}
                  </title>
                  <rect width={width} height={height} fill="hsl(var(--muted))" opacity={0.3} />
                  <TerrainGround
                    faces={sourceGeometry.ground}
                    overlays={showEarthwork ? sourceGeometry.earthwork : NO_FACES}
                    project={project}
                    width={width}
                    height={height}
                    wireframe={wireframe}
                    projectionKey={JSON.stringify([
                      width,
                      height,
                      target,
                      targetZ,
                      angle,
                      tilt,
                      scale,
                      cameraDistance,
                      exaggeration,
                      pan,
                    ])}
                  />
                  {faces(sourceGeometry.road).map((face, i) => (
                    <polygon
                      key={`road${i}`}
                      data-design-over-terrain-gap={face.terrainGap || undefined}
                      points={face.points}
                      fill={
                        selectedRange &&
                        face.station !== undefined &&
                        face.station >= selectedRange.start &&
                        face.station <= selectedRange.end
                          ? '#e11d48'
                          : face.fill
                      }
                      stroke="#94744a"
                      strokeWidth={0.3}
                      opacity={0.95}
                      className="cursor-pointer"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => onStation(face.station ?? 0)}
                    >
                      <title>
                        Design surface at {formatRoadStation(face.station ?? 0)}
                        {face.terrainGap ? '; ground is unverified here' : ''}; click to inspect
                      </title>
                    </polygon>
                  ))}
                  {culverts
                    .sort(
                      (a, b) => Number(a.culvert.id === selectedCulvertId) - Number(b.culvert.id === selectedCulvertId),
                    )
                    .map(({ culvert, segments }) => (
                      <g
                        key={culvert.id}
                        role="button"
                        tabIndex={segments.length ? 0 : undefined}
                        aria-label={`Inspect 3D culvert ${culvert.name}`}
                        aria-pressed={selectedCulvertId === culvert.id}
                        className="cursor-pointer"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => {
                          onSelectCulvert?.(culvert.id)
                          onStation(culvert.chainage)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            event.stopPropagation()
                            onSelectCulvert?.(culvert.id)
                            onStation(culvert.chainage)
                          }
                        }}
                      >
                        {segments.map(({ a, b }, index) => (
                          <line
                            key={index}
                            x1={a.x}
                            y1={a.y}
                            x2={b.x}
                            y2={b.y}
                            stroke={
                              selectedCulvertId === culvert.id
                                ? ROAD_CHART_COLORS.selected
                                : culvert.warnings.length
                                  ? '#b45309'
                                  : '#0284c7'
                            }
                            strokeWidth={selectedCulvertId === culvert.id ? 6 : 4}
                          />
                        ))}
                        <title>
                          {culvert.name} · {formatRoadStation(culvert.chainage)} · entered barrel crown geometry
                        </title>
                      </g>
                    ))}
                  {showEarthwork &&
                    sourceGeometry.ditches.map((segment, index) => {
                      const a = project(segment.a),
                        b = project(segment.b)
                      return (
                        <line
                          key={`ditch-${index}`}
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          stroke={ROAD_CHART_COLORS.ditch}
                          strokeWidth={1.5}
                          strokeDasharray="3 2"
                          className="cursor-pointer"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() => onStation(segment.chainage)}
                        >
                          <title>
                            {segment.side} ditch bottom at {formatRoadStation(segment.chainage)}
                          </title>
                        </line>
                      )
                    })}
                  {route.map((segment, i) => (
                    <line
                      key={`line${i}`}
                      x1={segment.first.x}
                      y1={segment.first.y}
                      x2={segment.last.x}
                      y2={segment.last.y}
                      stroke={terrainOnly ? ROAD_CHART_COLORS.ground : ROAD_CHART_COLORS.design}
                      strokeWidth={terrainOnly ? 2.5 : 1.2}
                      strokeDasharray="3 2"
                      opacity={0.9}
                      pointerEvents={terrainOnly ? 'stroke' : 'none'}
                      onPointerDown={terrainOnly ? (event) => event.stopPropagation() : undefined}
                      onClick={terrainOnly ? () => onStation(segment.chainage) : undefined}
                    />
                  ))}
                  {section.length > 1 && (
                    <path
                      d={section
                        .map((vertex, i) => {
                          if (!vertex) return ''
                          const p = project(vertex)
                          return `${i > 0 && section[i - 1] ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`
                        })
                        .join(' ')}
                      fill="none"
                      stroke={ROAD_CHART_COLORS.selected}
                      strokeWidth={1.8}
                      pointerEvents="none"
                    />
                  )}
                  {activePoint && (
                    <g pointerEvents="none">
                      <circle
                        cx={activePoint.x}
                        cy={activePoint.y}
                        r={5}
                        fill={ROAD_CHART_COLORS.selected}
                        stroke="white"
                        strokeWidth={1.5}
                      />
                      <text
                        x={activePoint.x + 8}
                        y={activePoint.y - 8}
                        fontSize="10"
                        fill="hsl(var(--foreground))"
                        stroke="hsl(var(--background))"
                        strokeWidth={3}
                        paintOrder="stroke"
                      >
                        {formatRoadStation(active?.chainage ?? station)}
                      </text>
                    </g>
                  )}
                  <text x={10} y={16} fontSize="10" fill="hsl(var(--muted-foreground))">
                    {following
                      ? `${playing ? 'Following' : 'Station'} ${formatRoadStation(station)}`
                      : 'Drag to orbit · Shift-drag to pan · scroll to zoom'}
                  </text>
                  {sourceGeometry.cells === 0 && (
                    <text
                      x={width / 2}
                      y={height / 2}
                      fontSize="12"
                      textAnchor="middle"
                      fill="hsl(var(--muted-foreground))"
                    >
                      No terrain coverage in this view
                    </text>
                  )}
                </svg>
              )
            }}
          </SizedChart>
        )}
      </ChartViewport>
      <div className="shrink-0 text-[10px]">
        {selectedCulvert && (
          <p className="text-rose-700 dark:text-rose-300" data-testid="road-3d-selected-culvert">
            Selected: {selectedCulvert.name} · {formatRoadStation(selectedCulvert.chainage)} · cover{' '}
            {selectedCulvert.coverM === null ? 'unknown' : `${selectedCulvert.coverM.toFixed(2)} m`}.{' '}
            {selectedCulvert.warnings.join(' ')}
          </p>
        )}
      </div>
    </div>
  )
}
