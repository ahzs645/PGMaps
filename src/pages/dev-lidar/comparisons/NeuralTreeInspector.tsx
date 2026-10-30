import { NativeSelect } from '@/components/ui/form-field'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import type { Basemap } from '../basemaps'
import type { IsolatedPoint } from '../treeIsolation'
import { ComparisonMap } from './ComparisonMap'
import { ComparisonProfile } from './ComparisonProfile'
import { ComparisonPane } from './ComparisonPane'
import {
  NEURAL_NAMES,
  SEMANTIC_NAMES,
  neuralLabelColour,
  semanticLabel,
  type NeuralModel,
  type NeuralSnapshot,
} from './neuralData'
import {
  checkTreeExamples,
  treeExampleCrop,
  treeExampleAssignments,
  treeLocations,
  treePointCsv,
  type NeuralTreeExamples,
} from './neuralTrees'
import treeUrl from './neural-trees.generated.json?url'

export function NeuralTreeInspector({ snapshot, basemap }: { snapshot: NeuralSnapshot; basemap: Basemap }) {
  const [data, setData] = useState<NeuralTreeExamples | null>(null),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 45000)
    fetch(treeUrl, { signal: abort.signal })
      .then(async (r) => {
        if (!r.ok) throw Error(`Tree examples unavailable (${r.status})`)
        return r.json()
      })
      .then((next) => {
        checkTreeExamples(next, snapshot)
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
  }, [snapshot, attempt])
  if (!data || data.source_sha256 !== snapshot.source_sha256 || data.snapshot_utc !== snapshot.snapshot_utc)
    return (
      <div className="p-4 text-sm" role="status">
        {error || 'Loading full individual-candidate point sets…'}
        {error && (
          <Button
            onClick={() => {
              setError('')
              setAttempt((n) => n + 1)
            }}
          >
            Retry tree examples
          </Button>
        )}
      </div>
    )
  return <NeuralTreeViews data={data} snapshot={snapshot} basemap={basemap} />
}
export function NeuralTreeViews({
  data,
  snapshot,
  basemap,
}: {
  data: NeuralTreeExamples
  snapshot: NeuralSnapshot
  basemap: Basemap
}) {
  const [model, setModel] = useState<NeuralModel>('sat'),
    [chunk, setChunk] = useState(snapshot.samples[0].id),
    [treeId, setTreeId] = useState(''),
    [context, setContext] = useState(false),
    [colour, setColour] = useState('black'),
    [angle, setAngle] = useState(0),
    [picked, setPicked] = useState<IsolatedPoint | null>(null),
    [reset, setReset] = useState(0)
  const modelTrees = useMemo(() => data.trees.filter((t) => t.model === model), [data, model])
  const chunks = [...new Set(modelTrees.map((t) => t.chunk))]
  const activeChunk = chunks.includes(chunk) ? chunk : chunks[0]
  const available = useMemo(() => modelTrees.filter((t) => t.chunk === activeChunk), [modelTrees, activeChunk])
  const tree = available.find((t) => t.id === treeId) ?? available[0]
  const sample = snapshot.samples.find((s) => s.id === tree.chunk)
  const crop = useMemo(() => treeExampleCrop(data, tree, context ? sample : undefined), [data, tree, context, sample])
  const assignments = useMemo(() => treeExampleAssignments(tree, crop, colour === 'semantic'), [tree, crop, colour])
  const locations = useMemo(() => treeLocations(available, tree), [available, tree])
  const chunkCell = snapshot.cells.features.find((f) => f.properties.id === tree.chunk)!
  const bounds = useMemo<[number, number, number, number]>(() => {
    const ring = chunkCell.geometry.coordinates[0]
    return [
      Math.min(...ring.map((p) => p[0])),
      Math.min(...ring.map((p) => p[1])),
      Math.max(...ring.map((p) => p[0])),
      Math.max(...ring.map((p) => p[1])),
    ]
  }, [chunkCell])
  const height = Math.ceil(Math.max(5, ...crop.points.map((p) => p.height)) / 5) * 5
  const radius =
    Math.max(
      3,
      ...crop.points.map((p) =>
        Math.hypot(
          (p.lon - tree.centre[0]) * 111320 * Math.cos((tree.centre[1] * Math.PI) / 180),
          (p.lat - tree.centre[1]) * 111320,
        ),
      ),
    ) + 1
  const zoom = Math.max(17.5, Math.min(21, 21 - Math.log2(Math.max(tree.height_max_m, tree.width_m, 8) / 8)))
  const select = (id: string) => {
    setTreeId(id)
    setPicked(null)
  }
  const index = available.indexOf(tree)
  const download = () => {
    const blob = new Blob([treePointCsv(data, tree)], { type: 'text/csv' }),
      url = URL.createObjectURL(blob),
      a = document.createElement('a')
    a.href = url
    a.download = `${tree.id.replace(/:/g, '-')}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" aria-label="Individual segmented tree inspector">
      <div className="flex max-h-[30dvh] shrink-0 flex-wrap items-center gap-2 overflow-y-auto border-b p-2 text-xs">
        <SegmentedControl
          label="Individual tree model"
          value={model}
          size="sm"
          fullWidth={false}
          onChange={(v) => {
            setModel(v as NeuralModel)
            setTreeId('')
            setPicked(null)
          }}
          options={[
            { value: 'sat', label: 'SegmentAnyTree' },
            { value: 'forainet', label: 'ForAINet' },
          ]}
        />
        <label>
          Chunk{' '}
          <NativeSelect
            aria-label="Individual tree chunk"
            className="rounded border bg-background p-1"
            value={activeChunk}
            onChange={(e) => {
              setChunk(e.target.value)
              setTreeId('')
              setPicked(null)
            }}
          >
            {chunks.map((id) => (
              <option key={id}>{id}</option>
            ))}
          </NativeSelect>
        </label>
        <label>
          Tree candidate{' '}
          <NativeSelect
            aria-label="Individual tree candidate"
            className="max-w-[230px] rounded border bg-background p-1"
            value={tree.id}
            onChange={(e) => select(e.target.value)}
          >
            {available.map((t) => (
              <option key={t.id} value={t.id}>
                #{t.instance} · {t.height_max_m.toFixed(1)} m · {t.core_returns.toLocaleString()} points
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button
          size="sm"
          variant="outline"
          aria-label="Previous tree candidate"
          disabled={index === 0}
          onClick={() => select(available[index - 1].id)}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-label="Next tree candidate"
          disabled={index === available.length - 1}
          onClick={() => select(available[index + 1].id)}
        >
          Next
        </Button>
        <SegmentedControl
          label="Individual tree colours"
          value={colour}
          size="sm"
          fullWidth={false}
          onChange={setColour}
          options={[
            { value: 'black', label: 'Silhouette' },
            { value: 'instance', label: 'Candidate colour' },
            { value: 'semantic', label: 'Point classes' },
          ]}
        />
        <label>
          <input
            aria-label="Show neighbouring points"
            type="checkbox"
            checked={context}
            onChange={(e) => setContext(e.target.checked)}
          />{' '}
          Nearby points
        </label>
        <label>
          Side rotation {angle}°{' '}
          <input
            aria-label="Individual tree rotation"
            type="range"
            min="0"
            max="180"
            step="5"
            value={angle}
            onChange={(e) => setAngle(+e.target.value)}
          />
        </label>
        <Button size="sm" variant="outline" onClick={() => setReset((n) => n + 1)}>
          Fit tree
        </Button>
        <Button size="sm" variant="outline" onClick={download}>
          Download tree CSV
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        <div className="grid h-full min-h-[780px] grid-cols-1 gap-2 md:min-h-[540px] md:grid-cols-2 xl:min-h-[320px] xl:grid-cols-[minmax(190px,.65fr)_1fr_1fr]">
          <ComparisonPane
            label="Location"
            title={`Chunk ${tree.chunk}`}
            metrics={[{ label: 'Packaged candidates in this chunk', value: String(available.length) }]}
          >
            <ComparisonMap
              label="Individual tree location map"
              centre={sample!.centre}
              bounds={bounds}
              focusKey={`tree-location-${tree.chunk}-${reset}`}
              view="top"
              basemap={basemap}
              features={locations}
              onFeaturePick={select}
              overlayOpacity={0.1}
            />
          </ComparisonPane>
          <ComparisonPane
            label="3D"
            title={`${NEURAL_NAMES[model]} · candidate #${tree.instance}`}
            metrics={[
              { label: 'Original core points', value: tree.core_returns.toLocaleString() },
              { label: 'Observed maximum height above DTM', value: `${tree.height_max_m.toFixed(1)} m` },
            ]}
          >
            <ComparisonMap
              label="Isolated neural tree 3D map"
              centre={tree.centre}
              focusKey={`tree-${tree.id}-${reset}`}
              view="3d"
              zoom={zoom}
              basemap={basemap}
              crop={crop}
              assignments={assignments}
              pointColour={colour === 'black' ? 'black' : 'segment'}
              pointSize={2}
            />
          </ComparisonPane>
          <ComparisonPane
            label="Profile"
            title="Side silhouette"
            metrics={[
              { label: '95th percentile height above DTM', value: `${tree.height_p95_m.toFixed(1)} m` },
              { label: 'Observed horizontal diagonal', value: `${tree.width_m.toFixed(1)} m` },
            ]}
          >
            <ComparisonProfile
              minHeight={0}
              crop={crop}
              assignments={assignments}
              colour={colour === 'black' ? 'black' : 'segment'}
              angle={angle}
              height={height}
              radius={radius}
              picked={picked}
              onPick={setPicked}
            />
          </ComparisonPane>
        </div>
      </div>
      <div className="max-h-[20dvh] shrink-0 overflow-y-auto border-t px-3 py-2 text-xs leading-5">
        <p>
          <strong>One candidate, all {tree.core_returns.toLocaleString()} original core points.</strong> Choose a marker
          or use Next to inspect another. The red box marks the observed point bounds, not a surveyed crown footprint.{' '}
          {context
            ? `${(crop.points.length - tree.core_returns).toLocaleString()} nearby display points shown in grey; context is thinned.`
            : 'Neighbouring points are hidden.'}
        </p>
        <p>
          {data.trees.length} packaged examples from seven cached chunks; this is a selected gallery, not the total tree
          count. IDs are local to the model and chunk. A candidate may contain merged crowns or part of a tree; trunks
          and stems may be sparse in airborne LiDAR.{' '}
          {tree.touches_core_boundary && <strong> This candidate touches a chunk boundary and may be clipped.</strong>}
        </p>
        {colour === 'semantic' && (
          <p>
            {SEMANTIC_NAMES[model].map((name, cls) => (
              <span className="mr-3 inline-flex items-center gap-1" key={name}>
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: neuralLabelColour(semanticLabel(model, cls)) }}
                />
                {name}
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  )
}
