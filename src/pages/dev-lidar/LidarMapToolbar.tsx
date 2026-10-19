import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Crosshair, Eye, EyeOff, Settings2 } from 'lucide-react'
import { isHeatmapMode } from './canopyHeatmaps'
import type { LidarController } from './useLidarWorkspace'

export function LidarMapToolbar({ controller }: { controller: LidarController }) {
  const {
    summary,
    setSurfaceVisible,
    openTools,
    go,
    cloud,
    setCloud,
    toolsOpen,
    setToolsOpen,
    analysisOptions,
    transectControl,
    treeView,
    setTreeView,
    benchmarkPreview,
    selectedCrown,
    setFocus,
    displayedSurface,
    toggleDisplayedSurface,
    inspectorWidth,
    setInspectorWidth,
  } = controller
  if (!summary) return null
  return (
    <>
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
        label="Map display"
        size="sm"
        fullWidth={false}
      />
      <Button
        variant={displayedSurface ? 'secondary' : 'ghost'}
        size="icon"
        className="size-8"
        title={displayedSurface ? 'Hide processed surface' : 'Show processed surface'}
        aria-label={displayedSurface ? 'Hide processed surface' : 'Show processed surface'}
        aria-pressed={displayedSurface}
        onClick={toggleDisplayedSurface}
      >
        {displayedSurface ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
      </Button>
      <Button
        variant={toolsOpen && cloud ? 'secondary' : 'ghost'}
        size="icon"
        className="size-8"
        title="Native GeoLibre LiDAR tools"
        aria-label="Native GeoLibre LiDAR tools"
        aria-pressed={toolsOpen && cloud}
        onClick={() => {
          if (toolsOpen && cloud) setToolsOpen(false)
          else openTools()
        }}
      >
        <Settings2 className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        title="Fit whole tile"
        aria-label="Fit whole tile"
        onClick={() => go(-1)}
      >
        <Crosshair className="size-4" />
      </Button>
      {analysisOptions.mode === 'trees' && (
        <label className="hidden items-center gap-1 text-[10px] lg:flex">
          Inspector width
          <input
            aria-label="Inspector pane width"
            className="w-20"
            type="range"
            min={32}
            max={65}
            step={1}
            value={inspectorWidth}
            onChange={(e) => setInspectorWidth(+e.target.value)}
          />
        </label>
      )}
    </>
  )
}
