import { CheckboxField, SelectField } from '@/components/ui/form-field'
import { MapGradientLegendItem, SidebarSection } from '@/components/ui/map-panels'
import { NumericRangeField } from '@/components/ui/numeric-range-field'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { InfoTip } from '@/components/ui/info-tip'
import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'
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
      <SidebarSection
        title="Canopy heatmaps"
        subtitle="Cool colours: low · warm colours: high"
        actions={
          <InfoTip label="About this heatmap">
            {height
              ? 'Height above terrain from the measured surface. Blue/purple is lower canopy; yellow/red is taller canopy. Heights above 40 m use the top colour.'
              : 'Density here means canopy cover: the share of eligible area above the chosen height in a 21 × 21 m square. It is not trees per hectare or LiDAR point density.'}{' '}
            Click the map for an approximate value.
          </InfoTip>
        }
      >
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
        {height && (
          <CheckboxField
            className="mt-3"
            label="Automatic 1 m detail when zoomed in"
            checked={options.heightDetail}
            onCheckedChange={(heightDetail) => onOptions({ heightDetail })}
            description="From zoom 16 the map loads the original 1 m grid; the map status names the resolution in use."
          />
        )}
        {!height && (
          <SelectField
            aria-label="Canopy density threshold"
            label="Canopy height threshold"
            fieldClassName="mt-3"
            value={options.threshold}
            onChange={(e) => onOptions({ threshold: Number(e.target.value) as 2 | 5 })}
          >
            <option value={2}>Above 2 m · lower vegetation included</option>
            <option value={5}>Above 5 m · taller canopy</option>
          </SelectField>
        )}
        <NumericRangeField
          className="mt-3 text-xs"
          label="Heatmap opacity"
          aria-label="Canopy heatmap opacity"
          min={0}
          max={1}
          step={0.05}
          value={options.heatOpacity}
          display={`${Math.round(options.heatOpacity * 100)}%`}
          onChange={(heatOpacity) => onOptions({ heatOpacity })}
        />
        <MapGradientLegendItem
          className="mt-3"
          aria-label="Canopy heatmap colour legend"
          barClassName="h-3 rounded border-0"
          labelClassName="gap-1 text-3xs tabular-nums text-foreground"
          colors={legend.colors}
          ticks={[0, 0.25, 0.5, 0.75, 1].map((f) => `${f * legend.max}${f === 1 && height ? '+' : ''} ${legend.unit}`)}
        />
      </SidebarSection>
      <SidebarSection
        title="Data coverage"
        subtitle="Transparent cells have no supported value."
        actions={
          <InfoTip label="About data coverage">
            Known roof patches plus 2 m and unsupported terrain are excluded.{' '}
            {height
              ? 'Heights remain an elevated-surface canopy proxy; unrecognized structures may remain.'
              : 'A neighbourhood needs at least 80% eligible area. The percentage divides by that eligible area; missing cells never count as open canopy.'}{' '}
            The download is the overview PNG (about 3.5 m display cells). The height map switches to 1 m source detail
            when zoomed in, and its click values come from the source grid. Density remains the 21 m neighbourhood
            product.
          </InfoTip>
        }
      >
        <Button asChild size="sm" variant="outline">
          <a href={raster.png_data_url} download={`canopy-${heatmapKey(options)}.png`}>
            <Download className="size-3.5" aria-hidden="true" />
            Download coloured PNG
          </a>
        </Button>
      </SidebarSection>
    </>
  )
}
