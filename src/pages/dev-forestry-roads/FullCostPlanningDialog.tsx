import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { InlineAlert } from '@/components/ui/map-panels'
import { TabBar } from '@/components/ui/tab-bar'
import { downloadText } from '@/lib/download'
import { createTotalCostPlanningDefaults, parseTotalCostPlanning, type TotalCostPlanning } from './fullCostPlanning'
import { runFullCostComparison, type FullCostRun } from './fullCostRun'
import { checkConnector } from './connectorChecks'
import { createFullCostRecord } from './fullCostRecord'
import { FullCostSetupEditor } from './FullCostSetupEditor'
import { FullCostSourcesEditor } from './FullCostSourcesEditor'
import { parseProject } from './project'
import type { Alignment, RoadProject, TerrainSource } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'

type Review = { run: FullCostRun; project: RoadProject; source: TerrainSource }
export type FullCostPreview = {
  alignment: Alignment
  overlay: GeoJSON.FeatureCollection
  totalCost: number | null
  status: 'feasible' | 'infeasible' | 'unpriced'
}
const money = (value: number | null) =>
  value === null ? 'Unpriced' : `$${value.toLocaleString('en-CA', { maximumFractionDigits: 0 })}`

export function FullCostPlanningDialog({
  workspace: w,
  open,
  onOpenChange: setOpen,
  onPreview,
  onAdopt,
  onReviewRoads,
  portalContainer,
}: {
  workspace: RoadWorkspace
  open: boolean
  onOpenChange: (open: boolean) => void
  onPreview?: (preview: FullCostPreview | null) => void
  onAdopt?: () => void
  onReviewRoads?: (id?: string) => void
  portalContainer?: HTMLElement | null
}) {
  const [tab, setTab] = useState<'setup' | 'sources' | 'results'>('setup')
  const [review, setReview] = useState<Review | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const abort = useRef<AbortController | null>(null)
  const resultsTop = useRef<HTMLDivElement>(null)
  const current = useRef({ project: w.project, source: w.source })
  current.current = { project: w.project, source: w.source }
  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => {
    if (open && tab === 'results') {
      const frame = requestAnimationFrame(() => resultsTop.current?.scrollIntoView({ block: 'start' }))
      return () => cancelAnimationFrame(frame)
    }
  }, [open, tab, review])
  const planning = w.project.totalCostPlanning ?? createTotalCostPlanningDefaults()
  const stale = !!review && (review.project !== w.project || review.source !== w.source)
  const setPlanning = (next: TotalCostPlanning) => w.update((project) => ({ ...project, totalCostPlanning: next }))
  const calculate = async () => {
    if (running || w.busy) return
    const controller = new AbortController()
    abort.current = controller
    const project = w.project,
      source = w.source
    setRunning(true)
    setError('')
    setProgress('Preparing a bounded comparison…')
    try {
      parseTotalCostPlanning(project.totalCostPlanning)
      const run = await runFullCostComparison(project, source, {
        signal: controller.signal,
        onProgress: setProgress,
        yieldControl: () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
      })
      if (controller.signal.aborted) return
      if (current.current.project !== project || current.current.source !== source)
        throw Error('Inputs changed during calculation. Calculate again before using a result.')
      setReview({ run, project, source })
      setTab('results')
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (abort.current === controller) {
        abort.current = null
        setRunning(false)
        setProgress('')
      }
    }
  }
  const inspect = (id: string) => {
    if (!review || stale) return
    const candidate = review.run.candidates.find((item) => item.alignment.id === id)!
    const result = review.run.comparison.candidates.find((item) => item.id === id)!
    const features: GeoJSON.Feature[] = []
    const line = (coordinates: number[][], label: string, color: string) => {
      if (coordinates.length > 1)
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates },
          properties: {
            kind: 'complete-cost-path',
            label,
            color,
            pathRole: label.startsWith('Loaded haul:')
              ? 'loaded'
              : label.startsWith('Empty return:')
                ? 'return'
                : 'access',
          },
        })
    }
    if (result.accessPath) line(result.accessPath.coordinates, 'Reused outward access', '#0f766e')
    if (result.accessReturnPath) line(result.accessReturnPath.coordinates, 'Reused return access', '#0f766e')
    for (const allocation of result.allocations) {
      line(allocation.path.coordinates, `Loaded haul: ${allocation.sourceName}`, '#ca8a04')
      line(allocation.returnPath.coordinates, `Empty return: ${allocation.sourceName}`, '#9333ea')
    }
    onPreview?.({
      alignment: candidate.alignment,
      overlay: { type: 'FeatureCollection', features },
      totalCost: result.totalCost,
      status: result.status,
    })
    setOpen(false)
  }
  const adopt = (id: string) => {
    if (!review || stale || running || w.busy) return
    try {
      if (w.project.alignments.length >= 20) throw Error('The project already has 20 road alternatives.')
      const candidate = review.run.candidates.find((item) => item.alignment.id === id)!
      const result = review.run.comparison.candidates.find((item) => item.id === id)!
      if (result.status !== 'feasible' || result.totalCost === null || !candidate.checks.adoptable)
        throw Error('Resolve final checks, access and missing prices before using this candidate.')
      const fresh = checkConnector({
        alignment: candidate.alignment,
        terrain: w.source,
        settings: w.project.settings,
        context: w.project.context,
        options: planning.connectorChecks,
        terrainResolutionM: w.project.terrain.resolutionM,
        expectedStart: candidate.expectedStart,
        expectedEnd: candidate.expectedEnd,
      })
      if (!fresh.adoptable) throw Error('The final connector no longer passes its checks. Calculate again.')
      const copy: Alignment = {
        ...structuredClone(candidate.alignment),
        id: crypto.randomUUID(),
        name: `${candidate.alignment.name} · complete access`.slice(0, 200),
        fullCostRecord: undefined,
      }
      let next = parseProject({ ...w.project, alignments: [...w.project.alignments, copy], activeAlignmentId: copy.id })
      const normalized = next.alignments.at(-1)!
      normalized.fullCostRecord = createFullCostRecord(normalized, next, result)
      next = parseProject(next)
      w.commit(next)
      w.setStation(0)
      w.setNotice(
        'Added the checked cost comparison as a new road. The saved complete access cost is separate from the base engineering estimate.',
      )
      onPreview?.(null)
      onAdopt?.()
      setOpen(false)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const exportReview = () => {
    if (!review) return
    downloadText(
      JSON.stringify(
        {
          schema: 'pgmaps-complete-route-comparison-v1',
          scope: review.run.comparison.scope,
          stale,
          projectName: review.project.name,
          terrain: { ...review.project.terrain, raster: undefined },
          planning: review.project.totalCostPlanning,
          settings: review.project.settings,
          context: review.project.context,
          comparison: review.run.comparison,
          candidates: review.run.candidates.map(
            ({ alignment, checks, basis, entryRoadId, expectedStart, expectedEnd }) => ({
              alignment,
              basis,
              entryRoadId,
              expectedStart,
              expectedEnd,
              checks: {
                status: checks.status,
                failures: checks.failures,
                unknowns: checks.unknowns,
                metrics: checks.metrics,
              },
            }),
          ),
          excludedRoads: review.run.network.excludedRoads,
          generationWarnings: review.run.generationWarnings,
        },
        null,
        2,
      ),
      'complete-route-comparison.json',
      'application/json',
    )
  }
  const reviewRoads = (id?: string) => {
    abort.current?.abort()
    setOpen(false)
    onReviewRoads?.(id)
  }
  return (
    open && (
      <DialogShell
        title="Complete route cost comparison"
        subtitle="New construction + connected access + delivered materials"
        size="xl"
        portalContainer={portalContainer}
        onClose={() => {
          abort.current?.abort()
          setOpen(false)
        }}
        contentProps={{ 'data-testid': 'full-cost-dialog' }}
        footer={
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void calculate()} disabled={running || !!w.busy}>
              Calculate route comparison
            </Button>
            {running && (
              <Button variant="outline" onClick={() => abort.current?.abort()}>
                Cancel after current check
              </Button>
            )}
            <Button variant="outline" disabled={!review} onClick={exportReview}>
              Export comparison evidence
            </Button>
            <span className="text-xs text-muted-foreground" role="status">
              {progress}
            </span>
          </div>
        }
      >
        <div ref={resultsTop} />
        <TabBar
          label="Complete cost workflow"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'setup', label: 'Setup' },
            { value: 'sources', label: 'Sources' },
            { value: 'results', label: 'Results' },
          ]}
        />
        {error && <InlineAlert tone="warning">{error}</InlineAlert>}
        {stale && (
          <InlineAlert tone="warning">Inputs changed. Calculate again; previous results cannot be used.</InlineAlert>
        )}
        <fieldset disabled={running || !!w.busy} className="mt-3 space-y-3">
          {tab === 'setup' && (
            <FullCostSetupEditor
              planning={planning}
              onChange={setPlanning}
              workspace={w}
              onReviewRoads={() => reviewRoads()}
            />
          )}
          {tab === 'sources' && <FullCostSourcesEditor planning={planning} onChange={setPlanning} workspace={w} />}
        </fieldset>
        {tab === 'results' && (
          <div className="space-y-3" data-testid="full-cost-results">
            {!review ? (
              <InlineAlert>Set up the inputs, then calculate to inspect candidate costs and final checks.</InlineAlert>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">{review.run.comparison.scope}</p>
                {!review.run.comparison.winnerId && (
                  <InlineAlert tone="warning">
                    No candidate has a complete, feasible price. Review the named blockers below.
                  </InlineAlert>
                )}
                {review.run.comparison.candidates.map((result) => {
                  const candidate = review.run.candidates.find((item) => item.alignment.id === result.id)!
                  return (
                    <section
                      key={result.id}
                      className="space-y-2 rounded-lg border p-3"
                      data-testid={`full-cost-candidate-${result.id}`}
                      data-status={result.status}
                      data-recommended={String(result.id === review.run.comparison.winnerId)}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 className="min-w-0 break-words text-sm font-semibold">{result.name}</h3>
                        <strong>{result.status === 'infeasible' ? 'Not feasible' : money(result.totalCost)}</strong>
                      </div>
                      {result.id === review.run.comparison.winnerId && (
                        <p className="text-xs font-semibold text-emerald-700">
                          Lowest complete access cost among the checked candidates
                        </p>
                      )}
                      <p className="text-xs">
                        {candidate.checks.metrics.lengthM.toFixed(0)} m new connector · final checks{' '}
                        {candidate.checks.status} · {result.status}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{candidate.basis}</p>
                      {result.blockers.length > 0 && (
                        <ul className="list-disc space-y-1 pl-4 text-xs text-destructive">
                          {result.blockers.map((message, index) => (
                            <li key={index}>{message}</li>
                          ))}
                        </ul>
                      )}
                      {result.ledger && (
                        <dl className="grid grid-cols-2 gap-1 text-xs">
                          <dt>New construction and internal handling</dt>
                          <dd>
                            {money(
                              result.ledger.newConstruction +
                                result.ledger.internalMaterialHaul +
                                result.ledger.newConstructionFixed,
                            )}
                          </dd>
                          <dt>Materials and source preparation</dt>
                          <dd>{money(result.ledger.sourceMaterials + result.ledger.sourcePreparation)}</dd>
                          <dt>Loaded/return delivery</dt>
                          <dd>{money(result.ledger.supplyNetworkHaul + result.ledger.supplyConnectorHaul)}</dd>
                          <dt>Network rehabilitation/access/structures</dt>
                          <dd>
                            {money(
                              result.ledger.networkRehabilitation +
                                result.ledger.networkAccess +
                                result.ledger.networkStructures +
                                result.ledger.networkFixed,
                            )}
                          </dd>
                          <dt>Contingency (once)</dt>
                          <dd>{money(result.ledger.contingency)}</dd>
                        </dl>
                      )}
                      <details className="text-xs">
                        <summary>Final checks, sources and haul routes</summary>
                        <p className="mt-2">
                          {candidate.checks.metrics.checkedStations} checked stations · minimum radius{' '}
                          {candidate.checks.metrics.minFittedRadiusM ?? 'straight'} m · full prism width up to{' '}
                          {candidate.checks.metrics.maxFootprintWidthM.toFixed(1)} m.
                        </p>
                        {[...candidate.checks.failures, ...candidate.checks.unknowns].map((issue, index) => (
                          <p key={index} className="mt-1">
                            {issue.message}
                          </p>
                        ))}
                        {result.allocations.map((allocation, index) => (
                          <p key={index} className="mt-1">
                            {allocation.sourceName}: {allocation.volumeM3.toFixed(1)} {allocation.volumeBasis} m³{' '}
                            {allocation.use}; loaded network {(allocation.networkDistanceM / 1000).toFixed(2)} km,
                            return {(allocation.returnNetworkDistanceM / 1000).toFixed(2)} km. Roads:{' '}
                            {allocation.path.roadIds.join(', ')}.
                          </p>
                        ))}
                        {result.warnings.map((message, index) => (
                          <p key={index} className="mt-1 text-muted-foreground">
                            {message}
                          </p>
                        ))}
                      </details>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-auto min-h-8 max-w-full whitespace-normal text-left"
                          disabled={stale || running}
                          onClick={() => inspect(result.id)}
                        >
                          Preview {result.name}
                        </Button>
                        <Button
                          size="sm"
                          className="h-auto min-h-8 max-w-full whitespace-normal text-left"
                          disabled={
                            stale ||
                            running ||
                            result.status !== 'feasible' ||
                            !candidate.checks.adoptable ||
                            w.project.alignments.length >= 20
                          }
                          onClick={() => adopt(result.id)}
                        >
                          Use {result.name}
                        </Button>
                      </div>
                    </section>
                  )
                })}
                {review.run.network.excludedRoads.length > 0 && (
                  <details open className="rounded border p-3 text-xs">
                    <summary>
                      Roads unavailable for connected access ({review.run.network.excludedRoads.length})
                    </summary>
                    {review.run.network.excludedRoads.map((road) => (
                      <div key={road.roadId} className="mt-2">
                        <p className="font-medium">{road.name}</p>
                        <p>{road.reasons.join(' ')}</p>
                        <Button variant="outline" size="sm" onClick={() => reviewRoads(road.roadId)}>
                          Review {road.name}
                        </Button>
                      </div>
                    ))}
                  </details>
                )}
                {review.run.generationWarnings.length > 0 && (
                  <details className="text-xs">
                    <summary>Candidate generation limits</summary>
                    {review.run.generationWarnings.map((warning, index) => (
                      <p key={index}>{warning}</p>
                    ))}
                  </details>
                )}
              </>
            )}
          </div>
        )}
      </DialogShell>
    )
  )
}
