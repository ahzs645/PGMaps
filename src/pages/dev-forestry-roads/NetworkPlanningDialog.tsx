import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { ExternalLink } from '@/components/ui/text-button'
import { NativeSelect } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { TabBar } from '@/components/ui/tab-bar'
import { downloadText } from '@/lib/download'
import { Field, NumberField, roadFieldClass } from './Controls'
import { PlanningCoordinateField } from './PlanningCoordinateField'
import { ROADS_EXAMPLES, prepExData } from './roads/examples'
import { runProjection } from './roads/client'
import { rasterToLineSegments } from './roads/utilities'
import { normalizeRoadsOptions } from './roads/graph'
import { MAX_NETWORK_STAGES, MAX_NETWORK_TARGETS, networkSeedReason } from './roads/planning'
import {
  createNetworkPlanning,
  generateNetworkTargets,
  networkDistanceCsv,
  networkGridCsv,
  networkOverlay,
  networkPathAlignment,
  networkResultsCsv,
  parseNetworkScenario,
  prepareNetworkScenario,
  serializeNetworkScenario,
  type NetworkPlanning,
  type PreparedNetworkScenario,
} from './roads/workspace'
import type { RoadsMethod, RoadsOptions, RoadsResultSummary } from './roads/types'
import type { Alignment, Coordinate, RoadProject, TerrainSource } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'

export const NETWORK_METHODS: { value: RoadsMethod; label: string; detail: string }[] = [
  {
    value: 'ilcp',
    label: 'Iterative least-cost paths',
    detail: 'Connect targets in order, reusing each newly projected path.',
  },
  {
    value: 'lcp',
    label: 'Independent least-cost paths',
    detail: 'Connect each target to the supplied roads without updating costs between targets.',
  },
  {
    value: 'mst',
    label: 'Minimum spanning tree',
    detail: 'Connect target terminals using a tree of pairwise least-cost paths.',
  },
  {
    value: 'snap',
    label: 'Straight-line connections',
    detail:
      'Connect targets to the nearest road using rasterized straight segments. Review blocked-cell failures before using a result.',
  },
]
const fmt = (n: number, digits = 1) =>
  Number.isFinite(n) ? n.toLocaleString('en-CA', { maximumFractionDigits: digits }) : '—'
const methodLabel = (method: RoadsMethod) => NETWORK_METHODS.find((entry) => entry.value === method)!.label
const failure = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))
/** File.text cannot be stopped, but cancellation releases the UI and makes its late result inert. */
function readScenarioText(file: File, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown, text?: string) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', cancelled)
      if (error) reject(error)
      else resolve(text!)
    }
    const cancelled = () => finish(signal.reason ?? new DOMException('Scenario import cancelled.', 'AbortError'))
    signal.addEventListener('abort', cancelled, { once: true })
    if (signal.aborted) cancelled()
    else
      file.text().then(
        (text) => finish(undefined, text),
        (error: unknown) => finish(error),
      )
  })
}
type Review = {
  prepared: PreparedNetworkScenario
  results: RoadsResultSummary[]
  project: RoadProject
  source: TerrainSource
}

