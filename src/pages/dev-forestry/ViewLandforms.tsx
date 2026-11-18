import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { TextButton } from '@/components/ui/text-button'
import { ToolSubsection } from '@/components/ui/tool-section'
import { loadElevationGrid } from '@/lib/forestry/terrain/demLoader'

import type { ForestryScene } from './scene'
import type { TerrainCandidate } from './TerrainLandformFinder'
import type { TargetPolygon } from './types'
import {
  followsSite,
  landformAssignments,
  viewLandformCandidate,
  viewLandformTileRange,
  viewLandformVerdict,
  type ViewLandformCandidate,
  type ViewLandformUse,
} from './viewLandform'
import { polygonAreaMeters, type PolygonGeometry } from './visibility'
import type { ViewOfInterest } from './viewsOfInterest'

/** A view's reading of the terrain, for the place and block it was read for; or why there was none. */
type Reading = { key: string; candidate?: ViewLandformCandidate; warning?: string; error?: string }

const readingKey = (view: ViewOfInterest) => `${view.lng},${view.lat},${view.blockId}`
const hectares = (geometry: PolygonGeometry) => `${Math.round(polygonAreaMeters(geometry) / 10_000)} ha`

/**
 * Step 1's *Views of interest* under the site landform: which landform each planned view is assessed against. A view
 * is assessed against the site landform unless it has one of its own, read from its own place (`viewLandform.ts`,
 * the finder's visible face) and adopted for it by the reviewer's click. One row a view, with the reading's verdict
 * and *Adopt* on the row; *Read for every view* reads them one after another and draws them all on the plan, and
 * nothing is adopted without a click. A reading is a candidate and stays here only while its view and block are as
 * they were read.
 */
