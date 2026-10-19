import { useEffect, useMemo, useState } from 'react'
import proj4 from 'proj4'
import type { FeatureCollection, Polygon, Point } from 'geojson'
import { Button } from '@/components/ui/button'
import { KeyValueRows } from '@/components/ui/map-panels'
import { downloadText } from '@/lib/download'
import { METRIC_CRS } from './sourceGrids'
import type { TreeCrop, TreeIsolation, IsolatedPoint } from './treeIsolation'
import { DEFAULT_PROFILE, pointKey } from './treeInspection'
import { ProfileCanvas } from './ProfileCanvas'
import snapshotUrl from './treeBenchmarks.generated.json?url'

export interface BenchmarkMethod {
  id: string
  name: string
  version: string
  status: string
  runtime_seconds?: number
  peak_rss_mb?: number
  instances_core: number
  instances_buffer: number
  assigned_points: number
  unassigned_points: number
  parameters: unknown
  labels: number[]
  tops: { id: number; lon: number; lat: number; height_m: number; edge: boolean }[]
  reason?: string
}
export interface BenchmarkPlot {
  id: string
  centre: [number, number]
  centre_utm: [number, number]
  core_polygon: Polygon
  buffer_polygon: Polygon
  examined_returns: number
  accepted_returns: number
  sample: { strategy: string; sampled: number; total: number; nodes: string[]; points: number[][] }
  methods: BenchmarkMethod[]
  pairwise_agreement: {
    left: string
    right: string
    common_assigned_points: number
    eligible_core_points: number
    adjusted_rand_index: number | null
  }[]
}
export interface BenchmarkData {
  schema_version: number
  source_sha256: string
  segmentation_sha256: string
  label_grid_sha256: string
  input_sha256: Record<string, string>
  plots: BenchmarkPlot[]
  screening: unknown
  limitations: unknown
}
export interface BenchmarkPreview {
  crop: TreeCrop
  assignments: Record<string, string>
  features: FeatureCollection<Polygon | Point>
}
export function benchmarkPreview(data: BenchmarkData, plot: BenchmarkPlot, method: BenchmarkMethod): BenchmarkPreview {
  const assignments: Record<string, string> = {}
  const points: TreeCrop['points'] = plot.sample.points.map(([dx, dy, z, height, node, index, classification], i) => {
    const [lon, lat] = proj4(METRIC_CRS, 'EPSG:4326', [plot.centre_utm[0] + dx, plot.centre_utm[1] + dy]),
      p = { lon, lat, z, height, node: plot.sample.nodes[node], index, classification }
    assignments[pointKey(p)] = method.labels[i] < 0 ? '0' : `edit-${method.id}-${method.labels[i]}`
    return p
  })
  const grounds = points.map((p) => p.z - p.height).sort((a, b) => a - b)
  return {
    crop: {
      id: `${plot.id} / ${method.id}`,
      source_sha256: data.source_sha256,
      centre: plot.centre,
      ground_m: grounds[Math.floor(grounds.length / 2)] ?? 0,
      points,
      loaded_points: plot.examined_returns,
      loaded_nodes: plot.sample.nodes.length,
      available_nodes: plot.sample.nodes.length,
      budget_limited: true,
      withheld_filtered: true,
    },
    assignments,
    features: {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: plot.buffer_polygon, properties: { part: 'processing buffer' } },
        { type: 'Feature', geometry: plot.core_polygon, properties: { part: 'evaluation core' } },
        ...method.tops.map((top) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [top.lon, top.lat] },
          properties: { part: 'method treetop', instance_id: top.id, height_m: top.height_m, buffer_edge: top.edge },
        })),
      ],
    },
  }
}
export function checkBenchmarks(data: BenchmarkData, source: TreeIsolation) {
  if (
    data.schema_version !== 1 ||
    data.source_sha256 !== source.source_sha256 ||
    data.label_grid_sha256 !== source.label_grid_sha256 ||
    data.input_sha256['dtm-1m.tif'] !== source.input_sha256['dtm-1m.tif']
  )
    throw Error('Benchmark source or terrain mismatch')
  if (!Array.isArray(data.plots) || !data.plots.length || data.plots.length > 10) throw Error('Invalid benchmark plots')
  for (const p of data.plots) {
    if (p.examined_returns > 750000 || p.sample.points.length > 10000 || p.sample.sampled !== p.sample.points.length)
      throw Error('Benchmark input or sample budget mismatch')
    if (
      p.sample.points.some(
        (row) =>
          row.length !== 7 ||
          row.some((n) => !Number.isFinite(n)) ||
          !Number.isInteger(row[4]) ||
          row[4] < 0 ||
          row[4] >= p.sample.nodes.length ||
          !Number.isInteger(row[5]) ||
          row[5] < 0,
      )
    )
      throw Error('Invalid benchmark source-point identity')
    for (const m of p.methods)
      if (m.labels.length !== p.sample.points.length || m.labels.some((n) => !Number.isInteger(n) || n < -1))
        throw Error('Benchmark point labels are not aligned')
  }
}
export function TreeBenchmarks({
  source,
  onPreview,
  onFocus,
  onPick,
  picked,
}: {
  source: TreeIsolation | null
  onPreview: (p: BenchmarkPreview | null) => void
  onFocus: (centre: [number, number], ground: number) => void
  onPick: (p: IsolatedPoint | null) => void
  picked?: IsolatedPoint | null
}) {
  const [data, setData] = useState<BenchmarkData | null>(null),
    [error, setError] = useState(''),
    [plotId, setPlotId] = useState(''),
    [methodA, setMethodA] = useState('watershed'),
    [methodB, setMethodB] = useState('dalponte2016'),
    [angle, setAngle] = useState(0),
    [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!source) return
    setError('')
    let active = true
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 30000)
    fetch(snapshotUrl, { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw Error('Benchmark data unavailable')
        return r.json()
      })
      .then((next) => {
        checkBenchmarks(next, source)
        if (active) setData(next)
      })
      .catch((e) => {
        if (active) setError(String(e))
      })
      .finally(() => clearTimeout(timer))
    return () => {
      active = false
      abort.abort()
      clearTimeout(timer)
    }
  }, [source, attempt])
  const plot = data?.plots.find((p) => p.id === plotId) ?? data?.plots[0]
  const a = plot?.methods.find((m) => m.id === methodA) ?? plot?.methods[0],
    b = plot?.methods.find((m) => m.id === methodB) ?? plot?.methods[1]
  const previewA = useMemo(() => (data && plot && a ? benchmarkPreview(data, plot, a) : null), [data, plot, a]),
    previewB = useMemo(() => (data && plot && b ? benchmarkPreview(data, plot, b) : null), [data, plot, b])
  useEffect(() => {
    onPreview(previewA)
    return () => onPreview(null)
  }, [previewA, onPreview])
  useEffect(() => {
    if (previewA) onFocus(previewA.crop.centre, previewA.crop.ground_m)
  }, [plot, onFocus])
  useEffect(() => {
    onPick(null)
  }, [plot?.id, onPick])
  if (!data || !plot || !a || !b || !previewA || !previewB)
    return (
      <p className="p-3 text-xs" role="status">
        {error || 'Loading actual segmentation benchmark results…'}
        {error && (
          <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
            Retry benchmark results
          </Button>
        )}
      </p>
    )
  const agreement = plot.pairwise_agreement.find(
    (p) => (p.left === a.id && p.right === b.id) || (p.left === b.id && p.right === a.id),
  )
  const height = Math.max(5, ...previewA.crop.points.map((p) => p.height)),
    radius = 34
  return (
    <div className="space-y-3 p-3 text-xs">
      <p>
        Saved benchmark results from three buffered source plots. All accepted returns were processed; the map and side
        views display a deterministic sample of {plot.sample.sampled.toLocaleString()} /{' '}
        {plot.sample.total.toLocaleString()} returns.
      </p>
      <label className="block">
        Benchmark plot
        <select
          className="mt-1 w-full rounded border bg-background p-1"
          aria-label="Segmentation benchmark plot"
          value={plot.id}
          onChange={(e) => setPlotId(e.target.value)}
        >
          {data.plots.map((p) => (
            <option key={p.id}>{p.id}</option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        {[
          [methodA, setMethodA, 'A · map'],
          [methodB, setMethodB, 'B · comparison'],
        ].map(([value, set, label]) => (
          <label key={String(label)}>
            {String(label)}
            <select
              className="mt-1 w-full rounded border bg-background p-1"
              aria-label={`Segmentation method ${String(label)}`}
              value={String(value)}
              onChange={(e) => (set as (s: string) => void)(e.target.value)}
            >
              {plot.methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <Button size="sm" variant="outline" onClick={() => onFocus(plot.centre, previewA.crop.ground_m)}>
        Focus benchmark plot on map
      </Button>
      <label className="block">
        Comparison rotation {angle}°
        <input
          aria-label="Benchmark rotation"
          className="w-full"
          type="range"
          min={0}
          max={180}
          step={5}
          value={angle}
          onChange={(e) => setAngle(+e.target.value)}
        />
      </label>
      <div className="grid grid-cols-2 gap-1">
        {[
          [a, previewA],
          [b, previewB],
        ].map(([method, preview]) => {
          const m = method as BenchmarkMethod,
            p = preview as BenchmarkPreview
          return (
            <div key={m.id + (p === previewA ? 'A' : 'B')}>
              <strong>{m.id}</strong>
              <div className="h-[260px] border">
                <ProfileCanvas
                  crop={p.crop}
                  assignments={p.assignments}
                  settings={{ ...DEFAULT_PROFILE, angle, colour: 'segment', showRejected: true }}
                  picked={picked ? pointKey(picked) : null}
                  selected={new Set()}
                  seeds={[]}
                  interaction="pick"
                  onPick={onPick}
                  onSelection={() => {}}
                  onSeed={() => {}}
                  onView={() => {}}
                  sharedHeight={height}
                  sharedRadius={radius}
                />
              </div>
              <p>
                {m.instances_core} core instances · {m.unassigned_points.toLocaleString()} unassigned core returns
              </p>
            </div>
          )
        })}
      </div>
      {picked && (
        <p aria-label="Picked benchmark return">
          {pointKey(picked)} · {picked.height.toFixed(3)} m above source terrain · {picked.lon.toFixed(7)},{' '}
          {picked.lat.toFixed(7)}
        </p>
      )}
      <p>
        Colours distinguish each method’s own IDs; the same colour across methods does not establish the same tree. Grey
        points are unassigned. Both profiles share one metre scale; map shows method A. Side profiles show 2–80 m above
        terrain; low returns and ground remain in the processing input and sampled 3D view.
      </p>
      <KeyValueRows
        size="sm"
        rows={[
          { label: 'A / B status', value: `${a.status} / ${b.status}` },
          {
            label: 'A / B runtime',
            value: `${a.runtime_seconds?.toFixed(2) ?? '—'} / ${b.runtime_seconds?.toFixed(2) ?? '—'} s`,
          },
          {
            label: 'A / B peak process RSS',
            value: `${a.peak_rss_mb?.toFixed(0) ?? '—'} / ${b.peak_rss_mb?.toFixed(0) ?? '—'} MB`,
          },
          {
            label: 'Adjusted Rand agreement',
            value: agreement?.adjusted_rand_index?.toFixed(3) ?? 'Unavailable · no shared assignments / same method',
          },
          { label: 'Common assigned core returns', value: agreement?.common_assigned_points.toLocaleString() ?? '—' },
        ]}
      />
      <p className="text-muted-foreground">
        Agreement is not field accuracy. TreeX produced{' '}
        {plot.methods.find((m) => m.id === 'pointtree-treex')?.instances_core ?? '—'} core instances here; its ULS
        stem-search preset needs usable stem evidence. No DBH or species estimates are inferred. Current watershed
        timing measures existing cell-membership lookup, not recomputation; timings do not rank algorithm speed. TreeX
        uses its own terrain processing.
      </p>
      <details>
        <summary>Parameters, screening and limitations</summary>
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap text-[10px]">
          {JSON.stringify(
            {
              a: { version: a.version, parameters: a.parameters },
              b: { version: b.version, parameters: b.parameters },
              screening: data.screening,
              limitations: data.limitations,
            },
            null,
            2,
          )}
        </pre>
      </details>
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          downloadText(JSON.stringify(data, null, 2), 'tree-segmentation-benchmarks.json', 'application/json')
        }
      >
        Export benchmark inputs, labels & metrics
      </Button>
    </div>
  )
}
