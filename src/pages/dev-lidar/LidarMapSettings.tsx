import { SelectField } from '@/components/ui/form-field'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
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
      <SidebarSection
        title="Map context"
        actions={
          <InfoTip label="About the map context">
            {basemap === 'vector'
              ? 'OpenFreeMap vector roads, buildings and labels. OSM footprints are context, not verified building truth.'
              : basemap === 'satellite'
                ? 'Esri satellite/aerial imagery. Hide the surface with the eye button on the map to see imagery beneath candidate features.'
                : 'Basemap geometry and labels are hidden to isolate the measured data.'}{' '}
            Change the basemap in the picker at the top of this panel.
          </InfoTip>
        }
      >
        <div className="space-y-2">
          <ToggleRow
            active={labels}
            label="Basemap labels"
            onClick={() => setLabels(!labels)}
            disabled={basemap === 'none'}
          />
          <ToggleRow active={hillshade} label="Regional hillshade" onClick={() => setHillshade(!hillshade)} />
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
        </div>
        {basemap === 'satellite' && <ImageryProvenance bounds={summary.bounds_wgs84} />}
      </SidebarSection>
      <SidebarSection
        title="Processed surface"
        actions={
          <InfoTip label="About the processed surfaces">
            Choose which surface the map draws. The eye button on the map shows or hides it without hiding candidates.
          </InfoTip>
        }
      >
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
        <SidebarSection
          title="Candidate overlays"
          actions={
            <InfoTip label="About candidate overlays">
              The height filter changes which candidates are drawn; detection is not rerun. Green markers are crowns;
              amber outlines are roof-like patches.
            </InfoTip>
          }
        >
          <div className="space-y-2">
            <ToggleRow
              active={trees}
              tone="emerald"
              label="Dominant crown candidates"
              onClick={() => setTrees(!trees)}
            />
            {(tool?.id === 'buildings' || tool?.id === 'forestry') && (
              <ToggleRow
                active={buildings}
                tone="amber"
                label="Roof-like planar patches"
                onClick={() => setBuildings(!buildings)}
              />
            )}
            {tool?.id === 'trees' && (
              <ToggleRow
                active={reference}
                tone="rose"
                label="GeoLibre tree test · 1 ha"
                onClick={() => setReference(!reference)}
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
          </div>
        </SidebarSection>
      )}
      <SidebarSection
        title="GeoLibre point cloud"
        actions={
          <InfoTip label="About the point cloud">
            84.6 million source points with a display budget of 750,000. Drag to pan; right-drag to orbit. Point size,
            colour and inspection tools are in GeoLibre's panel, which also opens from its button on the map.
          </InfoTip>
        }
      >
        <SelectField label="Point colour" value={color} onChange={(e) => setColor(e.target.value as ColorSchemeType)}>
          <option value="elevation">Absolute elevation</option>
          <option value="intensity">Intensity</option>
          <option value="classification">Source classification</option>
        </SelectField>
        <Button className="mt-2 w-full" size="sm" variant="outline" onClick={openTools}>
          Show 3D points and GeoLibre tools
        </Button>
      </SidebarSection>
      <SidebarSection
        title="Jump to a place"
        actions={
          <InfoTip label="About these places">The crosshair button on the map returns to the whole tile.</InfoTip>
        }
      >
        <div className="flex flex-wrap gap-2">
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