export function ViewLandforms({
  scene,
  site,
  inUseId,
  water,
  renderLandform,
  onCandidates,
  onAdopt,
  onClear,
}: {
  scene: ForestryScene
  /** The site landform (`siteLandformOf`): what a view with none of its own is assessed against. */
  site: TargetPolygon | null
  /** The landform the run measures now: a view's own while the page stands there. */
  inUseId: string | null
  /** Basemap water: the shoreline is an edge and the lake is never landform. */
  water: ReadonlyArray<PolygonGeometry>
  /** A landform's card as the section draws its others (name, area, objective and VAC). */
  renderLandform: (target: TargetPolygon) => ReactNode
  /**
   * The readings to draw on the plan, the ones drawn before (to take off), and those just read (to bring into
   * sight).
   */
  onCandidates: (shown: TerrainCandidate[], before: TerrainCandidate[], fit: TerrainCandidate[]) => void
  /** Adopts each reading for its own view, in one edit. */
  onAdopt: (adoptions: Array<{ view: ViewOfInterest; candidate: TerrainCandidate }>) => void
  onClear: (view: ViewOfInterest) => void
}) {
  const { views } = useMemo(() => landformAssignments(scene, site), [scene, site])
  const [readings, setReadings] = useState<Record<string, Reading>>({})
  const [working, setWorking] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)

  // A reading belongs to the place and block it was read for: moving the view or editing the block drops it.
  const current = useCallback(
    (entry: ViewLandformUse): Reading | null => {
      const reading = readings[entry.view.id]
      if (!reading || reading.key !== readingKey(entry.view)) return null
      if (reading.candidate && reading.candidate.blockGeometry !== entry.block?.geometry) return null
      return reading
    },
    [readings],
  )
  const shown = useMemo(
    () =>
      views.flatMap((entry) => {
        const reading = current(entry)
        return reading?.candidate ? [{ entry, candidate: reading.candidate }] : []
      }),
    [views, current],
  )
  const verdictOf = (entry: ViewLandformUse, candidate: ViewLandformCandidate) =>
    viewLandformVerdict(candidate, entry.block ? polygonAreaMeters(entry.block.geometry) / 10_000 : 0)
  const adoptable = shown.filter(({ entry, candidate }) => verdictOf(entry, candidate).adoptable)

  // The plan draws exactly the readings listed here: a change in them is sent once, with the ones to take off.
  const drawn = useRef<TerrainCandidate[]>([])
  const justRead = useRef<TerrainCandidate[]>([])
  const send = useRef(onCandidates)
  useEffect(() => {
    send.current = onCandidates
  })
  useEffect(() => {
    const candidates = shown.map((item) => item.candidate)
    const before = drawn.current
    // The scene changes on every edit; the readings drawn usually do not.
    if (before.length === candidates.length && before.every((candidate, index) => candidate === candidates[index]))
      return
    drawn.current = candidates
    send.current(candidates, before, justRead.current)
    justRead.current = []
  }, [shown])
  // Leaving the page cancels a read and takes its readings off the plan.
  useEffect(
    () => () => {
      controller.current?.abort()
      if (drawn.current.length) send.current([], drawn.current, [])
    },
    [],
  )

  const read = useCallback(
    async (entries: ViewLandformUse[]) => {
      controller.current?.abort()
      const abort = new AbortController()
      controller.current = abort
      try {
        for (const { view, block } of entries) {
          if (!block) continue
          setWorking(view.id)
          let reading: Reading
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
            reading = found
              ? {
                  key: readingKey(view),
                  candidate: found,
                  ...(missingTileCount
                    ? { warning: `${missingTileCount} terrain tiles did not load; the outline may stop short.` }
                    : {}),
                }
              : {
                  key: readingKey(view),
                  error: `Nothing of ${block.name}, or of the ground in front of it, is in view from here: there is no face to read. Try another view, or draw the landform by hand.`,
                }
            if (found) justRead.current = [...justRead.current, found]
          } catch (error) {
            if (abort.signal.aborted) return
            reading = { key: readingKey(view), error: error instanceof Error ? error.message : String(error) }
          }
          setReadings((before) => ({ ...before, [view.id]: reading }))
        }
      } finally {
        if (controller.current === abort) setWorking(null)
      }
    },
    [water, scene.settings.observerHeightMeters],
  )
  const dismiss = (viewId: string) =>
    setReadings((before) => {
      const next = { ...before }
      delete next[viewId]
      return next
    })
  const adopt = (items: typeof shown) => {
    onAdopt(items.map(({ entry, candidate }) => ({ view: entry.view, candidate })))
    setReadings((before) => {
      const next = { ...before }
      for (const { entry } of items) delete next[entry.view.id]
      return next
    })
  }

  if (!views.length) return null
  const severalBlocks = scene.targets.filter((target) => target.role === 'block').length > 1
  const readable = views.filter((entry) => entry.block)
  const own = views.filter((entry) => entry.own).length
  return (
    <ToolSubsection
      title="Views of interest"
      help="A view is assessed against the site landform unless it has one of its own. Read from this view reads the visible face of the view's block from the view's own place, as Find a landform from the terrain reads one from a chosen point, and draws it on the plan: a reading of the terrain from one station, not a checked delineation, so compare it with the view. Adopting it makes it that view's landform only; the site landform stays as it is. Standing at the view, or capturing it, then runs against its own landform, and its figure and saved sheet use it. An adopted face takes the site landform's objective and VAC and goes on following them until you give it its own."
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="text-2xs text-muted-foreground" data-view-landforms-summary="">
          {own
            ? `${own} of ${views.length} ${views.length === 1 ? 'view has' : 'views have'} a landform of ${own === 1 ? 'its' : 'their'} own.`
            : `${views.length === 1 ? 'The view is' : `All ${views.length} views are`} assessed against the site landform.`}
        </p>
        {readable.length > 1 && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="text-2xs"
            disabled={working !== null}
            onClick={() => void read(readable)}
          >
            {working !== null ? 'Reading the terrain…' : 'Read for every view'}
          </Button>
        )}
      </div>
      {adoptable.length > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <p className="text-2xs text-muted-foreground">{adoptable.length} readings can be adopted.</p>
          <Button type="button" size="xs" className="text-2xs" onClick={() => adopt(adoptable)}>
            Adopt each for its view
          </Button>
        </div>
      )}
      <ul className="space-y-2" aria-label="Landform of each view of interest">
        {views.map((entry) => {
          const { view, block, own: landform } = entry
          const reading = current(entry)
          const verdict = reading?.candidate ? verdictOf(entry, reading.candidate) : null
          const busy = working === view.id
          return (
            <li key={view.id} className="space-y-1.5 text-xs" data-view-landform={view.id}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
                    <span className="min-w-0 truncate">{view.name}</span>
                    {landform && landform.id === inUseId && (
                      <Badge tone="info" pill className="shrink-0">
                        In use at this stand
                      </Badge>
                    )}
                  </p>
                  <p className="text-2xs text-muted-foreground">
                    {/* Which block it faces matters only where there is more than one to face. */}
                    {!block ? 'Its block is no longer in the scene · ' : severalBlocks ? `Faces ${block.name} · ` : ''}
                    {landform
                      ? `Its own landform, ${hectares(landform.geometry)}${
                          followsSite(landform, site) ? '' : ', with its own objective or VAC'
                        }`
                      : entry.missing
                        ? 'Its own landform is no longer in the scene'
                        : site
                          ? 'The site landform'
                          : 'No landform yet'}
                  </p>
                </div>
                {(landform || entry.missing) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="shrink-0 text-2xs"
                    title="Takes the landform off this view, which is then assessed against the site landform. The landform stays in the scene."
                    aria-label={`Use the site landform for ${view.name}`}
                    onClick={() => onClear(view)}
                  >
                    Use the site&apos;s
                  </Button>
                )}
                {!reading?.candidate && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="shrink-0 text-2xs"
                    disabled={!block || working !== null}
                    title={block ? undefined : "The view's block is no longer in the scene."}
                    aria-label={`Read the landform seen from ${view.name}`}
                    onClick={() => void read([entry])}
                  >
                    {busy ? 'Reading…' : landform ? 'Read again' : 'Read from this view'}
                  </Button>
                )}
              </div>
              {landform && <ul className="space-y-1.5">{renderLandform(landform)}</ul>}
              {reading?.error && <InlineAlert tone="error">{reading.error}</InlineAlert>}
              {reading?.candidate && verdict && (
                <div className="space-y-1.5" aria-label={`Landform seen from ${view.name}`}>
                  <p className="text-3xs leading-4 text-muted-foreground">
                    {verdict.title}, drawn on the plan. Compare it with the view before adopting it.
                  </p>
                  {verdict.note && <InlineAlert tone={verdict.tone ?? 'info'}>{verdict.note}</InlineAlert>}
                  {reading.warning && <InlineAlert tone="warning">{reading.warning}</InlineAlert>}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="xs"
                      className="text-2xs"
                      disabled={!verdict.adoptable}
                      onClick={() => adopt([{ entry, candidate: reading.candidate! }])}
                    >
                      Adopt for this view
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="text-2xs"
                      onClick={() => dismiss(view.id)}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </ToolSubsection>
  )
}

/**
 * A view's landform in one line, in the view's own row: what it is assessed against, and where that is set. The
 * landform itself is set once, for every view, in step 1's *Landform and objective*.
 */
export function ViewLandformSummary({
  view,
  scene,
  site,
  onOpenLandforms,
}: {
  view: ViewOfInterest
  scene: ForestryScene
  site: TargetPolygon | null
  /** Opens step 1's *Landform and objective*, where each view's landform is read and adopted. */
  onOpenLandforms?: () => void
}) {
  const own = view.landformId
    ? (scene.targets.find((target) => target.id === view.landformId && target.role === 'landscape') ?? null)
    : null
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-xs" data-view-landform-summary={view.id}>
      <span className="min-w-0">
        <span className="text-muted-foreground">Landform: </span>
        {own && own.id !== site?.id
          ? `its own, ${own.name}`
          : view.landformId && !own
            ? 'its own is no longer in the scene'
            : site
              ? `the site landform, ${site.name}`
              : 'none yet'}
      </span>
      {onOpenLandforms && (
        <TextButton className="text-2xs" onClick={onOpenLandforms}>
          Set in step 1
        </TextButton>
      )}
    </p>
  )
}
