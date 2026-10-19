import { SidebarSection } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { isHeatmapMode, heatmapKey, heatmapLegend, type CanopyHeatmaps } from './canopyHeatmaps'
import type { AnalysisMode, WorkflowOptions } from './analysisWorkflows'
export function CanopyHeatmapPanel({
  data,
  options,
  onOptions,
  onMode,
}: {
  data: CanopyHeatmaps
  options: WorkflowOptions
  onOptions: (options: Partial<WorkflowOptions>) => void
  onMode: (mode: AnalysisMode) => void
}) {
  if (!isHeatmapMode(options.mode)) return null
  const height = options.mode === 'canopy-height',
    legend = heatmapLegend(options),
    raster = data.rasters[heatmapKey(options)]
  return (
    <>
      <SidebarSection title="Canopy heatmaps" subtitle="Cool colours: low · warm colours: high">
        <SegmentedControl
          value={options.mode}
          options={[
            { value: 'canopy-height', label: 'Height' },
            { value: 'canopy-density', label: 'Density' },
          ]}
          onChange={onMode}
          label="Canopy heatmap metric"
          size="sm"
        />
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          {height
            ? 'Height above terrain from the measured surface. Blue/purple is lower canopy; yellow/red is taller canopy. Heights above 40 m use the top colour.'
            : 'Density here means canopy cover: the share of eligible area above the chosen height in a 21 × 21 m square. It is not trees per hectare or LiDAR point density.'}
        </p>
        {height && (
          <label className="mt-3 flex gap-2 text-xs">
            <input
              type="checkbox"
              checked={options.heightDetail}
              onChange={(e) => onOptions({ heightDetail: e.target.checked })}
            />
            Automatic 1 m detail when zoomed in
          </label>
        )}
        {height && (
          <p className="mt-2 text-[10px] text-muted-foreground">
            At zoom 16+, load the original 1 m grid. The map status confirms the active resolution. Zooming farther
            cannot reveal features smaller than the source cells.
          </p>
        )}
        {!height && (
          <label className="mt-3 block text-xs">
            Canopy height threshold
            <select
              aria-label="Canopy density threshold"
              className="mt-1 w-full rounded border bg-background p-2"
              value={options.threshold}
              onChange={(e) => onOptions({ threshold: Number(e.target.value) as 2 | 5 })}
            >
              <option value={2}>Above 2 m · lower vegetation included</option>
              <option value={5}>Above 5 m · taller canopy</option>
            </select>
          </label>
        )}
        <label className="mt-3 block text-xs">
          Heatmap opacity · {Math.round(options.heatOpacity * 100)}%
          <input
            aria-label="Canopy heatmap opacity"
            type="range"
            className="mt-2 w-full"
            min={0}
            max={1}
            step={0.05}
            value={options.heatOpacity}
            onChange={(e) => onOptions({ heatOpacity: Number(e.target.value) })}
          />
        </label>
        <div className="mt-3" aria-label="Canopy heatmap colour legend">
          <div className="h-3 rounded" style={{ background: `linear-gradient(to right,${legend.colors.join(',')})` }} />
          <div className="mt-1 flex justify-between text-[10px] tabular-nums">
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <span key={f}>
                {f * legend.max}
                {f === 1 && height ? '+' : ''} {legend.unit}
              </span>
            ))}
          </div>
        </div>
        <p className="mt-3 text-[10px] leading-4 text-muted-foreground">
          Click the map for an approximate heatmap value. Change Vector / Satellite above to compare context. The legend
          remains below the map when this panel is closed.
        </p>
      </SidebarSection>
      <SidebarSection title="Data coverage">
        <p className="text-xs leading-5 text-muted-foreground">
          Known roof patches plus 2 m and unsupported terrain are excluded.{' '}
          {height
            ? 'Heights remain an elevated-surface canopy proxy; unrecognized structures may remain.'
            : 'A neighbourhood needs at least 80% eligible area. The percentage divides by that eligible area; missing cells never count as open canopy.'}{' '}
          Transparent cells have no supported value.
        </p>
        <a
          href={raster.png_data_url}
          download={`canopy-${heatmapKey(options)}.png`}
          className="mt-3 inline-block text-xs underline"
        >
          Download coloured PNG
        </a>
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          This download is the overview PNG (about 3.5 m display cells). The height map switches to 1 m source detail
          when zoomed in; its click values come from the source grid. Density remains the 21 m neighbourhood product.
        </p>
      </SidebarSection>
    </>
  )
}
