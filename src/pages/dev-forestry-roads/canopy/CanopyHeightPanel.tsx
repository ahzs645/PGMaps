import { useState } from 'react'
import { ChevronDown, ChevronUp, TreePine, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { CANOPY_HEIGHT_CLASSES } from '@/lib/forestry/blockSheet/styles'
import { CHM_MIN_ZOOM } from '@/lib/forestry/canopy/chmView'
import { labelStation } from '../roadStationing'
import { CANOPY_LAYER_OPACITY } from './CanopyHeightLayer'
import type { CanopyDates, CanopyHeightState } from './useCanopyHeight'

const percent = (share: number) => `${Math.round(share * 100)}%`
const years = (d: CanopyDates) => {
  const [a, b] = [d.from.slice(0, 4), d.to.slice(0, 4)]
  return a === b ? a : `${a}–${b}`
}

/**
 * The canopy height layer's card on the plan: its classes, the imagery years under the view and, on
 * request, what the active road's corridor reads. Values here; explanations behind the InfoTips.
 */
export function CanopyHeightPanel({
  state,
  paused,
  moving,
  roadName,
  onClose,
}: {
  state: CanopyHeightState
  paused: boolean
  moving: boolean
  roadName: string
  onClose: () => void
}) {
  const [folded, setFolded] = useState(false)
  const corridor = state.corridor?.summary
  return (
    <section
      className="w-64 max-w-full overflow-y-auto overscroll-none rounded-md border bg-background/95 p-2 text-xs shadow-sm"
      style={{ maxHeight: 'inherit' }}
      aria-label="Canopy height"
      data-testid="road-canopy-panel"
      data-map-export-ignore
    >
      <div className="flex items-center gap-1">
        <TreePine className="size-3.5 shrink-0" aria-hidden="true" />
        <h3 className="min-w-0 flex-1 truncate font-semibold">Canopy height (CHM v2)</h3>
        <InfoTip label="About the canopy height map" bubbleClassName="max-w-72">
          Meta and WRI&apos;s global canopy height map v2 (2026), a model&apos;s prediction from satellite imagery, read
          from Source Cooperative. It shows where the forest and the openings are well (canopy cover matched airborne
          LiDAR at r 0.93 near Prince George), but its heights read low by an amount that changes from site to site (7.9
          m low at Prince George, 0.5 m on a licensee&apos;s LiDAR sheet), so no height here is corrected. The imagery
          is several years old: cuts since then still show as forest. Evidence for review only: it is never a
          constraint, never feeds a route search and never changes a quantity.
        </InfoTip>
        <Button
          size="icon-2xs"
          variant="ghost"
          aria-label={folded ? 'Show canopy height details' : 'Fold canopy height details'}
          aria-expanded={!folded}
          onClick={() => setFolded(!folded)}
        >
          {folded ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
        </Button>
        <Button size="icon-2xs" variant="ghost" aria-label="Hide canopy height" onClick={onClose}>
          <X className="size-3" />
        </Button>
      </div>
      {!folded && (
        <div className="mt-2 space-y-2">
          {paused && <InlineAlert>Zoom in to level {CHM_MIN_ZOOM} to load canopy height for this view.</InlineAlert>}
          {!paused && moving && <InlineAlert>Canopy updates when you stop moving the map.</InlineAlert>}
          {state.status === 'loading' && <InlineAlert loading>Reading canopy height…</InlineAlert>}
          {state.status === 'error' && state.error && <InlineAlert tone="error">{state.error}</InlineAlert>}
          <div className="grid grid-cols-4 gap-x-1 gap-y-0.5" data-testid="road-canopy-classes">
            {CANOPY_HEIGHT_CLASSES.filter((c) => c.color).map((c) => (
              <span key={c.label} className="flex items-center gap-1 whitespace-nowrap">
                <span
                  className="inline-block size-2.5 shrink-0 rounded-sm border border-black/20"
                  style={{ background: c.color!, opacity: CANOPY_LAYER_OPACITY }}
                  aria-hidden="true"
                />
                {c.label.replace(/\s/g, '')}
              </span>
            ))}
          </div>
          <div className="text-muted-foreground">
            Metres · under 5 m clear
            {state.image && ` · ${state.image.cellM.toFixed(1)} m cells`}
            {state.dates && ` · imagery ${years(state.dates)}`}
          </div>
          <div className="border-t pt-2">
            <div className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate font-medium">Corridor of {roadName}</span>
              <InfoTip label="About the corridor read" bubbleClassName="max-w-72">
                Read at full resolution (about 0.7 m) across the road at every calculated station. Timber is canopy of 5
                m or more inside the clearing (the design&apos;s slope stakes and clearing, else 10 m a side). A
                reaching tree stands outside the clearing and is as tall as its distance to the running surface. A gap
                is open centreline between timber on both sides for 25 m or more: an old trail, a seismic line, or only
                a mapping artefact. The model fills gaps between crowns, so its timber share runs above a company canopy
                sheet&apos;s (15–40 points on the reference block).
              </InfoTip>
            </div>
            {corridor ? (
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5" data-testid="road-canopy-corridor">
                <dt className="text-muted-foreground">Timber in clearing</dt>
                <dd>
                  {corridor.clearingTimberShare === null ? 'not read' : percent(corridor.clearingTimberShare)} of{' '}
                  {(corridor.clearingAreaM2 / 10_000).toFixed(2)} ha
                </dd>
                <dt className="text-muted-foreground">Reaching trees</dt>
                <dd>
                  {corridor.reachingStations} of {corridor.stations} stations
                  {corridor.tallestReaching &&
                    ` · tallest ${corridor.tallestReaching.heightM} m at ${labelStation(corridor.tallestReaching.chainage)}`}
                </dd>
                <dt className="text-muted-foreground">Gaps</dt>
                <dd>
                  {corridor.gaps.length
                    ? corridor.gaps.map((g) => `${labelStation(g.fromM)}–${labelStation(g.toM)}`).join(', ')
                    : 'none'}
                </dd>
                {state.corridor?.dates && (
                  <>
                    <dt className="text-muted-foreground">Imagery</dt>
                    <dd>{years(state.corridor.dates)}</dd>
                  </>
                )}
              </dl>
            ) : null}
            {state.corridorStatus === 'error' && state.corridorError && (
              <InlineAlert tone="error">{state.corridorError}</InlineAlert>
            )}
            <Button
              size="2xs"
              variant="outline"
              className="mt-1 w-full"
              disabled={state.corridorStatus === 'loading'}
              onClick={state.readCorridor}
            >
              {state.corridorStatus === 'loading'
                ? 'Reading the corridor…'
                : corridor
                  ? 'Read again'
                  : 'Read the corridor'}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
