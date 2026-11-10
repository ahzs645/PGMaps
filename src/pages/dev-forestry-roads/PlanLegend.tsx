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

export function PlanLegend({
  sections,
  display,
  terrainLayer,
  showContours,
  terrainName,
}: {
  sections: PlanLegendSection[]
  display: TerrainDisplay | null
  terrainLayer: 'hillshade' | 'slope' | 'aspect' | 'elevation' | 'none'
  showContours: boolean
  terrainName: string
}) {
  const contours = !!display && showContours && display.contours.features.length > 0
  const terrain = !!display && (terrainLayer !== 'none' || contours)
  if (!sections.length && !terrain) return null
  return (
    <div data-testid="road-terrain-legend">
      <MapLegendPanel
        title="Legend"
        collapsible
        defaultCollapsed
        width="sm"
        className={
          // Corners, shadow and the folded height match the plan's other 32 px controls.
          'road-map-legend bottom-2 right-2 flex max-h-[calc(100%-1rem)] max-w-[calc(100%-1rem)] flex-col rounded-md p-2 shadow-sm workspace-desktop:bottom-2 workspace-desktop:right-2 workspace-desktop:rounded-md workspace-desktop:p-2 data-[collapsed]:h-8 data-[collapsed]:justify-center data-[collapsed]:py-0 workspace-desktop:data-[collapsed]:py-0 [&>div:first-child]:shrink-0'
        }
        contentClassName="min-h-0 max-h-64 overflow-y-auto overscroll-contain text-2xs"
      >
        <div className="mt-1 space-y-3 border-t pt-1.5" data-testid="road-plan-legend-content">
          {sections.map((section) => (
            <MapLegendSection key={section.id} title={section.title} data-legend-section={section.id}>
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
          {terrain && display && (
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
        </div>
      </MapLegendPanel>
    </div>
  )
}
