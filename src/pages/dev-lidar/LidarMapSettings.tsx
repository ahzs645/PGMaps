import { Button } from '@/components/ui/button'
import { SidebarSection } from '@/components/ui/map-panels'
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
      <SidebarSection title="Map comparison" className="p-3">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={surfaceVisible}
            onChange={(event) => setSurfaceVisible(event.target.checked)}
          />
          Show processed surface
        </label>
        <label className="mt-3 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={labels}
            onChange={(event) => setLabels(event.target.checked)}
            disabled={basemap === 'none'}
          />
          Basemap labels
        </label>
        <label className="mt-3 block text-xs">
          Surface opacity · {Math.round(surfaceOpacity * 100)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={surfaceOpacity}
            onChange={(event) => setSurfaceOpacity(Number(event.target.value))}
            className="mt-2 w-full"
          />
        </label>
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          {basemap === 'vector'
            ? 'OpenFreeMap vector roads, buildings and labels. OSM footprints are context, not verified building truth.'
            : basemap === 'satellite'
              ? 'Esri satellite/aerial imagery. Hide the surface to see imagery beneath candidate features.'
              : 'Basemap geometry and labels are hidden to isolate the measured data.'}{' '}
          The eye button toggles the surface without hiding candidates.
        </p>
        {basemap === 'satellite' && <ImageryProvenance bounds={summary.bounds_wgs84} />}
      </SidebarSection>
      <SidebarSection title="Surface layers" className="p-3">
        <div className="space-y-1">
          {(Object.entries(summary.rasters) as [RasterKey, AnalysisSummary['rasters'][RasterKey]][])
            .filter(([key]) => key !== 'crowns' || tool?.id === 'trees')
            .map(([key, layer]) => (
              <label
                key={key}
                className={`flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-xs ${raster === key ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' : 'hover:bg-muted'}`}
              >
                <input type="radio" name="surface" checked={raster === key} onChange={() => selectRaster(key)} />
                {layer.title}
              </label>
            ))}
        </div>
      </SidebarSection>
      {tool?.id !== 'transects' && (
        <SidebarSection title="Candidate overlays" className="p-3">
          <div className="space-y-3 text-xs">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={trees} onChange={(e) => setTrees(e.target.checked)} />
              Dominant crown candidates
            </label>
            {(tool?.id === 'buildings' || tool?.id === 'forestry') && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={buildings} onChange={(e) => setBuildings(e.target.checked)} />
                Roof-like planar patches
              </label>
            )}
            {tool?.id === 'trees' && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={reference} onChange={(e) => setReference(e.target.checked)} />
                GeoLibre tree test · 1 ha (pink)
              </label>
            )}
            <label className="block text-muted-foreground">
              Show crown candidates ≥ {minTreeHeight} m
              <input
                className="mt-2 w-full"
                type="range"
                min={5}
                max={40}
                step={1}
                value={minTreeHeight}
                onChange={(e) => setMinTreeHeight(Number(e.target.value))}
              />
            </label>
            <p className="text-[10px] leading-4 text-muted-foreground">
              Filters displayed candidates; detection is not rerun. Green markers are crowns; amber outlines are
              roof-like patches.
            </p>
          </div>
        </SidebarSection>
      )}
      <SidebarSection title="GeoLibre point cloud" className="p-3">
        <label className="block text-xs">
          Point colour
          <select
            value={color}
            onChange={(e) => setColor(e.target.value as ColorSchemeType)}
            className="mt-1 w-full rounded border bg-background p-2"
          >
            <option value="elevation">Absolute elevation</option>
            <option value="intensity">Intensity</option>
            <option value="classification">Source classification</option>
          </select>
        </label>
        <Button className="mt-2 h-8 w-full text-xs" variant="outline" onClick={openTools}>
          Open native LiDAR tools
        </Button>
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          84.6 million source points; display budget 750,000. Drag to pan; right-drag to orbit. Native point size,
          colour and inspection tools open on demand.
        </p>
      </SidebarSection>
      <SidebarSection title="Explore key places" className="p-3">
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
