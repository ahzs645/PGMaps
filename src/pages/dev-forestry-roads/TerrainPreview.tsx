import { useMemo, useRef, useState } from 'react'
import { ChartViewport, SizedChart } from '@pgmaps/geo-toolkit/visualizations/react'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ROAD_CHART_COLORS, formatRoadStation } from './Charts'
import { sectionCodePoints, sectionSampleAt } from './sectionGeometry'
import type { Coordinate, RoadAnalysis, RoadStation, TerrainSource } from './types'

interface Vertex {
  x: number
  y: number
  z: number
}
interface Face {
  vertices: Vertex[]
  fill: string
  station?: number
}
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
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null)
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
    // Preview simplification is deliberate; it does not change the analysis grid.
    const count = 30
    const vertices: Array<Array<Vertex | null>> = []
    for (let row = 0; row <= count; row++) {
      const line: Array<Vertex | null> = []
      for (let col = 0; col <= count; col++) {
        const x = bounds[0] + ((bounds[2] - bounds[0]) * col) / count
        const y = bounds[1] + ((bounds[3] - bounds[1]) * row) / count
        const coordinate = frame.coordinate(x, y)
        const z = terrain.elevationAt(...coordinate)
        line.push(Number.isFinite(z) ? { x, y, z } : null)
      }
      vertices.push(line)
    }
    const ground: Face[] = []
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        const a = vertices[row][col],
          b = vertices[row][col + 1],
          c = vertices[row + 1][col + 1],
          d = vertices[row + 1][col]
        // Never bridge holes in the terrain source for the preview.
        if (a && b && c && d) ground.push({ vertices: [a, b, c, d], fill: shade(a, b, d) })
      }
    }
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
          .every((p) => (terrainOnly || finite(p.designElevation)) && finite(p.groundElevation))
      const lineElevation = terrainOnly ? s.groundElevation : s.designElevation
      if (finite(lineElevation) && finite(s.groundElevation)) {
        const [x, y] = frame.point(s.coordinate)
        line.push({ vertex: { x, y, z: lineElevation }, chainage: s.chainage, connected })
      } else line.push({ vertex: null, chainage: s.chainage, connected: false })
    }
    for (let i = 1; !terrainOnly && i < selected.length; i++) {
      const a = selected[i - 1],
        b = selected[i]
      if (!finite(a.designElevation) || !finite(b.designElevation)) continue
      // Null sections produce gaps, including skipped stations in a decimated preview.
      if (
        analysis.stations
          .slice(a.index, b.index + 1)
          .some((s) => !finite(s.designElevation) || !finite(s.groundElevation))
      )
        continue
      const leftA = sideways(a, -a.leftWidth, frame),
        rightA = sideways(a, a.rightWidth, frame)
      const leftB = sideways(b, -b.leftWidth, frame),
        rightB = sideways(b, b.rightWidth, frame)
      if (leftA && rightA && leftB && rightB) {
        const vertices = clipFace([leftA, rightA, rightB, leftB], bounds)
        if (vertices.length >= 3) road.push({ vertices, fill: '#e8c886', station: (a.chainage + b.chainage) / 2 })
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
    const zValues = vertices
      .flat()
      .filter((p): p is Vertex => p !== null)
      .map((p) => p.z)
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
      meshSpacing: Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]) / count,
      cells: ground.length,
    }
  }, [analysis, terrain, followingStation, terrainOnly])

  return (
    <div
      className="flex h-full min-h-[240px] min-w-0 flex-col"
      data-testid="road-terrain-preview"
      data-station={active?.chainage ?? station}
      data-terrain-only={terrainOnly}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-2 py-1.5">
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
            <select
              aria-label="3D structure"
              className="max-w-[190px] rounded border bg-background px-1 py-1 text-xs text-foreground"
              value={selectedCulvert?.id ?? ''}
              onChange={(event) => {
                const culvert = analysis.engineering?.culverts.find((c) => c.id === event.target.value)
                if (!culvert) return
                onSelectCulvert?.(culvert.id)
                onStation(culvert.chainage)
              }}
            >
              <option value="" disabled>
                Select a culvert
              </option>
              {analysis.engineering.culverts.map((culvert) => (
                <option key={culvert.id} value={culvert.id}>
                  {culvert.name} · {formatRoadStation(culvert.chainage)}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            aria-label="Rotate terrain left"
            disabled={mode === 'follow'}
            onClick={() => setYaw((value) => value - 15)}
          >
            ↶
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            aria-label="Rotate terrain right"
            disabled={mode === 'follow'}
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
            <select
              className="rounded border bg-background px-1 py-1 text-xs text-foreground"
              aria-label="Terrain vertical exaggeration"
              value={exaggeration}
              onChange={(event) => setExaggeration(Number(event.target.value))}
            >
              {[1, 2, 4].map((value) => (
                <option key={value} value={value}>
                  ×{value}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <ChartViewport className="min-h-[170px] flex-1" minHeight={170} initialHeight={240}>
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
              const angle = (following ? active.bearing : yaw) * radians
              const tilt = (following ? 32 : pitch) * radians
              const span = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1], 30)
              const scale = Math.min(
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
                  x: width / 2 + across * scale * perspective,
                  y: height * 0.57 - vertical * scale * perspective,
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
                  width={width}
                  height={height}
                  role="group"
                  tabIndex={0}
                  aria-label={
                    terrainOnly
                      ? 'Three dimensional terrain surface and sampled transect. Drag to orbit, or use arrow keys to rotate.'
                      : 'Three dimensional terrain surface and road formation overlay. Drag to orbit, or use arrow keys to rotate.'
                  }
                  className="touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onPointerDown={(event) => {
                    if (mode !== 'orbit' || event.button !== 0) return
                    drag.current = { x: event.clientX, y: event.clientY, yaw, pitch }
                    event.currentTarget.setPointerCapture(event.pointerId)
                  }}
                  onPointerMove={(event) => {
                    if (!drag.current) return
                    setYaw(drag.current.yaw - (event.clientX - drag.current.x) * 0.35)
                    setPitch(clamp(drag.current.pitch + (event.clientY - drag.current.y) * 0.2, 15, 80))
                  }}
                  onPointerUp={() => {
                    drag.current = null
                  }}
                  onPointerCancel={() => {
                    drag.current = null
                  }}
                  onKeyDown={(event) => {
                    if (mode !== 'orbit') return
                    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key))
                      event.preventDefault()
                    if (event.key === 'ArrowLeft') setYaw((value) => value - 10)
                    if (event.key === 'ArrowRight') setYaw((value) => value + 10)
                    if (event.key === 'ArrowUp') setPitch((value) => clamp(value + 5, 15, 80))
                    if (event.key === 'ArrowDown') setPitch((value) => clamp(value - 5, 15, 80))
                    if (event.key === 'Home') {
                      setYaw(28)
                      setPitch(42)
                    }
                  }}
                >
                  <title>
                    {terrainOnly
                      ? 'Decimated surface and transect sampled from the same elevation source as the terrain profile.'
                      : 'Decimated surface sampled from the same elevation source as the road calculations. Road formation is overlaid to remain visible in cut.'}
                  </title>
                  <rect width={width} height={height} fill="hsl(var(--muted))" opacity={0.3} />
                  {faces(sourceGeometry.ground).map((face, i) => (
                    <polygon
                      key={`ground${i}`}
                      points={face.points}
                      fill={face.fill}
                      stroke={wireframe ? 'hsl(var(--background))' : face.fill}
                      strokeWidth={wireframe ? 0.35 : 0.4}
                      strokeOpacity={wireframe ? 0.45 : 1}
                    />
                  ))}
                  {faces([...(showEarthwork ? sourceGeometry.earthwork : []), ...sourceGeometry.road]).map(
                    (face, i) => (
                      <polygon
                        key={`road${i}`}
                        points={face.points}
                        fill={face.fill}
                        stroke="#94744a"
                        strokeWidth={0.3}
                        opacity={0.95}
                        className="cursor-pointer"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => onStation(face.station ?? 0)}
                      >
                        <title>Design surface at {formatRoadStation(face.station ?? 0)}; click to inspect</title>
                      </polygon>
                    ),
                  )}
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
                      : 'Drag to orbit · click road to inspect'}
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
      <div className="shrink-0 border-t px-3 py-2 text-[10px] leading-4 text-muted-foreground">
        {sourceLabel} · ground mesh · {terrainOnly ? 'sampled terrain transect' : 'formation overlay'} ·{' '}
        {sourceGeometry ? `${sourceGeometry.meshSpacing.toFixed(1)} m preview spacing` : 'no surface'} · vertical ×
        {exaggeration}. Analysis retains the source resolution. Terrain gaps stay open.
        {!terrainOnly &&
          showEarthwork &&
          ' Batters use computed sections (amber cut, blue fill); blue dashed lines mark actual cut-side ditch bottoms. Design surfaces are overlaid on original ground.'}
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
