import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'

import { loadElevationGrid } from '@/lib/forestry/terrain/demLoader'
import type { ForestryScene } from './scene'
import type { TerrainCandidate } from './TerrainLandformFinder'
import {
  viewLandformCandidate,
  viewLandformTileRange,
  viewLandformVerdict,
  type ViewLandformCandidate,
} from './viewLandform'
import { polygonAreaMeters, type PolygonGeometry } from './visibility'
import type { ViewOfInterest } from './viewsOfInterest'

type Status = { state: 'idle' | 'working' | 'failed'; message?: string }

/**
 * "Landform seen from here" for one planned view: reads the visible face of the view's block from the view's place
 * (`viewLandform.ts`, the finder's visible face), shows it on the plan with the finder's candidates, and adopts it
 * for this view only on the reviewer's click. *Clear* takes the landform off the view and leaves its target in the
 * scene.
 */
export function ViewLandformControl({
  view,
  scene,
  water,
  onShowCandidate,
  onHideCandidate,
  onAdopt,
  onClear,
}: {
  view: ViewOfInterest
  scene: ForestryScene
  /** Basemap water: the shoreline is an edge and the lake is never landform. */
  water: ReadonlyArray<PolygonGeometry>
  /** Draws the candidate on the plan as the finder's candidates are drawn. */
  onShowCandidate?: (candidate: TerrainCandidate) => void
  /** Takes this control's candidate off the plan (only it: the finder's own stay). */
  onHideCandidate?: (candidate: TerrainCandidate) => void
  onAdopt: (view: ViewOfInterest, candidate: TerrainCandidate) => void
  onClear: (view: ViewOfInterest) => void
}) {
  const block = scene.targets.find((target) => target.id === view.blockId && target.role === 'block') ?? null
  const landform = view.landformId
    ? (scene.targets.find((target) => target.id === view.landformId && target.role === 'landscape') ?? null)
    : null
  const [status, setStatus] = useState<Status>({ state: 'idle' })
  const [candidate, setCandidate] = useState<{ key: string; value: ViewLandformCandidate } | null>(null)
  const controller = useRef<AbortController | null>(null)
  // A reading belongs to the place and block it was read for: moving the view or editing the block drops it.
  const key = `${view.lng},${view.lat},${view.blockId}`
  const shown =
    candidate && candidate.key === key && candidate.value.blockGeometry === block?.geometry ? candidate : null
  const verdict = shown && block ? viewLandformVerdict(shown.value, polygonAreaMeters(block.geometry) / 10_000) : null

  const hide = useRef(onHideCandidate)
  const current = useRef<TerrainCandidate | null>(null)
  useEffect(() => {
    hide.current = onHideCandidate
    current.current = candidate?.value ?? null
  }, [onHideCandidate, candidate])
  // Closing the row cancels a read and takes its candidate off the plan.
  useEffect(
    () => () => {
      controller.current?.abort()
      if (current.current) hide.current?.(current.current)
    },
    [],
  )
  useEffect(() => {
    if (candidate && !shown) {
      onHideCandidate?.(candidate.value)
      setCandidate(null)
    }
  }, [candidate, shown, onHideCandidate])

  const dismiss = () => {
    if (candidate) onHideCandidate?.(candidate.value)
    setCandidate(null)
  }

  const read = async () => {
    if (!block) return
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    dismiss()
    setStatus({ state: 'working' })
    try {
      const { grid, missingTileCount } = await loadElevationGrid({
        range: viewLandformTileRange(view, block.geometry),
        signal: abort.signal,
        concurrency: 4,
      })
      if (abort.signal.aborted) return
      const found = viewLandformCandidate(grid, view, block, {
        water,
        eyeHeightMeters: scene.settings.observerHeightMeters,
      })
      if (!found)
        throw new Error(
          `Nothing of ${block.name}, or of the ground in front of it, is in view from here: there is no face to read. Try another view, or draw the landform by hand.`,
        )
      setCandidate({ key, value: found })
      onShowCandidate?.(found)
      setStatus({
        state: 'idle',
        message: missingTileCount
          ? `${missingTileCount} terrain tiles did not load; the outline may stop short.`
          : undefined,
      })
    } catch (error) {
      if (abort.signal.aborted) return
      setStatus({ state: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <div className="space-y-1.5 text-xs" data-view-landform={view.id}>
      {landform ? (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate" title={landform.source}>
            <span className="text-muted-foreground">Landform: </span>
            {landform.name}
          </span>
          <Button type="button" variant="ghost" size="xs" className="shrink-0 text-2xs" onClick={() => onClear(view)}>
            Clear
          </Button>
        </div>
      ) : (
        view.landformId && (
          <p className="text-3xs leading-4 text-muted-foreground">
            This view&apos;s landform is no longer in the scene. Read it again, or clear it.{' '}
            <button type="button" className="underline underline-offset-2" onClick={() => onClear(view)}>
              Clear
            </button>
          </p>
        )
      )}
      {!shown && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="w-full text-2xs"
          disabled={!block || status.state === 'working'}
          title={block ? undefined : "The view's block is no longer in the scene."}
          onClick={() => void read()}
        >
          {status.state === 'working' ? 'Reading the terrain…' : 'Landform seen from here'}
        </Button>
      )}
      {status.state === 'failed' && <InlineAlert tone="error">{status.message}</InlineAlert>}
      {shown && verdict && (
        <div className="space-y-1.5" aria-label="Landform seen from this view">
          <p className="text-3xs leading-4 text-muted-foreground">
            {verdict.title}, drawn on the plan. A reading of the terrain from this view, not a checked delineation:
            compare it with the view before adopting it. Adopting it adds it as a landform for this view only; the
            run&apos;s landform stays as it is.
          </p>
          {verdict.note && <InlineAlert tone={verdict.tone ?? 'info'}>{verdict.note}</InlineAlert>}
          {status.message && <InlineAlert tone="warning">{status.message}</InlineAlert>}
          <div className="flex gap-2">
            <Button
              type="button"
              size="xs"
              className="text-2xs"
              disabled={!verdict.adoptable}
              onClick={() => {
                onAdopt(view, shown.value)
                dismiss()
              }}
            >
              Adopt for this view
            </Button>
            <Button type="button" variant="ghost" size="xs" className="text-2xs" onClick={dismiss}>
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
