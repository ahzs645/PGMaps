import { CheckboxField, SelectField } from '@/components/ui/form-field'
import { Button } from '@/components/ui/button'
import { SidebarSection } from '@/components/ui/map-panels'
import { NumericRangeField } from '@/components/ui/numeric-range-field'
import { ToggleRow } from '@/components/ui/toggle-row'
import type { ColorSchemeType } from 'maplibre-gl-lidar'
import { ImageryProvenance } from './ImageryProvenance'
import type { AnalysisSummary, RasterKey } from './types'
import type { LidarController } from './useLidarWorkspace'

export function LidarMapSettings({ controller }: { controller: LidarController }) {
  const {
    summary,
    tool,
    basemap,
    labels,
    setLabels,
    hillshade,
    setHillshade,
    surfaceVisible,
    setSurfaceVisible,
    surfaceOpacity,
    setSurfaceOpacity,
    raster,
    selectRaster,
    trees,
    setTrees,
    buildings,
    setBuildings,
    reference,
    setReference,
    minTreeHeight,
    setMinTreeHeight,
    color,
    setColor,
    openTools,
    go,
  } = controller
  if (!summary) return null
  return (
    <>
      <SidebarSection title="Map comparison">
        <div className="space-y-3">
          <CheckboxField label="Show processed surface" checked={surfaceVisible} onCheckedChange={setSurfaceVisible} />
          <CheckboxField
            label="Basemap labels"
            checked={labels}
            onCheckedChange={setLabels}
            disabled={basemap === 'none'}
          />
          <CheckboxField label="Regional hillshade" checked={hillshade} onCheckedChange={setHillshade} />
          <NumericRangeField
            className="text-xs"
            label="Surface opacity"
            min={0}
            max={1}
            step={0.05}
            value={surfaceOpacity}
            display={`${Math.round(surfaceOpacity * 100)}%`}
            onChange={setSurfaceOpacity}
          />
          <p className="text-3xs leading-4 text-muted-foreground">
            {basemap === 'vector'
              ? 'OpenFreeMap vector roads, buildings and labels. OSM footprints are context, not verified building truth.'
              : basemap === 'satellite'
                ? 'Esri satellite/aerial imagery. Hide the surface to see imagery beneath candidate features.'
                : 'Basemap geometry and labels are hidden to isolate the measured data.'}{' '}
            The eye button toggles the surface without hiding candidates.
          </p>
        </div>
        {basemap === 'satellite' && <ImageryProvenance bounds={summary.bounds_wgs84} />}
      </SidebarSection>
      <SidebarSection title="Surface layers">
        <div className="space-y-1" role="group" aria-label="Processed surface">
          {(Object.entries(summary.rasters) as [RasterKey, AnalysisSummary['rasters'][RasterKey]][])
            .filter(([key]) => key !== 'crowns' || tool?.id === 'trees')
            .map(([key, layer]) => (
              <ToggleRow
                key={key}
                active={raster === key}
                tone="emerald"
                label={layer.title}
                onClick={() => selectRaster(key)}
              />
            ))}
        </div>
      </SidebarSection>
      {tool?.id !== 'transects' && (
        <SidebarSection title="Candidate overlays">
          <div className="space-y-3">
            <CheckboxField label="Dominant crown candidates" checked={trees} onCheckedChange={setTrees} />
            {(tool?.id === 'buildings' || tool?.id === 'forestry') && (
              <CheckboxField label="Roof-like planar patches" checked={buildings} onCheckedChange={setBuildings} />
            )}
            {tool?.id === 'trees' && (
              <CheckboxField
                label="GeoLibre tree test · 1 ha (pink)"
                checked={reference}
                onCheckedChange={setReference}
              />
            )}
            <NumericRangeField
              className="text-xs"
              label="Show crown candidates ≥"
              unit="m"
              min={5}
              max={40}
              step={1}
              value={minTreeHeight}
              onChange={setMinTreeHeight}
            />
            <p className="text-3xs leading-4 text-muted-foreground">
              Filters displayed candidates; detection is not rerun. Green markers are crowns; amber outlines are
              roof-like patches.
            </p>
          </div>
        </SidebarSection>
      )}
      <SidebarSection title="GeoLibre point cloud">
        <SelectField label="Point colour" value={color} onChange={(e) => setColor(e.target.value as ColorSchemeType)}>
          <option value="elevation">Absolute elevation</option>
          <option value="intensity">Intensity</option>
          <option value="classification">Source classification</option>
        </SelectField>
        <Button className="mt-2 h-8 w-full text-xs" variant="outline" onClick={openTools}>
          Open native LiDAR tools
        </Button>
        <p className="mt-2 text-3xs leading-4 text-muted-foreground">
          84.6 million source points; display budget 750,000. Drag to pan; right-drag to orbit. Native point size,
          colour and inspection tools open on demand.
        </p>
      </SidebarSection>
      <SidebarSection title="Explore key places">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => go(-1)}>
            Whole tile
          </Button>
          {summary.highlights.map((place, i) => (
            <Button key={place.label} variant="outline" size="sm" onClick={() => go(i)} title={place.note}>
              {place.label}
            </Button>
          ))}
        </div>
      </SidebarSection>
    </>
  )
}
