/**
 * The crop in Point-cloud options: a corridor round the active road, a drawn or imported area, and
 * an upslope margin. The choice is the page's for this session; the import records what it used.
 */
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { NumberField } from './Controls'
import { CROP_LIMITS } from './pointCloudCrop'
import type { PointCloudChoice } from './DesignSidebarBody'

export function PointCloudCropFields({
  pointCloud,
  onPointCloud,
  onDrawArea,
  onImportArea,
  lastCrop,
  busy,
}: {
  pointCloud: PointCloudChoice
  onPointCloud: (next: PointCloudChoice) => void
  onDrawArea?: () => void
  onImportArea: () => void
  /** What the last import's crop kept. */
  lastCrop?: string | null
  busy?: boolean
}) {
  const crop = pointCloud.crop ?? {}
  const set = (next: typeof crop) => onPointCloud({ ...pointCloud, crop: { ...crop, ...next } })
  const area = crop.areas?.length
    ? `${crop.areaName ?? 'Area'} (${crop.areas.length} ring${crop.areas.length === 1 ? '' : 's'})`
    : null
  return (
    <div className="space-y-2" data-testid="road-point-cloud-crop">
      <div className="flex items-center gap-1 text-xs font-medium">
        Crop before building the surface
        <InfoTip label="About the crop">
          Points outside the area and the road corridor are dropped before thinning, classification and gridding. The
          LAZ decoder still reads each whole tile, so a crop does not shorten the read: it only cuts what goes into
          surface building. Ground outside the crop that stands above its nearest edge is kept up to the upslope margin,
          so drainage still has the slope draining onto the road.
        </InfoTip>
      </div>
      <NumberField
        label="Crop to road corridor each side (m; 0 off)"
        value={crop.corridorM ?? 0}
        min={0}
        max={CROP_LIMITS.maxHalfWidthM}
        onChange={(corridorM) => set({ corridorM })}
      />
      <div className="flex flex-wrap items-center gap-2">
        {onDrawArea && (
          <Button variant="outline" size="sm" className="flex-1" onClick={onDrawArea} disabled={busy}>
            Draw crop area
          </Button>
        )}
        <Button variant="outline" size="sm" className="flex-1" onClick={onImportArea} disabled={busy}>
          Import crop area
        </Button>
      </div>
      {area && (
        <div className="flex items-center gap-2 text-2xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate" title={area}>
            Crop area: {area}
          </span>
          <Button variant="ghost" size="sm" onClick={() => set({ areas: undefined, areaName: undefined })}>
            Clear
          </Button>
        </div>
      )}
      <NumberField
        label="Upslope margin beyond the crop (m)"
        value={crop.upslopeMarginM ?? 0}
        min={0}
        max={CROP_LIMITS.maxUpslopeMarginM}
        onChange={(upslopeMarginM) => set({ upslopeMarginM })}
      />
      {lastCrop && <p className="text-2xs text-muted-foreground">{lastCrop}</p>}
    </div>
  )
}
