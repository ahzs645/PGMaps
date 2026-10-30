import { NativeSelect } from '@/components/ui/form-field'
import { useCallback, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { downloadText } from '@/lib/download'
import { benchmarkPreview } from '../TreeBenchmarks'
import type { Basemap } from '../basemaps'
import type { IsolatedPoint } from '../treeIsolation'
import { ComparisonMap, sameCamera, type ComparisonCamera } from './ComparisonMap'
import { ComparisonProfile } from './ComparisonProfile'
import { ComparisonPreference } from './ComparisonPreference'
import { ComparisonPane } from './ComparisonPane'
import type { ComparisonData } from './data'

export function LidarComparison({
  data,
  basemap,
  selectedModel,
}: {
  data: ComparisonData
  basemap: Basemap
  selectedModel?: string
}) {
  const [plotId, setPlotId] = useState(data.benchmark.plots[0].id),
    [aId, setAId] = useState(selectedModel || 'watershed'),
    [bId, setBId] = useState(selectedModel === 'dalponte2016' ? 'watershed' : 'dalponte2016')
  const [view, setView] = useState('3d'),
    [linked, setLinked] = useState(true),
    [angle, setAngle] = useState(0),
    [camera, setCamera] = useState<ComparisonCamera | null>(null),
    [reset, setReset] = useState(0),
    [picked, setPicked] = useState<IsolatedPoint | null>(null)
  const [previousSelectedModel, setPreviousSelectedModel] = useState(selectedModel)
  if (previousSelectedModel !== selectedModel) {
    setPreviousSelectedModel(selectedModel)
    if (selectedModel) {
      setAId(selectedModel)
      setBId(selectedModel === 'dalponte2016' ? 'watershed' : 'dalponte2016')
    }
  }
  const plot = data.benchmark.plots.find((p) => p.id === plotId) ?? data.benchmark.plots[0]
  const a = plot.methods.find((m) => m.id === aId) ?? plot.methods[0],
    b = plot.methods.find((m) => m.id === bId) ?? plot.methods[1]
  const left = useMemo(() => benchmarkPreview(data.benchmark, plot, a), [data.benchmark, plot, a]),
    right = useMemo(() => benchmarkPreview(data.benchmark, plot, b), [data.benchmark, plot, b])
  const onCamera = useCallback(
    (next: ComparisonCamera) => setCamera((previous) => (sameCamera(previous, next) ? previous : next)),
    [],
  )
  const agreement = plot.pairwise_agreement.find(
    (p) => (p.left === a.id && p.right === b.id) || (p.left === b.id && p.right === a.id),
  )
  const sharedHeight = Math.ceil(Math.max(5, ...left.crop.points.map((p) => p.height)) / 5) * 5
  const changePlot = (id: string) => {
    setPlotId(id)
    setCamera(null)
    setPicked(null)
  }
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-end gap-2 border-b p-2 text-xs">
        <label>
          Source plot
          <NativeSelect
            aria-label="Comparison LiDAR plot"
            className="ml-1 max-w-[170px] rounded border bg-background p-1.5"
            value={plot.id}
            onChange={(e) => changePlot(e.target.value)}
          >
            {data.benchmark.plots.map((p) => (
              <option key={p.id}>{p.id}</option>
            ))}
          </NativeSelect>
        </label>
        {[
          [a, setAId, 'A'],
          [b, setBId, 'B'],
        ].map(([method, set, label]) => (
          <label key={String(label)}>
            {String(label)}
            <NativeSelect
              aria-label={`LiDAR model ${label}`}
              className="ml-1 max-w-[190px] rounded border bg-background p-1.5"
              value={(method as typeof a).id}
              onChange={(e) => (set as (s: string) => void)(e.target.value)}
            >
              {plot.methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        ))}
        <SegmentedControl
          size="sm"
          fullWidth={false}
          label="Comparison LiDAR view"
          value={view}
          onChange={(v) => {
            setView(v)
            setCamera(null)
          }}
          options={[
            { value: '3d', label: '3D points' },
            { value: 'top', label: 'Top map' },
            { value: 'profile', label: 'Side profiles' },
          ]}
        />
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} />
          Link cameras
        </label>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setCamera(null)
            setReset((n) => n + 1)
          }}
        >
          Fit plot
        </Button>
        {view === 'profile' && (
          <label>
            Rotation {angle}°
            <input
              aria-label="Comparison profile rotation"
              type="range"
              min={0}
              max={180}
              step={5}
              value={angle}
              onChange={(e) => setAngle(+e.target.value)}
            />
          </label>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        <div className="flex h-full min-h-[400px] flex-col gap-2 lg:min-h-[300px] lg:flex-row">
          {[
            [a, left, 'A'],
            [b, right, 'B'],
          ].map(([method, preview, label]) => {
            const m = method as typeof a,
              p = preview as typeof left
            return (
              <ComparisonPane
                key={String(label)}
                label={String(label)}
                title={m.name}
                metrics={[
                  { label: 'Core instances', value: String(m.instances_core) },
                  { label: 'Unassigned core returns', value: m.unassigned_points.toLocaleString() },
                  {
                    label: 'Run / peak RSS',
                    value: `${m.runtime_seconds?.toFixed(2) ?? '—'} s / ${m.peak_rss_mb?.toFixed(0) ?? '—'} MB`,
                  },
                ]}
              >
                {view === 'profile' ? (
                  <ComparisonProfile
                    crop={p.crop}
                    assignments={p.assignments}
                    angle={angle}
                    height={sharedHeight}
                    radius={34}
                    picked={picked}
                    onPick={setPicked}
                  />
                ) : (
                  <ComparisonMap
                    label={`LiDAR comparison map ${label}`}
                    centre={plot.centre}
                    focusKey={`${plot.id}-${reset}`}
                    view={view === 'top' ? 'top' : '3d'}
                    basemap={basemap}
                    crop={p.crop}
                    assignments={p.assignments}
                    features={p.features}
                    camera={linked ? camera : null}
                    onCamera={linked ? onCamera : undefined}
                  />
                )}
              </ComparisonPane>
            )
          })}
        </div>
      </div>
      <div className="max-h-[24dvh] shrink-0 overflow-y-auto overscroll-contain border-t p-3 text-xs">
        <p>
          <strong>{plot.accepted_returns.toLocaleString()} full input returns processed.</strong> Views display the same
          deterministic {plot.sample.sampled.toLocaleString()}-point sample. Grey means unassigned; colours are each
          method’s own IDs.
        </p>
        <p className="mt-1 text-muted-foreground">
          Adjusted Rand agreement: {agreement?.adjusted_rand_index?.toFixed(3) ?? 'unavailable'} ·{' '}
          {agreement?.common_assigned_points.toLocaleString() ?? '—'} common assigned core returns. Agreement and
          assigned coverage are not accuracy. Watershed timing is membership lookup; treeX includes its own terrain
          processing.
        </p>
        {picked && (
          <p className="mt-1">
            Picked original return: {picked.node}:{picked.index} · {picked.height.toFixed(2)} m above terrain
          </p>
        )}
        <details className="mt-2">
          <summary className="cursor-pointer font-medium">All methods, versions and processing parameters</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr>
                  <th className="p-1">Method</th>
                  <th className="p-1">Core instances</th>
                  <th className="p-1">Unassigned returns</th>
                  <th className="p-1">Run time</th>
                </tr>
              </thead>
              <tbody>
                {plot.methods.map((m) => (
                  <tr key={m.id}>
                    <td className="p-1">
                      {m.name} · {m.version}
                    </td>
                    <td className="p-1">{m.instances_core}</td>
                    <td className="p-1">{m.unassigned_points.toLocaleString()}</td>
                    <td className="p-1">{m.runtime_seconds?.toFixed(2) ?? '—'} s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[10px]">
            {JSON.stringify(
              plot.methods.map(({ id, status, parameters, reason }) => ({ id, status, parameters, reason })),
              null,
              2,
            )}
          </pre>
        </details>
        <details className="mt-2">
          <summary className="cursor-pointer font-medium">Choose a result, add notes and export</summary>
          <div className="mt-2">
            <ComparisonPreference
              scope={`${data.benchmark.source_sha256}/lidar/${plot.id}/${data.benchmark.segmentation_sha256}`}
              left={a}
              right={b}
              onExport={(review) =>
                downloadText(
                  JSON.stringify(
                    {
                      scope: 'Same BC LiDAR plot; no reviewed instance truth',
                      source_sha256: data.benchmark.source_sha256,
                      plot,
                      comparison: { a: a.id, b: b.id, agreement },
                      review,
                    },
                    null,
                    2,
                  ),
                  'lidar-model-comparison.json',
                  'application/json',
                )
              }
            />
          </div>
        </details>
      </div>
    </div>
  )
}
