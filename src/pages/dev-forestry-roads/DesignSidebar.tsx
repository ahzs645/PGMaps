import { useEffect, useRef, useState } from 'react'
import { ROAD_LIMIT_MESSAGE, roadLimitReached } from './roadLimits'
import { derivedRoadName } from './mappedRoad'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InlineAlert } from '@/components/ui/map-panels'
import { downloadText } from '@/lib/download'
import { DesignSidebar as SidebarBody, type SidebarProps as BodyProps } from './DesignSidebarBody'
import {
  corridorFrame,
  optimizeRoadCorridorAsync,
  type RoadOptimizationObjective,
  type RoadOptimizationOptions,
  type RoadOptimizationResult,
} from './corridorOptimizer'
import { corridorCandidate } from './corridorCandidate'
import { resolvedGroundWindow } from './groundTrend'
import { parseProject } from './project'
import { terrainDisplayName } from './terrainName'
import type { Alignment, RoadProject, TerrainSource } from './types'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
export type { FileKind } from './DesignSidebarBody'
export type SidebarProps = Omit<BodyProps, 'onOptimize'>
type Review = {
  result: RoadOptimizationResult
  candidate: Alignment
  original: RoadProject
  source: TerrainSource
  options: RoadOptimizationOptions
}
/** Measure, field, and whether less is better (null: neither, as with length). */
const COMPARED = [
  ['Length (m)', 'lengthM', null],
  ['Steepest ground grade (%)', 'maxSampledGroundPitchPercent', true],
  ['Ground climbed (m)', 'groundAscentM', true],
  ['Ground descended (m)', 'groundDescentM', true],
  ['Excess rise and fall (m)', 'excessVerticalM', true],
] as const
const value = (v: number, decimals = 1) =>
  Number.isFinite(v) ? v.toLocaleString('en-CA', { maximumFractionDigits: decimals }) : '—'

