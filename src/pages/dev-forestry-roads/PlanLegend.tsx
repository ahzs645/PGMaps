import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LegendItem, MapGradientLegendItem, MapLegendPanel, MapLegendSection } from '@/components/ui/map-panels'
import { SheetSymbolSwatch } from '@/components/ui/sheet-symbol-swatch'
import {
  TERRAIN_SLOPE_STOPS,
  TERRAIN_ASPECT_STOPS,
  TERRAIN_ASPECT_FLAT_COLOR,
  TERRAIN_ELEVATION_COLORS,
  type TerrainDisplay,
} from './terrainDisplay'
import type { PlanLegendEntry, PlanLegendSection } from './planLegendModel'
import { terrainDisplayName } from './terrainName'
import type { PlanLegendPlacement } from './usePlanDisplay'

/** Thick enough to read the colour, drawn with the dash the map uses. */
function LineSwatch({ entry }: { entry: PlanLegendEntry }) {
  const width = 3
  return (
    <svg width="24" height="8" viewBox="0 0 24 8" aria-hidden="true" className="shrink-0">
      <line
        x1="0"
        x2="24"
        y1="4"
        y2="4"
        stroke={entry.color}
        strokeWidth={width}
        strokeDasharray={
          entry.shape === 'dashed-line' ? (entry.dash ?? [3, 2]).map((part) => part * width).join(' ') : undefined
        }
      />
    </svg>
  )
}

/**
 * Whether the legend is folded. It starts folded, and folds again whenever a plan tool is picked:
 * the tool's panel shares the plan's lower edge, and an open legend covered its fields and Finish.
 * The reader can still open it while the tool is up.
 */
export function useLegendFold(toolOpen: boolean, setExpanded: (open: boolean) => void) {
  useEffect(() => {
    if (toolOpen) setExpanded(false)
  }, [toolOpen, setExpanded])
}

export function PlanLegend({
  sections,
  display,
  terrainLayer,
  showContours,
  terrainName,
  toolOpen = false,
  expanded,
  onExpandedChange,
  placement = 'map',
  belowSlot = null,
}: {
  sections: PlanLegendSection[]
  display: TerrainDisplay | null
  terrainLayer: 'hillshade' | 'slope' | 'aspect' | 'elevation' | 'none'
  showContours: boolean
  terrainName: string
  /** A plan tool's panel is up (`PlanTools.tsx`); picking one folds the legend. */
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  toolOpen?: boolean
  /** Over the map's corner, or in its own strip under the map (rendered into `belowSlot`). */
  placement?: PlanLegendPlacement
  /** The plan's strip under the map; the legend stays on the map until it exists. */
  belowSlot?: HTMLElement | null
}) {
  const below = placement === 'below' && !!belowSlot
  // Under the map the legend covers nothing, so a tool's panel has no reason to fold it.
  useLegendFold(toolOpen && !below, onExpandedChange)
  const contours = !!display && showContours && display.contours.features.length > 0
  const terrain = !!display && (terrainLayer !== 'none' || contours)
  if (!sections.length && !terrain) return null
  const content = (className: string) => (
    <div className={className} data-testid="road-plan-legend-content">
      <PlanLegendSections
        sections={sections}
        display={terrain ? display : null}
        terrainLayer={terrainLayer}
        contours={contours}
        terrainName={terrainName}
      />
    </div>
  )
  if (below && belowSlot)
    return createPortal(
      <div
        data-testid="road-terrain-legend"
        data-placement="below"
        className="road-plan-legend-below flex min-h-0 flex-col border-t pt-1.5"
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse legend' : 'Expand legend'}
          className="flex w-full shrink-0 items-center justify-between gap-2 rounded-sm py-0.5 text-left text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => onExpandedChange(!expanded)}
        >
          Legend
          <ChevronDown
            className={`size-3.5 text-muted-foreground transition-transform ${expanded ? '' : '-rotate-90'}`}
            aria-hidden="true"
          />
        </button>
        {expanded &&
          content(
            // As many columns as the plan is wide; each section stays whole in its column.
            'mt-1 grid min-h-0 grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] items-start gap-x-6 gap-y-3 overflow-y-auto overscroll-none pb-1 text-2xs',
          )}
      </div>,
      belowSlot,
    )
  return (
    <div data-testid="road-terrain-legend" data-placement="map">
      <MapLegendPanel
        title="Legend"
        collapsible
        collapsed={!expanded}
        onCollapsedChange={(value) => onExpandedChange(!value)}
        width="sm"
        className={
          // Corners, shadow and the folded height match the plan's other 32 px controls. While a plan
          // tool's panel (20 rem, bottom left) is up, the legend stops short of it rather than cover it.
          `road-map-legend bottom-2 right-2 flex max-h-[calc(100%-1rem)] ${toolOpen ? 'max-w-[max(2.5rem,calc(100%-21.5rem))]' : 'max-w-[calc(100%-1rem)]'} flex-col rounded-md p-2 shadow-sm workspace-desktop:bottom-2 workspace-desktop:right-2 workspace-desktop:rounded-md workspace-desktop:p-2 data-[collapsed]:h-8 data-[collapsed]:justify-center data-[collapsed]:py-0 workspace-desktop:data-[collapsed]:py-0 [&>div:first-child]:shrink-0`
        }
        contentClassName="min-h-0 max-h-64 overflow-y-auto overscroll-none text-2xs"
      >
        {content('mt-1 space-y-3 border-t pt-1.5')}
      </MapLegendPanel>
    </div>
  )
}

