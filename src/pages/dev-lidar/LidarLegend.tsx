import { MapGradientLegendItem, MapSwatch } from '@/components/ui/map-panels'
import { ANALYSIS_MODES } from './analysisWorkflows'
import { isSpeciesMode, SPECIES_COLOURS, speciesLegend } from './species'
import type { LidarController } from './useLidarWorkspace'

export function LidarLegend({ controller }: { controller: LidarController }) {
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
  return (
    <div className="flex shrink-0 items-center gap-3 border-t px-3 py-2 text-3xs" aria-label="Processed surface legend">
      <span className="min-w-0 flex-1 truncate font-medium" title={forestLegend?.label ?? legend.title}>
        {forestLegend
          ? forestLegend.label
          : analysisOptions.mode
            ? ANALYSIS_MODES.find((item) => item.id === analysisOptions.mode)?.note
            : surfaceVisible
              ? legend.title
              : `${basemap === 'vector' ? 'Vector context' : basemap === 'satellite' ? 'Satellite context' : 'Basemap hidden'} · surface hidden`}
      </span>
      {categorical && (
        <div className="flex max-w-[65%] shrink items-center gap-2 overflow-x-auto" aria-label="Species colour legend">
          {Object.entries(SPECIES_COLOURS).map(([code, colour]) => (
            <span
              key={code}
              className="flex shrink-0 items-center gap-1"
              title={workflowProducts.data?.species.species[code]}
            >
              <MapSwatch color={colour} />
              {code}
            </span>
          ))}
          <span className="flex shrink-0 items-center gap-1">
            <MapSwatch className="bg-slate-400" />
            Unknown
          </span>
        </div>
      )}
      {(surfaceVisible || forestLegend) && !categorical && (
        <MapGradientLegendItem
          className="w-20 min-w-0 shrink-0 space-y-0.5 sm:w-32"
          barClassName="h-1.5 rounded border-0"
          labelClassName="gap-1 text-[9px] tabular-nums"
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
      <span className="hidden text-muted-foreground lg:inline">
        Click map to inspect height · candidates unvalidated
      </span>
    </div>
  )
}