/** Network candidates remain separate from detailed road geometry until a branch is explicitly adopted. */
export function NetworkPlanningDialog({
  workspace: w,
  open,
  onOpenChange,
  onPreview,
  onAdopt,
  portalContainer,
}: {
  workspace: RoadWorkspace
  open: boolean
  onOpenChange: (open: boolean) => void
  onPreview: (overlay: GeoJSON.FeatureCollection | null) => void
  onAdopt: (alignment: Alignment) => void
  portalContainer?: HTMLElement | null
}) {
  const [tab, setTab] = useState<'setup' | 'results'>('setup')
  const [review, setReview] = useState<Review | null>(null)
  const [selectedMethod, setSelectedMethod] = useState<RoadsMethod>('ilcp')
  const [selectedPath, setSelectedPath] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [targetName, setTargetName] = useState('Landing')
  const [targetCoordinate, setTargetCoordinate] = useState<Coordinate | null>(null)
  const [targetStage, setTargetStage] = useState(1)
  const [compare, setCompare] = useState(false)
  const [reconstructionMethod, setReconstructionMethod] = useState<'nearest' | 'mst'>('nearest')
  const [reconstructionSource, setReconstructionSource] = useState<'seeds' | 'network'>('network')
  const fileInput = useRef<HTMLInputElement>(null)
  const abort = useRef<AbortController | null>(null)
  const current = useRef({ project: w.project, source: w.source, open })
  current.current = { project: w.project, source: w.source, open }
  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => {
    if (!open) abort.current?.abort()
  }, [open])
  const planning = w.project.networkPlanning ?? createNetworkPlanning(w.project)
  const stale = !!review && (review.project !== w.project || review.source !== w.source)
  const activeResult = review?.results.find((result) => result.method === selectedMethod) ?? review?.results[0]
  const activePath = activeResult?.paths.find((path) => path.id === selectedPath) ?? activeResult?.paths[0]
  const patch = (next: Partial<NetworkPlanning>) => {
    onPreview(null)
    setNote('')
    w.update((project) => ({
      ...project,
      networkPlanning: { ...(project.networkPlanning ?? createNetworkPlanning(project)), ...next },
    }))
  }
  const options = (next: Partial<RoadsOptions>) => patch({ options: { ...planning.options, ...next } })
  const chooseExample = (id: string) => {
    if (id === 'imported') return patch({ exampleId: id })
    try {
      const example = prepExData(id)
      patch({
        mode: 'example',
        exampleId: id,
        importedScenario: undefined,
        options: normalizeRoadsOptions(example.input.options),
      })
    } catch (cause) {
      setError(failure(cause))
    }
  }
  const close = () => {
    abort.current?.abort()
    onOpenChange(false)
  }
  const calculate = async () => {
    if (running || w.busy) return
    const controller = new AbortController()
    abort.current = controller
    const project = w.project,
      source = w.source
    setError('')
    setNote('')
    setRunning(true)
    onPreview(null)
    setProgress('Preparing terrain, road seeds and targets…')
    try {
      const prepared = await prepareNetworkScenario(project, source, planning, {
        signal: controller.signal,
        onProgress: setProgress,
      })
      const methods = compare ? NETWORK_METHODS.map((method) => method.value) : [planning.options.method]
      const results: RoadsResultSummary[] = []
      for (const method of methods) {
        controller.signal.throwIfAborted()
        const input = { ...prepared.input, options: { ...prepared.input.options, method } }
        results.push(
          await runProjection(input, {
            signal: controller.signal,
            stages: prepared.stages,
            onProgress: (message) => setProgress(`${methodLabel(method)} · ${message}`),
          }),
        )
      }
      controller.signal.throwIfAborted()
      if (current.current.project !== project || current.current.source !== source)
        throw Error('The project or terrain changed during the run. Run the network again before using it.')
      setReview({ prepared, results, project, source })
      setSelectedMethod(planning.options.method)
      setSelectedPath('')
      setTab('results')
      const result = results.find((item) => item.method === planning.options.method) ?? results[0]
      if (prepared.canAdopt) onPreview(networkOverlay(prepared, result))
    } catch (cause) {
      if (abort.current === controller) {
        if (controller.signal.aborted) setNote('Network calculation cancelled. The project roads were retained.')
        else setError(failure(cause))
      }
    } finally {
      if (abort.current === controller) {
        abort.current = null
        setRunning(false)
        setProgress('')
      }
    }
  }
  const generate = async () => {
    if (running || w.busy) return
    const controller = new AbortController()
    abort.current = controller
    setError('')
    setRunning(true)
    setProgress('Generating landing candidates inside harvest polygons…')
    const project = w.project,
      source = w.source
    try {
      const targets = await generateNetworkTargets(project, source, planning)
      controller.signal.throwIfAborted()
      if (current.current.project !== project || current.current.source !== source)
        throw Error('Inputs changed while generating landings. Try again.')
      patch({ targets })
      setNote(
        `Generated ${targets.length} landing candidates. Review their positions and assign stages before projecting roads.`,
      )
    } catch (cause) {
      if (abort.current === controller) {
        if (controller.signal.aborted) setNote('Landing generation cancelled. Existing targets were retained.')
        else setError(failure(cause))
      }
    } finally {
      if (abort.current === controller) {
        abort.current = null
        setRunning(false)
        setProgress('')
      }
    }
  }
  const importScenario = async (file?: File) => {
    if (!file || w.busy || !open) return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const project = w.project,
      source = w.source
    setError('')
    setNote('')
    setRunning(true)
    setProgress('Reading network scenario…')
    try {
      if (file.size > 32 * 1024 * 1024)
        throw Error('Use a network scenario file smaller than 32 MB; crop larger grids first.')
      const text = await readScenarioText(file, controller.signal)
      controller.signal.throwIfAborted()
      if (abort.current !== controller || !current.current.open) return
      if (current.current.project !== project || current.current.source !== source)
        throw Error(
          'The project or terrain changed while reading the file. Import the scenario again in the intended project.',
        )
      const parsed = parseNetworkScenario(JSON.parse(text))
      patch(parsed)
      setTab('setup')
      setNote(
        'Imported network inputs. Recalculate to verify the result with the current engine. Imported raster examples use their own local grid.',
      )
    } catch (cause) {
      if (abort.current === controller) {
        if (controller.signal.aborted) setNote('Scenario import cancelled. Existing inputs were retained.')
        else setError(failure(cause))
      }
    } finally {
      if (abort.current === controller) {
        abort.current = null
        setRunning(false)
        setProgress('')
      }
    }
  }
  const adopt = () => {
    if (!review || !activeResult || !activePath || stale || running || !review.prepared.canAdopt) return
    try {
      const candidate = networkPathAlignment(
        {
          ...review.prepared,
          planning: {
            ...review.prepared.planning,
            options: { ...review.prepared.planning.options, method: activeResult.method },
          },
        },
        activePath,
        w.alignment.template,
      )
      onAdopt(candidate)
      onPreview(null)
      onOpenChange(false)
    } catch (cause) {
      setError(failure(cause))
    }
  }
  const inspect = () => {
    if (!review || !activeResult || stale || !review.prepared.canAdopt) return
    onPreview(networkOverlay(review.prepared, activeResult, activePath?.id))
    onOpenChange(false)
  }
  const reconstruct = async () => {
    if (!review || !activeResult || stale || running) return
    const controller = new AbortController()
    abort.current = controller
    const project = w.project,
      source = w.source
    setError('')
    setNote('')
    setRunning(true)
    setProgress('Reconstructing bounded raster road linework…')
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      controller.signal.throwIfAborted()
      if (abort.current !== controller || !current.current.open) return
      if (current.current.project !== project || current.current.source !== source)
        throw Error('The project or terrain changed before reconstruction. Recalculate before exporting linework.')
      const roadCells =
        reconstructionSource === 'seeds' ? review.prepared.input.roadCells : activeResult.simulation.roadCells
      const reconstructed = rasterToLineSegments(review.prepared.input.grid, roadCells, {
        method: reconstructionMethod,
      })
      downloadText(
        JSON.stringify(
          {
            schema: 'pgmaps-raster-road-lines-v1',
            method: reconstructionMethod,
            source: reconstructionSource,
            provenance: review.prepared.provenance,
            epsg: review.prepared.epsg,
            coordinateBasis: review.prepared.epsg
              ? `EPSG:${review.prepared.epsg}`
              : 'Local scenario metres; no geographic datum',
            status: 'Approximate raster reconstruction; inferred gap connections are not proposed or surveyed roads',
            ...reconstructed,
          },
          null,
          2,
        ),
        'road-cell-reconstruction.json',
        'application/json',
      )
      setNote(`Exported ${reconstructed.lines.length} reconstructed line segments. ${reconstructed.warnings.join(' ')}`)
    } catch (cause) {
      if (abort.current === controller) {
        if (controller.signal.aborted) setNote('Raster reconstruction cancelled. No file was exported.')
        else setError(failure(cause))
      }
    } finally {
      if (abort.current === controller) {
        abort.current = null
        setRunning(false)
        setProgress('')
      }
    }
  }
  if (!open) return null
  return (
    <DialogShell
      title="Road network planning"
      subtitle="Multiple landings · existing access · browser calculations"
      size="xl"
      portalContainer={portalContainer}
      onClose={close}
      contentProps={{ 'data-testid': 'road-network-dialog' }}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void calculate()} disabled={running || !!w.busy}>
            {compare ? 'Compare network methods' : 'Project road network'}
          </Button>
          {running && abort.current && (
            <Button variant="outline" onClick={() => abort.current?.abort()}>
              Cancel network calculation
            </Button>
          )}
          <Button variant="outline" onClick={close}>
            Close
          </Button>
          <span className="min-w-0 text-xs text-muted-foreground" role="status" aria-live="polite">
            {progress}
          </span>
        </div>
      }
    >
      <div className="space-y-4">
        <TabBar
          label="Network planning view"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'setup', label: 'Inputs & scenarios' },
            { value: 'results', label: 'Results & utilities' },
          ]}
        />
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
        {note && (
          <p className="text-sm" role="status">
            {note}
          </p>
        )}
        {stale && (
          <InlineAlert tone="warning">
            The project or inputs changed. Recalculate before map inspection, adoption or exporting a current result.
            The previous result remains visible for reference.
          </InlineAlert>
        )}
        <div hidden={tab !== 'setup'}>
          <fieldset disabled={running || !!w.busy} className="min-w-0 space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Network input source">
                <NativeSelect
                  className={roadFieldClass}
                  value={planning.mode}
                  onChange={(event) => {
                    if (event.target.value === 'example' && planning.exampleId !== 'imported')
                      chooseExample(planning.exampleId)
                    else
                      patch({
                        mode: event.target.value as NetworkPlanning['mode'],
                        ...(event.target.value === 'project'
                          ? { options: { ...planning.options, gradeMode: 'terrain', preventCornerCutting: true } }
                          : {}),
                      })
                  }}
                >
                  <option value="project">Current terrain and project features</option>
                  <option value="example">Example or imported raster scenario</option>
                </NativeSelect>
              </Field>
              <div className="flex items-end gap-2">
                <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                  Import network scenario JSON
                </Button>
                <input
                  ref={fileInput}
                  className="hidden"
                  type="file"
                  accept=".json,application/json"
                  aria-label="Network scenario file"
                  onChange={(event) => {
                    void importScenario(event.target.files?.[0])
                    event.target.value = ''
                  }}
                />
              </div>
            </div>
            {planning.mode === 'example' ? (
              <div className="space-y-2 rounded-lg border p-3">
                <Field label="Network example">
                  <NativeSelect
                    className={roadFieldClass}
                    value={planning.exampleId}
                    onChange={(event) => chooseExample(event.target.value)}
                  >
                    {ROADS_EXAMPLES.map((example) => (
                      <option key={example.id} value={example.id}>
                        {example.name}
                      </option>
                    ))}
                    {planning.exampleId === 'imported' && <option value="imported">Imported raster scenario</option>}
                  </NativeSelect>
                </Field>
                <p className="text-sm">
                  {ROADS_EXAMPLES.find((example) => example.id === planning.exampleId)?.description ??
                    'Your imported grid, road seeds and target cells are preserved.'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {ROADS_EXAMPLES.find((example) => example.id === planning.exampleId)?.focus} Examples use a local grid
                  and appear in the result preview. Switch to current project inputs to create georeferenced roads.
                </p>
              </div>
            ) : (
              <>
                <div className="rounded-lg border p-3">
                  <h3 className="mb-2 text-sm font-semibold">Existing roads to connect to</h3>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Select road sections explicitly. Review their reuse, access and condition inputs under Terrain →
                    Review existing roads before including them.
                  </p>
                  <div className="max-h-44 space-y-2 overflow-y-auto">
                    {w.project.context
                      .filter((feature) => feature.kind === 'existing-road')
                      .map((road) => {
                        const reason = networkSeedReason(road),
                          eligible = reason === null
                        return (
                          <label key={road.id} className="flex items-start gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="mt-1"
                              disabled={!eligible}
                              checked={planning.roadIds.includes(road.id)}
                              onChange={(event) =>
                                patch({
                                  roadIds: event.target.checked
                                    ? [...planning.roadIds, road.id]
                                    : planning.roadIds.filter((id) => id !== road.id),
                                })
                              }
                            />
                            <span>
                              {road.name}
                              {reason && <span className="block text-xs text-muted-foreground">{reason}</span>}
                            </span>
                          </label>
                        )
                      })}
                    {!w.project.context.some((feature) => feature.kind === 'existing-road') && (
                      <p className="text-sm">
                        Import road context or open a training project to select existing access.
                      </p>
                    )}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <NumberField
                    label="Network grid cell (m)"
                    value={planning.cellM}
                    min={1}
                    max={1000}
                    step={1}
                    onChange={(cellM) => patch({ cellM })}
                    hint="A coarser grid reduces computation and changes the available routes. The result records the actual grid spacing."
                  />
                  <NumberField
                    label="Search margin (m)"
                    value={planning.marginM}
                    min={0}
                    max={10000}
                    step={25}
                    onChange={(marginM) => patch({ marginM })}
                  />
                  <NumberField
                    label="Uniform cell weight"
                    value={planning.baseWeight}
                    min={0.001}
                    max={1000000}
                    step={1}
                    onChange={(baseWeight) => patch({ baseWeight })}
                    hint="Relative resistance per metre for simple weights. This is not a construction price. Import a raster scenario for spatially varying weights."
                  />
                </div>
                <div className="space-y-3 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">Landing targets ({planning.targets.length})</h3>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!planning.targets.length}
                      onClick={() => patch({ targets: [] })}
                    >
                      Clear targets
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Targets in stage 1 are connected first. Later stages reuse the preceding projected network. Every
                    rejected or unreachable target is reported. A run supports up to {MAX_NETWORK_TARGETS} targets
                    across {MAX_NETWORK_STAGES} stages.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="New target name">
                      <input
                        className={roadFieldClass}
                        value={targetName}
                        maxLength={200}
                        onChange={(event) => setTargetName(event.target.value)}
                      />
                    </Field>
                    <NumberField
                      label="New target stage"
                      value={targetStage}
                      min={1}
                      max={MAX_NETWORK_STAGES}
                      step={1}
                      onChange={(value) => setTargetStage(Math.round(value))}
                    />
                  </div>
                  <PlanningCoordinateField label="New target" value={targetCoordinate} onChange={setTargetCoordinate} />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setTargetCoordinate([...w.alignment.points.at(-1)!.coordinate])}
                    >
                      Use active road end
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setTargetCoordinate([...w.alignment.points[0].coordinate])}
                    >
                      Use active road start
                    </Button>
                    <Button
                      size="sm"
                      disabled={
                        !targetCoordinate || !targetName.trim() || planning.targets.length >= MAX_NETWORK_TARGETS
                      }
                      onClick={() => {
                        if (targetCoordinate) {
                          patch({
                            targets: [
                              ...planning.targets,
                              {
                                id: crypto.randomUUID(),
                                name: targetName.trim(),
                                coordinate: [...targetCoordinate],
                                stage: targetStage,
                              },
                            ],
                          })
                          setTargetName(`Landing ${planning.targets.length + 2}`)
                        }
                      }}
                    >
                      Add landing target
                    </Button>
                  </div>
                  {planning.targets.length > 0 && (
                    <div
                      className="max-h-72 space-y-3 overflow-y-auto rounded border p-2"
                      aria-label="Landing target editor"
                    >
                      {planning.targets.map((target, index) => (
                        <div key={target.id} className="space-y-2 border-b pb-2 last:border-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">
                              {index + 1}. {target.name}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Remove target ${target.name}`}
                              onClick={() =>
                                patch({ targets: planning.targets.filter((item) => item.id !== target.id) })
                              }
                            >
                              Remove
                            </Button>
                          </div>
                          <PlanningCoordinateField
                            label={`Target ${index + 1}`}
                            value={target.coordinate}
                            onChange={(coordinate) => {
                              if (coordinate)
                                patch({
                                  targets: planning.targets.map((item) =>
                                    item.id === target.id ? { ...item, coordinate } : item,
                                  ),
                                })
                            }}
                          />
                          <NumberField
                            label={`Target ${index + 1} stage`}
                            value={target.stage}
                            min={1}
                            max={MAX_NETWORK_STAGES}
                            step={1}
                            onChange={(stage) =>
                              patch({
                                targets: planning.targets.map((item) =>
                                  item.id === target.id ? { ...item, stage: Math.round(stage) } : item,
                                ),
                              })
                            }
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  <details className="rounded border p-2 text-sm">
                    <summary className="cursor-pointer font-medium">Generate targets from harvest polygons</summary>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <Field label="Landing sampling">
                        <NativeSelect
                          className={roadFieldClass}
                          value={planning.landingMethod}
                          onChange={(event) =>
                            patch({ landingMethod: event.target.value as NetworkPlanning['landingMethod'] })
                          }
                        >
                          <option value="centroid">Interior point per polygon</option>
                          <option value="systematic">Regular spacing</option>
                          <option value="random">Seeded random sampling</option>
                        </NativeSelect>
                      </Field>
                      <NumberField
                        label="Landings per hectare"
                        value={planning.landingDensity}
                        min={0.001}
                        max={100}
                        step={0.01}
                        onChange={(landingDensity) => patch({ landingDensity })}
                      />
                      <NumberField
                        label="Landing random seed"
                        value={planning.randomSeed}
                        min={0}
                        max={2147483647}
                        step={1}
                        onChange={(seed) => patch({ randomSeed: Math.round(seed) })}
                      />
                    </div>
                    <p className="my-2 text-xs text-muted-foreground">
                      Uses loaded harvest polygons, preserves holes and rejects unusable terrain. Generated points are
                      candidates; access and landing suitability need review. Generation replaces the target list.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void generate()}
                      disabled={!w.project.context.some((feature) => feature.kind === 'harvest')}
                    >
                      Generate polygon landing candidates
                    </Button>
                  </details>
                </div>
              </>
            )}
            <NetworkOptions value={planning.options} projectMode={planning.mode === 'project'} onChange={options} />
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={compare}
                onChange={(event) => setCompare(event.target.checked)}
              />
              <span>Compare all four methods using the same inputs and stages</span>
            </label>
            <p className="text-xs text-muted-foreground">
              The objectives are relative network weights. They do not include engineered cut/fill, culverts,
              rehabilitation, loaded haul or construction quantities. Use Complete route cost comparison for those
              entered costs.
            </p>
          </fieldset>
        </div>
        <div hidden={tab !== 'results'} className="space-y-4">
          {!review || !activeResult ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Choose project inputs or a scenario, then project the network.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">{review.prepared.provenance}</p>
              {review.results.length > 1 && (
                <div className="overflow-x-auto rounded border">
                  <EngineeringTable rowHeaders>
                    <caption className="whitespace-normal p-2 text-left text-xs font-semibold">
                      Method comparison · relative objective, unique edge lengths
                    </caption>
                    <thead>
                      <tr>
                        <ColumnHeader label="Method" className="text-left" />
                        <ColumnHeader label="New road" unit="m" />
                        <ColumnHeader label="Reused" unit="m" />
                        <ColumnHeader label="Objective" />
                        <ColumnHeader label="Targets reached" />
                      </tr>
                    </thead>
                    <tbody>
                      {review.results.map((result) => (
                        <tr key={result.method} aria-selected={result === activeResult}>
                          <th scope="row">
                            <button
                              className="text-left underline underline-offset-2"
                              aria-pressed={result === activeResult}
                              onClick={() => {
                                setSelectedMethod(result.method)
                                setSelectedPath('')
                                onPreview(null)
                              }}
                            >
                              {methodLabel(result.method)}
                            </button>
                          </th>
                          <td>{fmt(result.newLengthM)}</td>
                          <td>{fmt(result.reusedLengthM)}</td>
                          <td>{fmt(result.objective, 2)}</td>
                          <td>
                            {
                              result.targets.filter(
                                (target) => target.status === 'connected' || target.status === 'already-connected',
                              ).length
                            }
                            /{result.targets.length}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </EngineeringTable>
                </div>
              )}
              <NetworkResultPreview prepared={review.prepared} result={activeResult} selectedPathId={activePath?.id} />
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {[
                  ['New road', `${fmt(activeResult.newLengthM)} m`],
                  ['Reused', `${fmt(activeResult.reusedLengthM)} m`],
                  ['Relative objective', fmt(activeResult.objective, 2)],
                  ['Stages completed', fmt(activeResult.simulation.stage, 0)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded border p-3">
                    <span className="block text-xs text-muted-foreground">{label}</span>
                    <strong className="text-lg">{value}</strong>
                  </div>
                ))}
              </div>
              {review.prepared.warnings.length + activeResult.warnings.length > 0 && (
                <InlineAlert tone="warning">
                  <ul className="list-disc space-y-1 pl-4">
                    {[...new Set([...review.prepared.warnings, ...activeResult.warnings])].map((warning, i) => (
                      <li key={i}>{warning}</li>
                    ))}
                  </ul>
                </InlineAlert>
              )}
              <div className="overflow-x-auto rounded border">
                <EngineeringTable variant="text" rowHeaders aria-label="Network target outcomes">
                  <thead>
                    <tr>
                      <ColumnHeader label="Landing" />
                      <ColumnHeader label="Status" />
                      <ColumnHeader label="Grid cell" />
                      <ColumnHeader label="Details" />
                    </tr>
                  </thead>
                  <tbody>
                    {activeResult.targets.map((target, index) => (
                      <tr key={`${target.id}-${index}`}>
                        <th scope="row">{target.name ?? target.id}</th>
                        <td>{target.status.replace(/-/g, ' ')}</td>
                        <td>{target.cell}</td>
                        <td>
                          {target.message ?? `${target.pathIds.length} path${target.pathIds.length === 1 ? '' : 's'}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </EngineeringTable>
              </div>
              {activeResult.paths.length > 0 && (
                <div className="space-y-2 rounded border p-3">
                  <Field label="Projected branch">
                    <NativeSelect
                      className={roadFieldClass}
                      value={activePath?.id ?? ''}
                      onChange={(event) => setSelectedPath(event.target.value)}
                    >
                      {activeResult.paths.map((path, i) => (
                        <option key={path.id} value={path.id}>
                          Branch {i + 1} · {fmt(path.lengthM)} m · {path.targetIds.join(', ') || 'network connector'}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <p className="text-xs text-muted-foreground">
                    A raster branch has sharp cell-to-cell corners. Adoption creates an editable road with no fitted
                    curves or designed vertical profile. Existing seed-road runs at its ends are trimmed; a path with an
                    interior seed-road run needs splitting before adoption. Previously projected branches can share
                    portions, so review overlap before adding construction quantities across roads. Use the curve,
                    switchback, profile and section tools to refine it.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={stale || running || !review.prepared.canAdopt}
                      onClick={inspect}
                    >
                      Inspect network on project map
                    </Button>
                    <Button
                      size="sm"
                      disabled={stale || running || !review.prepared.canAdopt || !!w.busy}
                      onClick={adopt}
                    >
                      Use branch as new road
                    </Button>
                  </div>
                  {!review.prepared.canAdopt && (
                    <p className="text-xs text-muted-foreground">
                      This local raster scenario has no verified map projection. Run against current project terrain to
                      adopt a branch.
                    </p>
                  )}
                </div>
              )}
              <div className="space-y-2 rounded border p-3">
                <h3 className="text-sm font-semibold">Exports and raster utilities</h3>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={stale || running}
                    onClick={() =>
                      downloadText(
                        serializeNetworkScenario(review.prepared, review.results),
                        'road-network-scenario.json',
                        'application/json',
                      )
                    }
                  >
                    Network scenario JSON
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={stale || running}
                    onClick={() =>
                      downloadText(networkResultsCsv(activeResult), 'road-network-results.csv', 'text/csv')
                    }
                  >
                    Network results CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={stale || running}
                    onClick={() =>
                      downloadText(networkGridCsv(review.prepared, activeResult), 'road-network-grid.csv', 'text/csv')
                    }
                  >
                    Weight and road-cell grid CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={stale || running}
                    onClick={() => {
                      try {
                        downloadText(networkDistanceCsv(review.prepared), 'road-network-proximity.csv', 'text/csv')
                      } catch (cause) {
                        setError(failure(cause))
                      }
                    }}
                  >
                    Distance from roads CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={stale || running || !review.prepared.canAdopt}
                    onClick={() =>
                      downloadText(
                        JSON.stringify(networkOverlay(review.prepared, activeResult), null, 2),
                        'road-network.geojson',
                        'application/geo+json',
                      )
                    }
                  >
                    Network GeoJSON
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Grid coordinates and cell IDs refer to the recorded analysis grid. Road proximity is straight-line
                  Euclidean distance from seed cells, not haul distance or accumulated route cost.
                </p>
                <details className="rounded border p-2">
                  <summary className="cursor-pointer text-sm font-medium">Reconstruct raster road lines</summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Raster road line method">
                      <NativeSelect
                        className={roadFieldClass}
                        value={reconstructionMethod}
                        disabled={running}
                        onChange={(event) => setReconstructionMethod(event.target.value as 'nearest' | 'mst')}
                      >
                        <option value="nearest">Nearest road-cell pairs</option>
                        <option value="mst">MST over raster road cells</option>
                      </NativeSelect>
                    </Field>
                    <Field label="Raster road cells">
                      <NativeSelect
                        className={roadFieldClass}
                        value={reconstructionSource}
                        disabled={running}
                        onChange={(event) => setReconstructionSource(event.target.value as 'seeds' | 'network')}
                      >
                        <option value="network">Seeds and projected network</option>
                        <option value="seeds">Original road seed cells only</option>
                      </NativeSelect>
                    </Field>
                  </div>
                  <p className="my-2 text-xs text-muted-foreground">
                    Reconstruction approximates linework from occupied cells. It can infer connections across gaps and
                    cannot establish junctions or grade-separated crossings. The exported JSON retains every warning and
                    inferred cell. It is not adopted as a designed road. Limit: 512 road cells and the documented
                    computation budget.
                  </p>
                  <Button variant="outline" size="sm" disabled={stale || running} onClick={() => void reconstruct()}>
                    Export reconstructed raster lines
                  </Button>
                </details>
              </div>
            </>
          )}
        </div>
        <details className="rounded border p-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium">Methods and source</summary>
          <p className="mt-2">
            Browser adaptation of{' '}
            <ExternalLink
              href="https://github.com/LandSciTech/roads"
              hideIcon
              className="inline font-normal text-inherit underline dark:text-inherit"
            >
              LandSciTech/roads
            </ExternalLink>
            , with Apache-2.0 attribution included in the code. Network projection runs in a browser worker. Method
            choices can produce different networks; a minimum spanning tree of terminal paths does not establish a
            globally optimal engineered road network.
          </p>
          <p className="mt-2">
            Raster cells approximate road placement and constraints. Missing terrain remains blocked. Network
            projections require field review and detailed geometric design before use as constructed access.
          </p>
        </details>
      </div>
    </DialogShell>
  )
}

function NetworkOptions({
  value,
  projectMode,
  onChange,
}: {
  value: RoadsOptions
  projectMode: boolean
  onChange: (next: Partial<RoadsOptions>) => void
}) {
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <h3 className="text-sm font-semibold">Network method and weights</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Network method">
          <NativeSelect
            className={roadFieldClass}
            value={value.method}
            onChange={(event) => onChange({ method: event.target.value as RoadsMethod })}
          >
            {NETWORK_METHODS.map((method) => (
              <option key={method.value} value={method.value}>
                {method.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Grid neighbourhood">
          <NativeSelect
            className={roadFieldClass}
            value={value.neighbourhood}
            onChange={(event) => onChange({ neighbourhood: event.target.value as RoadsOptions['neighbourhood'] })}
          >
            <option value="rook">Rook · 4 neighbours</option>
            <option value="queen">Queen · 8 neighbours</option>
            <option value="octagon">Octagon · 8 neighbours, diagonal distance correction</option>
          </NativeSelect>
        </Field>
        <Field label="Edge weighting">
          <NativeSelect
            className={roadFieldClass}
            value={value.weightFunction}
            onChange={(event) => onChange({ weightFunction: event.target.value as RoadsOptions['weightFunction'] })}
          >
            <option value="simple">Simple · mean cell weight × length</option>
            <option value="grade">Elevation grade penalty</option>
          </NativeSelect>
        </Field>
        <Field label="Landing connection order (iterative method)">
          <NativeSelect
            className={roadFieldClass}
            value={value.ordering}
            onChange={(event) => onChange({ ordering: event.target.value as RoadsOptions['ordering'] })}
          >
            <option value="closest">Closest first</option>
            <option value="farthest">Farthest first</option>
            <option value="input">Input order</option>
            <option value="random">Seeded random order</option>
          </NativeSelect>
        </Field>
        {value.ordering === 'random' && (
          <NumberField
            label="Connection random seed"
            value={value.randomSeed}
            min={0}
            max={2147483647}
            step={1}
            onChange={(seed) => onChange({ randomSeed: Math.round(seed) })}
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {NETWORK_METHODS.find((method) => method.value === value.method)!.detail}
      </p>
      {value.method === 'snap' && (
        <p className="text-xs text-muted-foreground">
          The straight-line method ignores the neighbourhood and landing-order choices. Those settings still apply to
          the applicable methods when comparing all four.
        </p>
      )}
      {value.weightFunction === 'grade' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            label="Grade base weight"
            value={value.grade.baseCost}
            min={0.001}
            max={1000000}
            step={1}
            onChange={(baseCost) => onChange({ grade: { ...value.grade, baseCost } })}
          />
          <NumberField
            label="Grade limit (%)"
            value={value.grade.limit}
            min={0.1}
            max={100}
            step={0.5}
            onChange={(limit) => onChange({ grade: { ...value.grade, limit } })}
          />
          <NumberField
            label="Grade penalty"
            value={value.grade.penalty}
            min={0}
            max={1000000}
            step={1}
            onChange={(penalty) => onChange({ grade: { ...value.grade, penalty } })}
          />
          <Field label="Grade limit treatment">
            <NativeSelect
              className={roadFieldClass}
              value={value.grade.limitWeight === undefined ? 'blocked' : 'penalty'}
              onChange={(event) => {
                const { limitWeight: _previous, ...grade } = value.grade
                void _previous
                onChange({
                  grade: event.target.value === 'blocked' ? grade : { ...grade, limitWeight: grade.baseCost * 10 },
                })
              }}
            >
              <option value="blocked">Block over-limit edges</option>
              <option value="penalty">Allow with entered penalty</option>
            </NativeSelect>
          </Field>
          {value.grade.limitWeight !== undefined && (
            <NumberField
              label="Over-limit weight per metre"
              value={value.grade.limitWeight}
              min={0}
              max={1000000000}
              step={100}
              onChange={(limitWeight) => onChange({ grade: { ...value.grade, limitWeight } })}
            />
          )}
          {!projectMode && (
            <Field label="Grade raster interpretation">
              <NativeSelect
                className={roadFieldClass}
                value={value.gradeMode}
                onChange={(event) => onChange({ gradeMode: event.target.value as RoadsOptions['gradeMode'] })}
              >
                <option value="terrain">Separate unchanged terrain elevations</option>
                <option value="upstream">Upstream R overloaded-weight convention</option>
              </NativeSelect>
            </Field>
          )}
        </div>
      )}
      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={value.roadsInWeight}
          onChange={(event) => onChange({ roadsInWeight: event.target.checked })}
        />
        <span>Preserve supplied weights on road cells (otherwise burn selected road cells to zero)</span>
      </label>
      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={value.roadsConnected}
          onChange={(event) => onChange({ roadsConnected: event.target.checked })}
        />
        <span>
          Treat seed roads as one network connected at zero cost (MST option; zero-cost connectivity is checked)
        </span>
      </label>
      {!projectMode && (
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={value.preventCornerCutting}
            onChange={(event) => onChange({ preventCornerCutting: event.target.checked })}
          />
          <span>Prevent diagonal paths cutting blocked-cell corners</span>
        </label>
      )}
      <p className="text-xs text-muted-foreground">
        Project runs preserve elevation separately from road weights and prevent paths cutting blocked cell corners.
        Grade limits apply to the raster route, not a designed vertical alignment.
      </p>
    </div>
  )
}

/** Exact branch geometry over a bounded visual sample of the raster; no geographic assumption for examples. */
export function NetworkResultPreview({
  prepared,
  result,
  selectedPathId,
}: {
  prepared: PreparedNetworkScenario
  result: RoadsResultSummary
  selectedPathId?: string
}) {
  const grid = prepared.input.grid
  const stride = Math.max(1, Math.ceil(Math.sqrt(grid.values.length / 4096)))
  const cells: { x: number; y: number; value: number }[] = []
  for (let row = 0; row < grid.height; row += stride)
    for (let col = 0; col < grid.width; col += stride)
      cells.push({ x: col, y: row, value: grid.values[row * grid.width + col] })
  const finite = cells.filter((cell) => Number.isFinite(cell.value)).map((cell) => cell.value)
  const min = Math.min(...finite),
    max = Math.max(...finite)
  const point = (cell: number) => [(cell % grid.width) + 0.5, Math.floor(cell / grid.width) + 0.5]
  const width = Math.max(grid.width, grid.height) / 250
  const seedCells = [
    ...new Set(prepared.input.roadCells.filter((cell) => cell >= 0 && cell < grid.values.length)),
  ].sort((a, b) => a - b)
  const seedRuns: { first: number; last: number }[] = []
  for (const cell of seedCells) {
    const previous = seedRuns.at(-1)
    if (
      previous &&
      cell === previous.last + 1 &&
      Math.floor(cell / grid.width) === Math.floor(previous.first / grid.width)
    )
      previous.last = cell
    else seedRuns.push({ first: cell, last: cell })
  }
  return (
    <figure className="space-y-2 rounded-lg border p-3" data-testid="network-result-preview">
      <figcaption className="text-sm font-semibold">
        {methodLabel(result.method)} · {grid.width} × {grid.height} cells at {fmt(grid.cellM, 2)} m
      </figcaption>
      <svg
        role="img"
        aria-label="Projected network on the analysis grid"
        viewBox={`0 0 ${grid.width} ${grid.height}`}
        className="max-h-96 w-full rounded bg-slate-100"
      >
        {cells.map((cell) => (
          <rect
            key={`${cell.x},${cell.y}`}
            x={cell.x}
            y={cell.y}
            width={Math.min(stride, grid.width - cell.x)}
            height={Math.min(stride, grid.height - cell.y)}
            fill={
              Number.isFinite(cell.value)
                ? `hsl(150 20% ${94 - ((cell.value - min) / (max - min || 1)) * 32}%)`
                : '#334155'
            }
          />
        ))}
        <path
          d={seedRuns
            .map(({ first, last }) => {
              const [x, y] = point(first)
              return `M ${x - 0.5} ${y - 0.5} h ${last - first + 1} v 1 h ${first - last - 1} Z`
            })
            .join(' ')}
          fill="#ca8a04"
        />
        {result.paths.map((path) => (
          <path
            key={path.id}
            d={path.cells.map((cell, i) => `${i ? 'L' : 'M'} ${point(cell).join(' ')}`).join(' ')}
            fill="none"
            stroke={path.id === selectedPathId ? '#be185d' : '#2563eb'}
            strokeWidth={width * (path.id === selectedPathId ? 2 : 1.3)}
            strokeLinejoin="round"
          >
            <title>
              {path.id}: {fmt(path.lengthM)} m
            </title>
          </path>
        ))}
        {result.targets
          .filter((target) => target.cell >= 0 && target.cell < grid.values.length)
          .map((target, i) => {
            const [cx, cy] = point(target.cell)
            return (
              <circle
                key={`${target.id}-${i}`}
                cx={cx}
                cy={cy}
                r={width * 2}
                fill={['connected', 'already-connected'].includes(target.status) ? '#15803d' : '#dc2626'}
                stroke="#fff"
                strokeWidth={width * 0.5}
              >
                <title>
                  {target.name ?? target.id}: {target.status}
                </title>
              </circle>
            )
          })}
      </svg>
      <p className="text-2xs text-muted-foreground">
        Gold: supplied road cells · blue: projected network · pink: selected branch · green/red: target outcome · dark:
        blocked/no-data.
        {stride > 1
          ? ` Raster background sampled every ${stride} cells for display; paths retain every routing cell.`
          : ''}{' '}
        Grid north is up.
      </p>
    </figure>
  )
}
