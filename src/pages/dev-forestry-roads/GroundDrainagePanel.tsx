import { useRef, useState } from 'react'
import { ChevronDown, ChevronUp, CloudRain, FileUp, PenTool, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { ReadoutGrid } from '@/components/ui/readout-grid'
import { RoadSelect } from './Controls'
import { DrainageRoutingFields, PourPointFields, WatershedFields } from './DrainageFields'
import { MAX_DRAINAGE_ROUTED_CELLS } from './drainageRun'
import {
  DEFAULT_GROUND_DRAINAGE_SETTINGS,
  MAX_GROUND_DRAINAGE_MARGIN_M,
  type GroundDrainageArea,
  type GroundDrainageSettings,
  type GroundDrainageState,
} from './groundDrainage'
import { SPATIAL_ACCEPT } from './spatialImport'
import type { useGroundDrainage } from './useGroundDrainage'

const whole = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 })
const two = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 2 })
const SOURCE_LABEL: Record<GroundDrainageArea['source'], string> = {
  drawn: 'Drawn',
  imported: 'Imported',
  block: 'Block',
}

export interface AreaChoice {
  name: string
  geometry: GroundDrainageArea['geometry']
}

/**
 * The plan card for Existing-ground drainage: the analysis area (drawn, imported or a block's
 * boundary), the routing settings, what was routed (extent, terrain, cell size, gaps) and the
 * catchment above a pour point. Values here; explanations behind the InfoTips. The routing,
 * watershed and pour-point fields are the road check's own (`DrainageFields.tsx`).
 */
