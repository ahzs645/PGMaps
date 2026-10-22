import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
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
import { parseProject } from './project'
import type { Alignment, RoadProject, TerrainSource } from './types'
export type { FileKind } from './DesignSidebarBody'
export type SidebarProps = Omit<BodyProps, 'onOptimize'>
type Review = {
  result: RoadOptimizationResult
  candidate: Alignment
  original: RoadProject
  source: TerrainSource
  options: RoadOptimizationOptions
}
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
    const options: RoadOptimizationOptions = { objective, corridorHalfWidthM }
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
      const candidate = corridorCandidate(result, alignment.template, alignment.name + ' · ' + objective + ' corridor')
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
      if (w.project.alignments.length >= 20) throw Error('The project already has 20 road alternatives.')
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
              <Button variant="outline" onClick={() => setReview(null)}>
                Discard candidate
              </Button>
            </div>
          }
        >
          {stale && (
            <p role="alert" className="mb-3 font-medium text-destructive">
              The project changed. Discard this result and run again.
            </p>
          )}
          <CorridorPreview review={review} />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="pb-2 text-left">
                Ground profile comparison with the input guide’s straight legs
              </caption>
              <thead>
                <tr>
                  <th className="p-2 text-left">Measure</th>
                  <th className="p-2 text-right">Guide</th>
                  <th className="p-2 text-right">Candidate</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['Length (m)', 'lengthM'],
                    ['Maximum sampled ground grade (%)', 'maxSampledGroundPitchPercent'],
                    ['Ground ascent (m)', 'groundAscentM'],
                    ['Ground descent (m)', 'groundDescentM'],
                    ['Excess rise/fall (m)', 'excessVerticalM'],
                  ] as const
                ).map(([label, key]) => (
                  <tr key={key} className="border-t">
                    <th className="p-2 text-left font-normal">{label}</th>
                    <td className="p-2 text-right">
                      {review.result.baseline.complete ? value(review.result.baseline[key]) : 'Incomplete'}
                    </td>
                    <td className="p-2 text-right">{value(review.result[key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs">
            Minimum fitted radius:{' '}
            {review.result.minimumRadiusM === null ? 'Straight route' : value(review.result.minimumRadiusM) + ' m'} ·{' '}
            {value(review.result.explored, 0)} explored states · ≤{review.result.sampleStepM} m terrain checks ·{' '}
            {review.result.searchStatus}.
          </p>
          <p className="mt-2 text-xs">
            {review.original.terrain.name} · source cells {value(review.original.terrain.resolutionM, 2)} m. Sampling
            more finely does not improve source accuracy.
          </p>
          <p className="mt-2 text-xs">
            Adoption preserves the fitted horizontal curves. Vertical design, culverts, template assignments and
            widenings are not copied to different stations; the original road keeps them.
          </p>
          <details className="mt-3 text-xs">
            <summary>Checks and design limitations</summary>
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
  const x0 = Math.min(...all.map((p) => p[0])),
    x1 = Math.max(...all.map((p) => p[0]))
  const y0 = Math.min(...all.map((p) => p[1])),
    y1 = Math.max(...all.map((p) => p[1]))
  const scale = Math.min(600 / Math.max(1, x1 - x0), 220 / Math.max(1, y1 - y0))
  const path = (points: number[][]) =>
    points
      .map(
        (p, i) =>
          (i ? 'L' : 'M') +
          (320 + (p[0] - (x0 + x1) / 2) * scale).toFixed(2) +
          ',' +
          (130 - (p[1] - (y0 + y1) / 2) * scale).toFixed(2),
      )
      .join(' ')
  return (
    <figure className="rounded-lg border bg-muted/20 p-2">
      <svg
        viewBox="0 0 640 260"
        className="w-full"
        role="img"
        aria-label="North-up comparison of sketched guide and verified curved candidate"
      >
        <path d={path(a)} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray="7 5" opacity={0.5} />
        <path d={path(b)} fill="none" stroke="#2563eb" strokeWidth={3} />
        <text x={12} y={20} fill="currentColor" fontSize={12}>
          N ↑
        </text>
      </svg>
      <figcaption className="text-xs">
        Dashed: input guide. Blue: actual tangent/arc centreline. Local metric view, north up. The search corridor
        extends {value(review.options.corridorHalfWidthM, 0)} m to either side of the guide.
      </figcaption>
    </figure>
  )
}
