import { MapGradientLegendItem, MapLegendNote, MapLegendPanel, MapSwatch } from '@/components/ui/map-panels'
import { ANALYSIS_MODES } from './analysisWorkflows'
import { isSpeciesMode, SPECIES_COLOURS, speciesLegend } from './species'
import type { LidarController } from './useLidarWorkspace'

/** The map's legend, floating in its bottom-right corner like every other map page's. */
export function LidarLegend({ controller, className }: { controller: LidarController; className?: string }) {
  const { summary, basemap, surfaceVisible, raster, analysisOptions, forestLegend, legend, workflowProducts } =
    controller
  if (!summary || !legend) return null
  const categorical = isSpeciesMode(analysisOptions.mode) && speciesLegend(analysisOptions).categorical
  const forestUnit = isSpeciesMode(analysisOptions.mode)
    ? speciesLegend(analysisOptions).unit
    : analysisOptions.mode === 'texture' || analysisOptions.mode === 'canopy-height'
      ? ' m'
      : analysisOptions.mode === 'edges' || analysisOptions.mode === 'canopy-density'
        ? '%'
        : ''
  const title = forestLegend
    ? forestLegend.label
    : analysisOptions.mode
      ? (ANALYSIS_MODES.find((item) => item.id === analysisOptions.mode)?.label ?? legend.title)
      : surfaceVisible
        ? legend.title
        : 'Processed surface hidden'
  const description =
    !forestLegend && analysisOptions.mode
      ? ANALYSIS_MODES.find((item) => item.id === analysisOptions.mode)?.note
      : !surfaceVisible && !forestLegend
        ? basemap === 'vector'
          ? 'Vector context only'
          : basemap === 'satellite'
            ? 'Satellite context only'
            : 'Basemap hidden'
        : undefined
  return (
    <MapLegendPanel
      title={title}
      description={description}
      collapsible
      defaultCollapsed="mobile"
      width="sm"
      className={className}
      aria-label="Processed surface legend"
    >
      {categorical && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label="Species colour legend">
          {Object.entries(SPECIES_COLOURS).map(([code, colour]) => (
            <span key={code} className="flex items-center gap-1" title={workflowProducts.data?.species.species[code]}>
              <MapSwatch color={colour} />
              {code}
            </span>
          ))}
          <span className="flex items-center gap-1">
            <MapSwatch className="bg-slate-400" />
            Unknown
          </span>
        </div>
      )}
      {(surfaceVisible || forestLegend) && !categorical && (
        <MapGradientLegendItem
          colors={forestLegend?.colors ?? legend.colors}
          ticks={
            forestLegend
              ? [forestLegend.min, `${forestLegend.max}${forestUnit}`]
              : raster === 'crowns'
                ? ['Categorical regions']
                : [legend.min.toFixed(0), `${legend.max.toFixed(0)} ${legend.unit}`]
          }
        />
      )}
      <MapLegendNote className="mt-1.5">Click the map to inspect height · candidates are unvalidated</MapLegendNote>
    </MapLegendPanel>
  )
}