/** The sidebar owns the asynchronous search and review; the shared workspace owns adoption. */
export function DesignSidebar(props: SidebarProps) {
  const w = props.workspace
  const current = useRef({ project: w.project, source: w.source })
  current.current = { project: w.project, source: w.source }
  const controller = useRef<AbortController | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const optimize = async (objective: RoadOptimizationObjective, corridorHalfWidthM: number) => {
    if (controller.current || w.busy) return
    const abort = new AbortController()
    controller.current = abort
    const original = w.project,
      source = w.source,
      alignment = w.alignment
    const options: RoadOptimizationOptions = {
      objective,
      corridorHalfWidthM,
      groundWindowM: resolvedGroundWindow(original.routeSearch, original.terrain.resolutionM),
    }
    setReview(null)
    w.setError('')
    w.setBusy('Searching the sketched corridor…')
    w.setBusyCancel({ label: 'Cancel road optimization', onCancel: () => abort.abort() })
    try {
      const result = await optimizeRoadCorridorAsync(
        alignment.points.map((p) => [...p.coordinate]),
        source,
        original.settings,
        original.context,
        options,
        {
          signal: abort.signal,
          onProgress: (progress) =>
            w.setBusy(
              'Corridor search · ' + progress.explored.toLocaleString('en-CA') + ' states · Cancel remains available',
            ),
        },
      )
      if (abort.signal.aborted) return
      if (current.current.project !== original || current.current.source !== source)
        throw Error('The road or terrain changed during the search. Run it again; the old result was discarded.')
      const candidate = corridorCandidate(
        result,
        alignment.template,
        derivedRoadName(alignment) + ' · ' + objective + ' corridor',
      )
      setReview({ result, candidate, original, source, options })
      w.setNotice('Candidate ready for review. Your original road has not changed.')
    } catch (cause) {
      if (abort.signal.aborted) w.setNotice('Optimization cancelled. No road was changed.')
      else w.setError(cause instanceof Error ? cause.message : 'Could not optimize this corridor.')
    } finally {
      if (controller.current === abort) {
        controller.current = null
        w.setBusy('')
      }
    }
  }
  const stale = review && (review.original !== w.project || review.source !== w.source)
  const adopt = () => {
    if (!review || stale || w.busy) return
    try {
      if (roadLimitReached(w.project)) throw Error(ROAD_LIMIT_MESSAGE)
      const next = parseProject({
        ...w.project,
        alignments: [...w.project.alignments, review.candidate],
        activeAlignmentId: review.candidate.id,
      })
      w.commit(next)
      props.onProfile('')
      props.onPoint(null)
      w.setStation(0)
      w.setNotice(review.result.message)
      w.setError('')
      setReview(null)
    } catch (cause) {
      w.setError(cause instanceof Error ? cause.message : 'Could not adopt candidate.')
    }
  }
  const report = () => {
    if (!review) return
    const m = review.original.terrain
    downloadText(
      JSON.stringify(
        {
          schema: 'pgmaps-road-corridor-review-v1',
          algorithm: 'bounded-heading-search-tangent-arc-v1',
          source: {
            name: m.name,
            kind: m.kind,
            resolutionM: m.resolutionM,
            epsg: m.epsg,
            verticalReference: m.verticalReference,
            sourceUrl: m.sourceUrl,
            sha256: m.sha256,
          },
          options: review.options,
          settings: review.original.settings,
          guide: review.original.alignments.find((a) => a.id === review.original.activeAlignmentId),
          constraints: review.original.context,
          result: review.result,
          candidate: review.candidate,
          status: 'preliminary-horizontal-candidate-not-construction-design',
        },
        null,
        2,
      ),
      'road-corridor-review.json',
      'application/json',
    )
  }
  return (
    <>
      <SidebarBody {...props} onOptimize={(objective, width) => void optimize(objective, width)} />
      {review && (
        <DialogShell
          title="Review optimized corridor"
          subtitle="Original guide retained · sampled ground screening, not construction approval"
          size="lg"
          onClose={() => setReview(null)}
          contentProps={{ 'data-testid': 'road-optimization-review' }}
          footer={
            <div className="flex flex-wrap gap-2">
              <Button onClick={adopt} disabled={!!stale || !!w.busy}>
                Use candidate as new road
              </Button>
              <Button variant="outline" onClick={report}>
                Download optimization report
              </Button>
              <Button variant="ghost" onClick={() => setReview(null)}>
                Discard candidate
              </Button>
            </div>
          }
        >
          {stale && (
            <InlineAlert tone="error" className="mb-3">
              The project changed. Discard this result and run again.
            </InlineAlert>
          )}
          <CorridorPreview review={review} />
          <div className="mt-4 overflow-x-auto overscroll-none">
            <EngineeringTable rowHeaders>
              <caption className="whitespace-normal pb-2 text-left text-sm font-medium">Ground along each line</caption>
              <thead>
                <tr>
                  <ColumnHeader label="Measure" className="text-left" />
                  <ColumnHeader label="Your guide" />
                  <ColumnHeader label="Candidate" />
                  <ColumnHeader label="Change" />
                </tr>
              </thead>
              <tbody>
                {COMPARED.map(([label, key, lowerIsBetter]) => {
                  const guide = review.result.baseline.complete ? review.result.baseline[key] : null
                  const candidate = review.result[key]
                  const change = guide === null ? null : candidate - guide
                  const better =
                    change !== null && lowerIsBetter !== null && Math.abs(change) >= 0.05
                      ? change < 0 === lowerIsBetter
                      : null
                  return (
                    <tr key={key}>
                      <th scope="row">{label}</th>
                      <td>{guide === null ? 'Incomplete' : value(guide)}</td>
                      <td>{value(candidate)}</td>
                      <td
                        data-change={better === null ? 'neutral' : better ? 'better' : 'worse'}
                        className={better === null ? 'text-muted-foreground' : better ? 'text-success' : 'text-warning'}
                      >
                        {change === null
                          ? '—'
                          : `${change > 0 ? '+' : change < 0 ? '−' : '±'}${value(Math.abs(change))}`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </EngineeringTable>
          </div>
          <p className="mt-3 text-xs text-muted-foreground" data-testid="road-optimization-run">
            {review.result.minimumRadiusM === null
              ? 'Straight, no curves'
              : `Tightest curve R${value(review.result.minimumRadiusM)} m`}{' '}
            · {value(review.result.explored, 0)} states searched · ground checked every ≤{review.result.sampleStepM} m ·{' '}
            {review.result.searchStatus}
          </p>
          <p className="mt-1 text-xs text-muted-foreground" title={review.original.terrain.name}>
            {terrainDisplayName(review.original.terrain.name)} · {value(review.original.terrain.resolutionM, 2)} m cells
          </p>
          {review.original.terrain.kind !== 'geotiff' && (
            <InlineAlert tone="warning" className="mt-2">
              {review.original.terrain.kind === 'demo'
                ? 'Synthetic ground: a training result, not a site route.'
                : 'Coarse screening terrain: grades between its cells are interpolated, so check the route on LiDAR or your own DEM.'}
            </InlineAlert>
          )}
          <details className={cn(insetBox(), 'mt-3 text-xs')}>
            <summary className="cursor-pointer font-medium">What adopting keeps, and what this does not check</summary>
            <p className="mt-2">
              Adopting adds the candidate as a new road with its fitted horizontal curves. Vertical design, culverts,
              template assignments and widenings stay on your original road; they are not copied to different stations.
            </p>
            {review.result.warnings.map((warning) => (
              <p key={warning} className="mt-2">
                {warning}
              </p>
            ))}
            <p className="mt-2">
              Exclusions apply to the centreline. Full cut/fill footprint and buffers must be reviewed in the connected
              section and engineering views. Intentional rolling grades may be needed for drainage.
            </p>
          </details>
        </DialogShell>
      )}
    </>
  )
}
function CorridorPreview({ review }: { review: Review }) {
  const guide = review.original.alignments
    .find((a) => a.id === review.original.activeAlignmentId)!
    .points.map((p) => p.coordinate)
  const frame = corridorFrame(guide[0])
  const a = guide.map(frame.toXY),
    b = review.result.coordinates.map(frame.toXY),
    all = [...a, ...b]
  // Frame the whole search corridor, so the band shows how much room the search had.
  const half = review.options.corridorHalfWidthM
  const x0 = Math.min(...all.map((p) => p[0])) - half,
    x1 = Math.max(...all.map((p) => p[0])) + half
  const y0 = Math.min(...all.map((p) => p[1])) - half,
    y1 = Math.max(...all.map((p) => p[1])) + half
  const scale = Math.min(620 / Math.max(1, x1 - x0), 240 / Math.max(1, y1 - y0))
  const sx = (p: number[]) => 320 + (p[0] - (x0 + x1) / 2) * scale,
    sy = (p: number[]) => 130 - (p[1] - (y0 + y1) / 2) * scale
  const path = (points: number[][]) =>
    points.map((p, i) => (i ? 'L' : 'M') + sx(p).toFixed(1) + ',' + sy(p).toFixed(1)).join(' ')
  const ends = [
    ['Start', b[0]],
    ['End', b.at(-1)!],
  ] as const
  return (
    <figure className={insetBox({ tone: 'muted' })}>
      <svg
        viewBox="0 0 640 260"
        className="max-h-72 w-full"
        role="img"
        aria-label="North-up comparison of sketched guide and verified curved candidate"
      >
        <path
          d={path(a)}
          fill="none"
          stroke="currentColor"
          strokeWidth={2 * half * scale}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.07}
          data-testid="road-optimization-corridor"
        />
        <path d={path(a)} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray="7 5" opacity={0.5} />
        <path d={path(b)} fill="none" stroke="#2563eb" strokeWidth={3} strokeLinejoin="round" />
        {ends.map(([label, point]) => (
          <g key={label}>
            <circle cx={sx(point)} cy={sy(point)} r={5} fill="#2563eb" stroke="white" strokeWidth={2} />
            {/* Start reads to the left of its dot and End to the right, so neither sits on the line. */}
            <text
              x={sx(point) + (label === 'Start' ? -9 : 9)}
              y={sy(point) + 4}
              textAnchor={label === 'Start' ? 'end' : 'start'}
              fill="currentColor"
              fontSize={11}
            >
              {label}
            </text>
          </g>
        ))}
        <text x={12} y={20} fill="currentColor" fontSize={12}>
          N ↑
        </text>
      </svg>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pt-1 text-2xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="4" aria-hidden="true">
            <line x1="0" x2="22" y1="2" y2="2" stroke="currentColor" strokeWidth="2" strokeDasharray="5 3" />
          </svg>
          Your guide
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[3px] w-[22px] rounded-sm bg-[#2563eb]" aria-hidden="true" />
          Candidate centreline
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-[22px] rounded-sm bg-foreground/10" aria-hidden="true" />
          Search corridor · {value(half, 0)} m each side
        </span>
      </figcaption>
    </figure>
  )
}
