import { LegendItem, MapGradientLegendItem, MapLegendPanel, MapLegendSection } from '@/components/ui/map-panels'
import {
  TERRAIN_SLOPE_STOPS,
  TERRAIN_ASPECT_STOPS,
  TERRAIN_ASPECT_FLAT_COLOR,
  TERRAIN_ELEVATION_COLORS,
  type TerrainDisplay,
} from './terrainDisplay'
import type { PlanLegendSection } from './planLegend'

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
        className="road-map-legend bottom-2 right-2 flex max-h-[calc(100%-1rem)] max-w-[calc(100%-1rem)] flex-col workspace-desktop:bottom-2 workspace-desktop:right-2 workspace-desktop:p-2 [&>div:first-child]:shrink-0"
        contentClassName="min-h-0 max-h-64 overflow-y-auto overscroll-contain text-[11px]"
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
                    entry.shape === 'area' ? (
                      <span
                        className="h-3 w-4 rounded-sm border border-dashed"
                        style={{ borderColor: entry.color, backgroundColor: `${entry.color}2e` }}
                      />
                    ) : entry.symbol ? (
                      <span
                        className="flex h-4 w-5 items-center justify-center text-[10px] font-semibold"
                        style={{ color: entry.color }}
                      >
                        {entry.symbol}
                      </span>
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
              <p
                className="break-words border-t pt-1 text-muted-foreground"
                title="The map uses a sampled terrain preview; calculations use native terrain."
              >
                {terrainName}
                <br />
                Map preview ≈ {Math.round(display.resolutionM)} m cells
              </p>
            </MapLegendSection>
          )}
        </div>
      </MapLegendPanel>
    </div>
  )
}