export function GroundDrainagePanel({
  state,
  onChange,
  blocks,
  drawing,
  onDraw,
  onImport,
  importChoices,
  onChooseImport,
  picking,
  onPickOutlet,
  drainage,
  sourceM,
  onClose,
  onOpenRoadCheck,
}: {
  state: GroundDrainageState | undefined
  onChange: (next: GroundDrainageState) => void
  /** Harvest blocks on the plan with a polygon boundary. */
  blocks: { id: string; name: string; geometry: GroundDrainageArea['geometry'] }[]
  drawing: boolean
  onDraw: () => void
  onImport: (file: File) => void
  /** Polygons read from an imported file that holds more than one, for the person to choose. */
  importChoices: { fileName: string; choices: AreaChoice[] } | null
  onChooseImport: (choice: AreaChoice | 'all' | null) => void
  picking: boolean
  onPickOutlet: () => void
  drainage: ReturnType<typeof useGroundDrainage>
  sourceM: number
  onClose: () => void
  /** Opens the road's drainage check (the Drainage detail view); omitted while there is no road. */
  onOpenRoadCheck?: () => void
}) {
  const [folded, setFolded] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const settings = state?.settings ?? DEFAULT_GROUND_DRAINAGE_SETTINGS
  const area = state?.area
  const set = (patch: Partial<GroundDrainageSettings>) => {
    const next = { ...settings, ...patch }
    for (const key of Object.keys(patch) as (keyof GroundDrainageSettings)[])
      if (patch[key] === undefined) delete next[key]
    onChange({ ...state, settings: next })
  }
  const { result, current, stale, progress, error, outlet, outletError } = drainage
  const summary = current ? result?.summary : undefined
  const cellHa = summary ? summary.cellM ** 2 / 10_000 : 0
  const running = !!progress
  return (
    <section
      className="w-72 max-w-full overflow-y-auto overscroll-none rounded-md border bg-background/95 p-2 text-xs shadow-sm"
      style={{ maxHeight: 'inherit' }}
      aria-label="Existing-ground drainage"
      data-testid="road-ground-drainage-panel"
      data-map-export-ignore
    >
      <div className="flex items-center gap-1">
        <CloudRain className="size-3.5 shrink-0" aria-hidden="true" />
        <h3 className="min-w-0 flex-1 truncate font-semibold">Existing-ground drainage</h3>
        <InfoTip label="About existing-ground drainage" bubbleClassName="max-w-72">
          Routes rain over the terrain inside the analysis area and its upslope margin, before any road is pegged: D8
          flow with the depressions filled, contributing area, stream lines and, when asked, watersheds and the
          catchment above a pour point. It is the same routing as the road&apos;s drainage check, on the ground alone.
          Cells without ground stay gaps and act as outlets, so a catchment that reaches a gap or the edge of what was
          sampled may continue past it. A planning screen, not a hydrotechnical design.
        </InfoTip>
        <Button
          size="icon-2xs"
          variant="ghost"
          aria-label={folded ? 'Show drainage settings' : 'Fold drainage settings'}
          aria-expanded={!folded}
          onClick={() => setFolded(!folded)}
        >
          {folded ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
        </Button>
        <Button size="icon-2xs" variant="ghost" aria-label="Close existing-ground drainage" onClick={onClose}>
          <X className="size-3" />
        </Button>
      </div>
      {!folded && (
        <div className="mt-2 space-y-2">
          <div className="space-y-1" aria-label="Analysis area">
            <div className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Analysis area</div>
            {area ? (
              <div className="flex items-center gap-1" data-testid="road-ground-drainage-area">
                <span className="min-w-0 flex-1 truncate">
                  {SOURCE_LABEL[area.source]} · {area.name}
                  {result && current ? ` · ${two.format(result.areaHa)} ha` : ''}
                </span>
                <Button
                  size="2xs"
                  variant="ghost"
                  onClick={() => onChange({ settings })}
                  aria-label="Clear the analysis area"
                >
                  Clear
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground">No area yet.</p>
            )}
            <div className="grid grid-cols-2 gap-1">
              <Button size="2xs" variant={drawing ? 'secondary' : 'outline'} aria-pressed={drawing} onClick={onDraw}>
                <PenTool className="size-3" />
                {drawing ? 'Drawing…' : 'Draw'}
              </Button>
              <Button size="2xs" variant="outline" onClick={() => fileInput.current?.click()}>
                <FileUp className="size-3" />
                Import polygon
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept={SPATIAL_ACCEPT}
                className="hidden"
                data-testid="road-ground-drainage-import"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) onImport(file)
                }}
              />
            </div>
            {blocks.length > 0 && (
              <RoadSelect
                ariaLabel="Use a block's boundary"
                value={area?.source === 'block' ? (area.contextId ?? '') : ''}
                placeholder="Use a block's boundary"
                className="h-7 w-full"
                onValueChange={(id) => {
                  const block = blocks.find((b) => b.id === id)
                  if (block)
                    onChange({
                      ...state,
                      settings,
                      area: { source: 'block', name: block.name, contextId: block.id, geometry: block.geometry },
                    })
                }}
                options={blocks.map((b) => ({ value: b.id, label: b.name }))}
              />
            )}
            {importChoices && (
              <div className="space-y-1 rounded-md border p-1.5" aria-label="Polygons in the file">
                <div className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate">
                    {importChoices.fileName}: {importChoices.choices.length} polygons
                  </span>
                  <Button size="2xs" variant="ghost" onClick={() => onChooseImport(null)}>
                    Cancel
                  </Button>
                </div>
                <ul className="max-h-32 space-y-0.5 overflow-y-auto">
                  {importChoices.choices.map((choice, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        className="w-full truncate rounded-md px-1.5 py-1 text-left hover:bg-accent"
                        onClick={() => onChooseImport(choice)}
                      >
                        {choice.name}
                      </button>
                    </li>
                  ))}
                </ul>
                <Button size="2xs" variant="outline" className="w-full" onClick={() => onChooseImport('all')}>
                  Use all {importChoices.choices.length} as one area
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-1" role="group" aria-label="Routing">
            <div className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Routing</div>
            <div className="grid grid-cols-2 items-end gap-1.5">
              <DrainageRoutingFields
                value={{
                  streamThresholdHa: settings.streamThresholdHa,
                  reachM: settings.marginM,
                  workingResolutionM: settings.workingResolutionM,
                  depressionPolicy: settings.depressionPolicy,
                }}
                reach={{
                  min: 0,
                  max: MAX_GROUND_DRAINAGE_MARGIN_M,
                  hint: "Ground sampled beyond the area's boundary, so catchments draining into it are not cut off at the line.",
                }}
                customCellM={Math.max(5, Math.ceil(sourceM))}
                updateOn="commit"
                onChange={({ reachM, ...patch }) => set(reachM === undefined ? patch : { ...patch, marginM: reachM })}
              />
            </div>
            <WatershedFields
              minAreaHa={settings.watershedMinAreaHa}
              onChange={(watershedMinAreaHa) => set({ watershedMinAreaHa })}
              note="Splits the routed ground by its D8 outlets. Watersheds touching the edge of the area and margin or missing terrain may be incomplete."
              updateOn="commit"
            />
          </div>

          <div className="flex items-center gap-1">
            <Button
              size="xs"
              className="flex-1"
              disabled={!area || running}
              onClick={() => void drainage.run()}
              data-testid="road-ground-drainage-run"
            >
              {result && current ? 'Route again' : 'Route flow'}
            </Button>
            {running && (
              <Button size="xs" variant="outline" onClick={drainage.cancel}>
                Cancel
              </Button>
            )}
          </div>
          {progress && (
            <InlineAlert loading>
              {progress.stage === 'sampling'
                ? `Sampling the terrain · tile ${whole.format(progress.done)} of ${whole.format(progress.total)}`
                : 'Routing flow…'}
            </InlineAlert>
          )}
          {error && <InlineAlert tone="error">{error}</InlineAlert>}
          {stale && !running && (
            <InlineAlert tone="warning">
              The terrain, area or a routing setting changed since this was routed. Route again to draw it.
            </InlineAlert>
          )}

          {summary && result && (
            <ReadoutGrid
              minColumnWidth="7.5rem"
              className="text-xs leading-5"
              data-testid="road-ground-drainage-summary"
              items={[
                { label: 'Terrain', value: result.terrainName },
                {
                  label: 'Working cell',
                  value: `${two.format(summary.cellM)} m${summary.coarsenedForBudget ? ' (coarsened)' : ''}`,
                },
                {
                  label: 'Routing extent',
                  value: `${two.format(summary.extentM[0] / 1000)} × ${two.format(summary.extentM[1] / 1000)} km`,
                },
                { label: 'Cells routed', value: whole.format(summary.heldCells) },
                { label: 'Area', value: `${two.format(summary.areaCells * cellHa)} ha` },
                summary.marginCells > 0 && {
                  label: 'Margin',
                  value: `${two.format(summary.marginCells * cellHa)} ha`,
                },
                {
                  label: 'Gaps in area',
                  value: summary.missingAreaCells ? `${two.format(summary.missingAreaCells * cellHa)} ha` : 'None',
                },
                summary.marginCells > 0 && {
                  label: 'Gaps in margin',
                  value: summary.missingMarginCells ? `${two.format(summary.missingMarginCells * cellHa)} ha` : 'None',
                },
                { label: 'Stream lines', value: whole.format(result.routed.streams.features.length) },
                result.routed.watersheds && {
                  label: 'Watersheds',
                  value: whole.format(result.routed.watersheds.features.length),
                },
              ]}
            />
          )}
          {summary?.coarsenedForBudget && (
            <InlineAlert tone="warning">
              The cell was coarsened from {two.format(summary.minimumM)} m to {two.format(summary.cellM)} m so the area
              fits the {whole.format(MAX_DRAINAGE_ROUTED_CELLS)}-cell budget.
            </InlineAlert>
          )}
          {summary && (summary.missingAreaCells > 0 || summary.missingMarginCells > 0) && (
            <InlineAlert tone="warning">
              The terrain has gaps here. They stay gaps and act as outlets, so flow and catchments stop at them.
            </InlineAlert>
          )}

          <div className="space-y-1" role="group" aria-label="Pour point">
            <div className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Pour point</div>
            <PourPointFields
              options={{ snapRadiusM: settings.snapRadiusM, snapPolicy: settings.snapPolicy ?? 'max-accumulation' }}
              onOptions={({ snapRadiusM, snapPolicy }) =>
                set({
                  ...(snapRadiusM === undefined ? {} : { snapRadiusM }),
                  ...(snapPolicy === undefined ? {} : { snapPolicy }),
                })
              }
              point={state?.outlet}
              onPoint={(point) => onChange({ ...state, settings, outlet: point })}
              picking={picking}
              onPick={onPickOutlet}
              disabled={!current || !result}
              disabledReason="Route flow first: the pour point is read from the routed ground."
              updateOn="commit"
            />
            {outletError && <InlineAlert tone="error">{outletError}</InlineAlert>}
            {outlet && current && (
              <>
                <ReadoutGrid
                  minColumnWidth="7.5rem"
                  className="text-xs leading-5"
                  data-testid="road-ground-drainage-outlet"
                  items={[
                    { label: 'Snapped', value: `${two.format(outlet.result.snappedDistanceM)} m away` },
                    { label: 'Contributing area', value: `${two.format(outlet.result.areaHa)} ha` },
                    outlet.result.inMarginHa > 0 && {
                      label: 'In the margin',
                      value: `${two.format(outlet.result.inMarginHa)} ha`,
                    },
                  ]}
                />
                {outlet.result.touchesBoundary || outlet.result.touchesMissingGround ? (
                  <div data-testid="road-ground-drainage-truncated">
                    <InlineAlert tone="warning">
                      The catchment reaches{' '}
                      {[
                        outlet.result.touchesBoundary && 'the edge of the area and margin',
                        outlet.result.touchesMissingGround && 'missing ground',
                      ]
                        .filter(Boolean)
                        .join(' and ')}
                      , so its area may continue past it. Widen the upslope buffer or load terrain that covers it.
                    </InlineAlert>
                  </div>
                ) : (
                  <p className="text-muted-foreground">Inside the area and margin, on ground throughout.</p>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-1 border-t pt-2 text-muted-foreground">
            <span className="min-w-0 flex-1">Same routing as the road&apos;s drainage check, on the ground alone.</span>
            {onOpenRoadCheck && (
              <Button size="2xs" variant="ghost" onClick={onOpenRoadCheck}>
                Road check
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
