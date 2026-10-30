import { NativeSelect } from '@/components/ui/form-field'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { NeuralTreeInspector } from './NeuralTreeInspector'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import type { Basemap } from '../basemaps'
import type { IsolatedPoint } from '../treeIsolation'
import snapshotUrl from './neural.generated.json?url'
import { ComparisonMap, sameCamera, type ComparisonCamera } from './ComparisonMap'
import { ComparisonPane } from './ComparisonPane'
import { ComparisonProfile } from './ComparisonProfile'
import {
  checkNeuralSnapshot,
  neuralAssignments,
  neuralCoverage,
  neuralCrop,
  neuralLabelColour,
  semanticLabel,
  NEURAL_NAMES,
  SEMANTIC_NAMES,
  type NeuralColour,
  type NeuralModel,
  type NeuralSnapshot,
} from './neuralData'

const percent = (n: number) => `${(n * 100).toFixed(1)}%`
export function NeuralComparison({ basemap, sourceSha }: { basemap: Basemap; sourceSha?: string }) {
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState<NeuralSnapshot | null>(null),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    const abort = new AbortController()
    fetch(snapshotUrl, { signal: abort.signal })
      .then(async (r) => {
        if (!r.ok) throw Error(`Neural snapshot unavailable (${r.status})`)
        return r.json()
      })
      .then((next) => {
        checkNeuralSnapshot(next, sourceSha)
        if (active) setData(next)
      })
      .catch((e) => {
        if (active) setError(String(e))
      })
    return () => {
      active = false
      abort.abort()
    }
  }, [sourceSha, attempt])
  if (!data || (sourceSha && data.source_sha256 !== sourceSha))
    return (
      <div role="status" className="p-6 text-sm">
        {error || 'Loading verified preliminary neural results…'}
        {error && (
          <Button
            onClick={() => {
              setError('')
              setAttempt((n) => n + 1)
            }}
          >
            Retry
          </Button>
        )}
      </div>
    )
  return (
    <NeuralViews
      data={data}
      basemap={basemap}
      initialView={params.get('inspect') === 'trees' ? 'trees' : 'coverage'}
      onViewChange={(view) =>
        setParams(
          (previous) => {
            const next = new URLSearchParams(previous)
            if (view === 'trees') next.set('inspect', 'trees')
            else next.delete('inspect')
            return next
          },
          { replace: true },
        )
      }
    />
  )
}
export function NeuralViews({
  data,
  basemap,
  initialView = 'coverage',
  onViewChange,
}: {
  data: NeuralSnapshot
  basemap: Basemap
  initialView?: string
  onViewChange?: (view: string) => void
}) {
  const [view, setView] = useState(initialView),
    [sampleId, setSampleId] = useState(data.samples[0].id),
    [colour, setColour] = useState<NeuralColour>('instance'),
    [angle, setAngle] = useState(0),
    [difference, setDifference] = useState(false),
    [picked, setPicked] = useState<IsolatedPoint | null>(null),
    [cell, setCell] = useState(''),
    [camera, setCamera] = useState<ComparisonCamera | null>(null),
    [reset, setReset] = useState(0)
  const sample = data.samples.find((s) => s.id === sampleId) ?? data.samples[0]
  const crop = useMemo(() => neuralCrop(data, sample), [data, sample])
  const assignments = useMemo(
    () => ({ sat: neuralAssignments(sample, 'sat', colour), forainet: neuralAssignments(sample, 'forainet', colour) }),
    [sample, colour],
  )
  const features = useMemo(
    () => ({ sat: neuralCoverage(data, 'sat', difference), forainet: neuralCoverage(data, 'forainet', difference) }),
    [data, difference],
  )
  const centre: [number, number] = [(data.bounds[0] + data.bounds[2]) / 2, (data.bounds[1] + data.bounds[3]) / 2]
  const height = Math.max(5, Math.ceil(Math.max(...crop.points.map((p) => p.height)) / 5) * 5)
  const selectedCell = data.cells.features.find((f) => f.properties.id === cell)?.properties
  const onCamera = (c: ComparisonCamera) => setCamera((old) => (sameCamera(old, c) ? old : c))
  const changeView = (v: string) => {
    setView(v)
    onViewChange?.(v)
    setCamera(null)
    setPicked(null)
  }
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" aria-label="Preliminary neural comparison">
      <div className="shrink-0 border-b bg-amber-50 px-3 py-2 text-xs leading-5 dark:bg-amber-950">
        <strong>
          Preliminary · {data.common_returns.toLocaleString()} matched returns (
          {percent(data.common_returns / data.total_returns)} of the tile)
        </strong>
        <span className="ml-2">
          {data.common_chunks}/{data.total_chunks} chunks completed by both models · snapshot{' '}
          {new Date(data.snapshot_utc).toLocaleString()}
        </span>
        <p>
          Full processing continues. This is a saved snapshot of the shared processed area. Tree IDs are local to each
          chunk; final tree totals await boundary merging.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2 text-xs">
        <SegmentedControl
          label="Neural comparison view"
          size="sm"
          fullWidth={false}
          value={view}
          onChange={changeView}
          options={[
            { value: 'trees', label: 'Individual trees' },
            { value: 'coverage', label: 'Coverage maps' },
            { value: '3d', label: '3D samples' },
            { value: 'profile', label: 'Side profiles' },
          ]}
        />
        {view === 'coverage' ? (
          <label>
            <input type="checkbox" checked={difference} onChange={(e) => setDifference(e.target.checked)} /> Show
            assigned / unassigned disagreement
          </label>
        ) : (
          view !== 'trees' && (
            <>
              <label>
                Matched chunk{' '}
                <NativeSelect
                  aria-label="Neural point sample"
                  className="rounded border bg-background p-1.5"
                  value={sample.id}
                  onChange={(e) => {
                    setSampleId(e.target.value)
                    setCamera(null)
                    setPicked(null)
                  }}
                >
                  {data.samples.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id} · {s.original_returns.toLocaleString()} returns
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <SegmentedControl
                label="Neural point colours"
                size="sm"
                fullWidth={false}
                value={colour}
                onChange={(v) => setColour(v as NeuralColour)}
                options={[
                  { value: 'instance', label: 'Tree candidates' },
                  { value: 'semantic', label: 'Point classes' },
                ]}
              />
            </>
          )
        )}
        {view === 'profile' && (
          <label>
            Rotation {angle}°{' '}
            <input
              aria-label="Neural profile rotation"
              type="range"
              min="0"
              max="180"
              step="5"
              value={angle}
              onChange={(e) => setAngle(+e.target.value)}
            />
          </label>
        )}
        {view !== 'trees' && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setReset((n) => n + 1)
              setCamera(null)
            }}
          >
            Fit views
          </Button>
        )}
        <a className="ml-auto underline" href={snapshotUrl} download="preliminary-neural-results.json">
          Download snapshot
        </a>
      </div>
      {view === 'trees' ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <NeuralTreeInspector snapshot={data} basemap={basemap} />
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
            <div className="flex h-full min-h-[470px] flex-col gap-2 lg:min-h-[340px] lg:flex-row">
              {(['sat', 'forainet'] as NeuralModel[]).map((model) => (
                <ComparisonPane
                  key={model}
                  label={model === 'sat' ? 'A' : 'B'}
                  title={NEURAL_NAMES[model]}
                  metrics={[
                    {
                      label: 'Returns assigned to candidates',
                      value: percent(data.models[model].assigned / data.common_returns),
                    },
                    {
                      label: 'Tree-class returns',
                      value: percent(data.models[model].tree_class / data.common_returns),
                    },
                  ]}
                >
                  {view === 'profile' ? (
                    <ComparisonProfile
                      crop={crop}
                      assignments={assignments[model]}
                      angle={angle}
                      height={height}
                      radius={38}
                      picked={picked}
                      onPick={setPicked}
                    />
                  ) : (
                    <ComparisonMap
                      label={`${NEURAL_NAMES[model]} preliminary map`}
                      centre={view === 'coverage' ? centre : crop.centre}
                      bounds={view === 'coverage' ? data.bounds : undefined}
                      focusKey={`neural-${view}-${sample.id}-${reset}`}
                      zoom={view === 'coverage' ? 16 : 19}
                      view={view === 'coverage' ? 'top' : '3d'}
                      basemap={basemap}
                      features={view === 'coverage' ? features[model] : undefined}
                      references={view === 'coverage' ? data.outline : undefined}
                      crop={view === 'coverage' ? null : crop}
                      assignments={assignments[model]}
                      camera={camera}
                      onCamera={onCamera}
                      onFeaturePick={setCell}
                      overlayOpacity={0.8}
                    />
                  )}
                </ComparisonPane>
              ))}
            </div>
          </div>
          <div className="max-h-[24dvh] shrink-0 overflow-y-auto border-t px-3 py-2 text-xs leading-5">
            {view === 'coverage' ? (
              <>
                <p>
                  <strong>
                    {difference ? 'Assigned / unassigned disagreement' : 'Assigned return share'}: 0–100%.
                  </strong>{' '}
                  {difference
                    ? 'Pale yellow → red means more original returns assigned by only one model.'
                    : 'Pale → dark green means a larger share of original returns belongs to accepted candidates.'}{' '}
                  Empty parts of the outlined tile are pending, not zero. Cameras are linked.
                </p>
                <p>
                  Models differ on assignment for{' '}
                  <strong>{percent(data.assignment_disagreement_returns / data.common_returns)}</strong> of matched
                  returns. These shares measure points, not canopy area or accuracy.
                </p>
                {selectedCell && (
                  <p>
                    Chunk {selectedCell.id}: {selectedCell.returns.toLocaleString()} returns · SegmentAnyTree{' '}
                    {percent(selectedCell.sat_share)} assigned · ForAINet {percent(selectedCell.forainet_share)}{' '}
                    assigned · disagreement {percent(selectedCell.disagreement)}.
                  </p>
                )}
              </>
            ) : (
              <>
                <p>
                  Display: {sample.points.length.toLocaleString()} of {sample.original_returns.toLocaleString()}{' '}
                  original returns in chunk {sample.id}. The chunk was processed at 0.2 m voxel spacing, then labels
                  were transferred to every original return.{' '}
                  {colour === 'instance'
                    ? 'Grey = unassigned. Colours distinguish local candidates within each model; they do not match trees across models.'
                    : 'Predicted point classes; original LAS classification is separate.'}
                </p>
                {colour === 'semantic' && (
                  <div className="flex flex-wrap gap-x-4">
                    {(['sat', 'forainet'] as NeuralModel[]).map((model) => (
                      <div key={model}>
                        <strong>{NEURAL_NAMES[model]}:</strong>{' '}
                        {SEMANTIC_NAMES[model].map((name, cls) => (
                          <span className="mr-2 inline-flex items-center gap-1" key={name}>
                            <span
                              className="inline-block h-2 w-2 rounded-full"
                              style={{ background: neuralLabelColour(semanticLabel(model, cls)) }}
                            />
                            {name}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
