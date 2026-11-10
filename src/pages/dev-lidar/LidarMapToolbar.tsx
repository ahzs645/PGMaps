import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import type { ReactNode } from 'react'
import { Crosshair, Eye, EyeOff } from 'lucide-react'
import { isHeatmapMode } from './canopyHeatmaps'
import type { LidarController } from './useLidarWorkspace'

/**
 * Floats over the map's top-left corner, beside GeoLibre's own control, as other map pages'
 * toolbars do. GeoLibre's button opens the native point-cloud tools, so this does not repeat it.
 */
export function LidarMapToolbar({ controller, children }: { controller: LidarController; children?: ReactNode }) {
  const {
    summary,
    setSurfaceVisible,
    go,
    cloud,
    setCloud,
    analysisOptions,
    transectControl,
    treeView,
    setTreeView,
    benchmarkPreview,
    selectedCrown,
    setFocus,
    displayedSurface,
    toggleDisplayedSurface,
  } = controller
  if (!summary) return null
  return (
    <div
      role="toolbar"
      aria-label="LiDAR map toolbar"
      className="pointer-events-auto absolute left-[3.75rem] top-[calc(var(--map-mobile-toolbar-height,0px)_+_0.625rem)] z-20 flex max-w-[calc(100%-6.5rem)] flex-wrap items-center gap-1 rounded-md border border-border bg-background/95 p-1 shadow-sm backdrop-blur md:left-12"
    >
      <SegmentedControl
        value={analysisOptions.mode === 'trees' && !transectControl.active ? treeView : cloud ? 'cloud' : 'processed'}
        options={
          analysisOptions.mode === 'trees' && !transectControl.active
            ? [
                { value: 'top', label: 'Top map' },
                { value: '3d', label: '3D points' },
              ]
            : [
                { value: 'processed', label: 'Layers' },
                { value: 'cloud', label: '3D LiDAR' },
              ]
        }
        onChange={(value) => {
          if (value === 'top' || value === '3d') {
            setTreeView(value)
            const centre = benchmarkPreview?.crop.centre ?? selectedCrown?.properties.centre
            if (centre)
              setFocus((p) => ({
                index: -1,
                revision: p.revision + 1,
                center: centre,
                zoom: value === '3d' ? 19 : 20,
              }))
            setCloud(false)
            setSurfaceVisible(false)
            return
          }
          setCloud(value === 'cloud')
          if (value === 'processed' && !isHeatmapMode(analysisOptions.mode)) setSurfaceVisible(true)
        }}
        label="Map view"
        size="sm"
        fullWidth={false}
      />
      <Button
        variant={displayedSurface ? 'secondary' : 'ghost'}
        size="icon"
        className="size-8 touch:size-9"
        title={displayedSurface ? 'Hide processed surface' : 'Show processed surface'}
        aria-label={displayedSurface ? 'Hide processed surface' : 'Show processed surface'}
        aria-pressed={displayedSurface}
        onClick={toggleDisplayedSurface}
      >
        {displayedSurface ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 touch:size-9"
        title="Fit whole tile"
        aria-label="Fit whole tile"
        onClick={() => go(-1)}
      >
        <Crosshair className="size-4" />
      </Button>
      {children}
    </div>
  )
}