/** The legend's sections, the same whether it sits on the map or under it. */
function PlanLegendSections({
  sections,
  display,
  terrainLayer,
  contours,
  terrainName,
}: {
  sections: PlanLegendSection[]
  /** The terrain's display, or null when the terrain has nothing to key. */
  display: TerrainDisplay | null
  terrainLayer: 'hillshade' | 'slope' | 'aspect' | 'elevation' | 'none'
  contours: boolean
  terrainName: string
}): ReactNode {
  return (
    <>
      {sections.map((section) => (
        <MapLegendSection
          key={section.id}
          title={section.title}
          description={section.description}
          actions={
            section.action && (
              <Button size="2xs" variant="ghost" className="shrink-0" onClick={section.action.onClick}>
                {section.action.label}
              </Button>
            )
          }
          data-legend-section={section.id}
        >
          {section.ramp && (
            <MapGradientLegendItem
              className="py-1"
              aria-label={section.ramp.ariaLabel}
              data-testid={`road-legend-ramp-${section.id}`}
              colors={section.ramp.colors}
              // Three ticks: the ends left and right, the middle centred over its point of the ramp.
              labelClassName="grid grid-cols-3 gap-1 leading-tight [&>span:nth-child(2)]:text-center [&>span:last-child]:text-right"
              ticks={section.ramp.ticks.map((tick) => (
                <>
                  <span className="block tabular-nums text-foreground">{tick.label}</span>
                  {tick.note && <span className="block text-2xs">{tick.note}</span>}
                </>
              ))}
            />
          )}
          {section.entries.map((entry) => (
            <LegendItem
              key={entry.id}
              color={entry.color}
              label={entry.label}
              className="[&>div>span:last-child]:whitespace-normal [&>div>span:last-child]:break-words"
              swatchShape={entry.shape === 'area' ? 'square' : entry.shape}
              swatch={
                entry.sheetSymbol ? (
                  <SheetSymbolSwatch symbol={entry.sheetSymbol} />
                ) : entry.shape === 'area' ? (
                  <span
                    className="h-3 w-4 rounded-sm border border-dashed"
                    style={{ borderColor: entry.color, backgroundColor: `${entry.color}2e` }}
                  />
                ) : entry.shape === 'square' && !entry.symbol ? (
                  <span
                    className="size-3 rounded-sm"
                    style={{ backgroundColor: entry.color, boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / 0.25)' }}
                  />
                ) : entry.symbol ? (
                  <span
                    className="flex h-4 w-5 items-center justify-center text-3xs font-semibold"
                    style={{ color: entry.color }}
                  >
                    {entry.symbol}
                  </span>
                ) : entry.shape === 'line' || entry.shape === 'dashed-line' ? (
                  <LineSwatch entry={entry} />
                ) : undefined
              }
            />
          ))}
        </MapLegendSection>
      ))}
      {display && (
        <MapLegendSection title="Terrain" data-legend-section="terrain">
          {terrainLayer === 'hillshade' && (
            <LegendItem color="#a3a3a3" swatchShape="square" label="Terrain hillshade" />
          )}
          {contours && (
            <LegendItem color="#57534e" swatchShape="line" label={`${display.contourInterval} m contours`} />
          )}
          {terrainLayer === 'slope' && (
            <MapGradientLegendItem
              className="py-1"
              aria-label="Terrain slope in degrees"
              colors={TERRAIN_SLOPE_STOPS.map((stop) => `${stop.color} ${(stop.value / 60) * 100}%`)}
              minLabel="Slope 0°"
              maxLabel="60°+"
            />
          )}
          {terrainLayer === 'elevation' && (
            <>
              <p>
                Elevation {Math.round(display.elevationRange[0])}–{Math.round(display.elevationRange[1])} m
              </p>
              <MapGradientLegendItem
                aria-label="Terrain elevation colours"
                colors={TERRAIN_ELEVATION_COLORS}
                minLabel={`${Math.round(display.elevationRange[0])} m`}
                maxLabel={`${Math.round(display.elevationRange[1])} m`}
              />
            </>
          )}
          {terrainLayer === 'aspect' && (
            <>
              <p>Aspect · downslope direction</p>
              <MapGradientLegendItem
                className="py-1"
                aria-label="Terrain aspect clockwise from north"
                colors={TERRAIN_ASPECT_STOPS.map((stop) => `${stop.color} ${stop.value / 3.6}%`)}
                minLabel="N 0°"
                maxLabel="N 360°"
              />
              <p className="flex justify-around">
                <span>E 90°</span>
                <span>S 180°</span>
                <span>W 270°</span>
              </p>
              <LegendItem
                color={TERRAIN_ASPECT_FLAT_COLOR}
                swatchShape="square"
                label="Flat · missing terrain transparent"
              />
            </>
          )}
          {/* The source without its bounding box; the full name and why the cells differ are on hover. */}
          <p
            className="break-words border-t pt-1 text-muted-foreground"
            title={`${terrainName}. The map draws a sampled preview at about ${Math.round(display.resolutionM)} m; calculations use the native terrain.`}
            data-testid="road-legend-terrain-source"
          >
            {terrainDisplayName(terrainName)}, drawn at ≈ {Math.round(display.resolutionM)} m
          </p>
        </MapLegendSection>
      )}
    </>
  )
}
