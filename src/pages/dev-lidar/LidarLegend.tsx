import { ANALYSIS_MODES } from './analysisWorkflows'
import { isSpeciesMode, SPECIES_COLOURS, speciesLegend } from './species'
import type { LidarController } from './useLidarWorkspace'

export function LidarLegend({ controller }: { controller: LidarController }) {
  const { summary, basemap, surfaceVisible, raster, analysisOptions, forestLegend, legend, workflowProducts } =
    controller
  if (!summary) return null
  return (
    <>
      {legend && (
        <div
          className="flex shrink-0 items-center gap-3 border-t px-3 py-2 text-[10px]"
          aria-label="Processed surface legend"
        >
          <span className="min-w-0 flex-1 truncate font-medium" title={forestLegend?.label ?? legend.title}>
            {forestLegend
              ? forestLegend.label
              : analysisOptions.mode
                ? ANALYSIS_MODES.find((item) => item.id === analysisOptions.mode)?.note
                : surfaceVisible
                  ? legend.title
                  : `${basemap === 'vector' ? 'Vector context' : basemap === 'satellite' ? 'Satellite context' : 'Basemap hidden'} · surface hidden`}
          </span>
          {isSpeciesMode(analysisOptions.mode) && speciesLegend(analysisOptions).categorical && (
            <div
              className="flex max-w-[65%] shrink items-center gap-2 overflow-x-auto"
              aria-label="Species colour legend"
            >
              {Object.entries(SPECIES_COLOURS).map(([code, colour]) => (
                <span
                  key={code}
                  className="flex shrink-0 items-center gap-1"
                  title={workflowProducts.data?.species.species[code]}
                >
                  <i className="size-2.5 rounded-sm" style={{ backgroundColor: colour }} />
                  {code}
                </span>
              ))}
              <span className="flex shrink-0 items-center gap-1">
                <i className="size-2.5 rounded-sm bg-slate-400" />
                Unknown
              </span>
            </div>
          )}
          {(surfaceVisible || forestLegend) &&
            !(isSpeciesMode(analysisOptions.mode) && speciesLegend(analysisOptions).categorical) && (
              <div className="w-20 shrink-0 sm:w-32">
                <div
                  className="h-1.5 rounded"
                  style={{
                    background: `linear-gradient(to right, ${(forestLegend?.colors ?? legend.colors).join(',')})`,
                  }}
                />
                <div className="mt-0.5 flex justify-between text-[9px] tabular-nums text-muted-foreground">
                  {forestLegend ? (
                    <>
                      <span>{forestLegend.min}</span>
                      <span>
                        {forestLegend.max}
                        {isSpeciesMode(analysisOptions.mode)
                          ? speciesLegend(analysisOptions).unit
                          : analysisOptions.mode === 'texture' || analysisOptions.mode === 'canopy-height'
                            ? ' m'
                            : analysisOptions.mode === 'edges' || analysisOptions.mode === 'canopy-density'
                              ? '%'
                              : ''}
                      </span>
                    </>
                  ) : raster === 'crowns' ? (
                    <span>Categorical regions</span>
                  ) : (
                    <>
                      <span>{legend.min.toFixed(0)}</span>
                      <span>
                        {legend.max.toFixed(0)} {legend.unit}
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}
          <span className="hidden text-muted-foreground lg:inline">
            Click map to inspect height · candidates unvalidated
          </span>
        </div>
      )}
    </>
  )
}
