import { LegendItem, MapGradientLegendItem, MapLegendPanel, MapSwatch } from '@/components/ui/map-panels'
import { ANALYSIS_MODES, type WorkflowOptions } from './analysisWorkflows'
import { MESH_COLOURS, meshCss } from './buildingMesh'
import { CLEARANCE_COLOUR, GAP_COLOURS, PLOT_P95_RAMP } from './workflowMapLayers'
import { isSpeciesMode, SPECIES_COLOURS, speciesLegend } from './species'
import type { LidarController } from './useLidarWorkspace'

/** The map's legend, floating in its bottom-right corner like every other map page's. */
export function LidarLegend({ controller, className }: { controller: LidarController; className?: string }) {
  const {
    summary,
    basemap,
    surfaceVisible,
    raster,
    analysisOptions,
    forestLegend,
    legend,
    workflowProducts,
    workflowRows,
  } = controller
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
  const rows = workflowLegendRows(analysisOptions, workflowRows.length)
  const description = rows
    ? undefined
    : !forestLegend && analysisOptions.mode
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
      width={rows ? 'md' : 'sm'}
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
      {rows}
      {!rows && (surfaceVisible || forestLegend) && !categorical && (
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
    </MapLegendPanel>
  )
}

/** Coloured rows for the workflow layers drawn in one colour or ramp; null for every other mode. */
function workflowLegendRows(options: WorkflowOptions, shown: number) {
  const count = shown.toLocaleString()
  if (options.mode === 'gaps')
    return (
      <LegendItem
        color={GAP_COLOURS.fill}
        swatchShape="square"
        swatch={
          <MapSwatch
            color={GAP_COLOURS.fill}
            style={{ boxShadow: `inset 0 0 0 1px ${GAP_COLOURS.outline}` }}
            aria-hidden="true"
          />
        }
        label={`${options.enclosed ? 'Enclosed gaps' : 'Gaps'} < ${options.threshold} m`}
        value={count}
      />
    )
  if (options.mode === 'plots')
    return (
      <MapGradientLegendItem
        colors={PLOT_P95_RAMP.map(([, colour]) => colour)}
        ticks={PLOT_P95_RAMP.map(([height], index) =>
          index === PLOT_P95_RAMP.length - 1 ? `${height} m P95` : String(height),
        )}
      />
    )
  if (options.mode === 'clearance')
    return (
      <LegendItem
        color={CLEARANCE_COLOUR}
        swatchShape="line"
        label={`Vegetation ≤ ${options.clearance} m from roof`}
        value={count}
      />
    )
  if (options.mode === 'models')
    return (
      <div className="space-y-0.5">
        <LegendItem color={meshCss(MESH_COLOURS.roof)} swatchShape="square" label="Roofs" />
        <LegendItem color={meshCss(MESH_COLOURS.wall)} swatchShape="square" label="Walls" />
      </div>
    )
  return null
}
