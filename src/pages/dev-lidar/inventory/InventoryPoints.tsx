import { NumericRangeField } from '@/components/ui/numeric-range-field'
import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ComparisonMap } from '../comparisons/ComparisonMap'
import { ComparisonProfile } from '../comparisons/ComparisonProfile'
import type { Basemap } from '../basemaps'
import type { TreeCrop, IsolatedPoint } from '../treeIsolation'
import { downloadText } from '@/lib/download'
import { DEFAULT_LOCALE } from '@/lib/format'
export function InventoryPoints({
  crop,
  error,
  basemap,
  neural,
  retry,
}: {
  crop: TreeCrop | null
  error: string
  basemap: Basemap
  neural: boolean
  retry: () => void
}) {
  const [angle, setAngle] = useState(0),
    [pointColour, setPointColour] = useState<'black' | 'height'>('black'),
    [picked, setPicked] = useState<IsolatedPoint | null>(null)
  if (!crop)
    return (
      <div className="space-y-2 p-3" role="status">
        <InlineAlert tone={error ? 'error' : 'info'} loading={!error}>
          {error || 'Loading original core points…'}
        </InlineAlert>
        {error && (
          <Button size="sm" onClick={retry}>
            Retry points
          </Button>
        )}
      </div>
    )
  const height = Math.max(5, ...crop.points.map((p) => p.height)),
    radius =
      Math.max(
        3,
        ...crop.points.map((p) =>
          Math.hypot(
            (p.lon - crop.centre[0]) * 111320 * Math.cos((crop.centre[1] * Math.PI) / 180),
            (p.lat - crop.centre[1]) * 111320,
          ),
        ),
      ) + 1
  return (
    <div className="flex h-full min-h-[340px] flex-col overflow-hidden border-l" aria-label="Inventory point inspector">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b p-2 text-xs">
        <h2 className="flex items-center gap-1 font-semibold">
          {neural ? 'Assigned tree points' : 'Crown-column points'}
          <InfoTip label="Which returns are shown">
            {neural
              ? 'All assigned original core returns.'
              : 'Original core returns ≥2 m inside a 2D crown; vertically overlapping trees may be included.'}{' '}
            Profiles start at ground level. Halo returns are not included.
          </InfoTip>
        </h2>
        <span className="tabular-nums text-muted-foreground">
          {crop.points.length.toLocaleString(DEFAULT_LOCALE)} returns
        </span>
        <SegmentedControl
          label="Inventory point colour"
          size="sm"
          fullWidth={false}
          value={pointColour}
          onChange={setPointColour}
          options={[
            { value: 'black', label: 'Silhouette' },
            { value: 'height', label: 'Height' },
          ]}
        />
        <NumericRangeField
          label="Rotate"
          aria-label="Inventory profile rotation"
          display={`${angle}°`}
          className="flex items-center gap-1.5 space-y-0"
          headerClassName="flex items-center gap-1.5"
          labelClassName="text-muted-foreground"
          valueClassName="w-8 text-right"
          inputClassName="h-auto w-24"
          min={0}
          max={180}
          step={5}
          value={angle}
          onChange={setAngle}
        />
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() =>
            downloadText(
              'longitude,latitude,elevation_m,height_m,original_row\n' +
                crop.points.map((p) => [p.lon, p.lat, p.z, p.height, p.index].join(',')).join('\n'),
              'inventory-tree-points.csv',
              'text/csv',
            )
          }
        >
          <Download aria-hidden="true" />
          Point CSV
        </Button>
      </div>
      <div className="min-h-[140px] flex-1">
        <ComparisonMap
          label="Inventory selected tree 3D"
          centre={crop.centre}
          focusKey={crop.id}
          zoom={Math.max(17.5, Math.min(21, 21 - Math.log2(Math.max(height, radius * 2, 8) / 8)))}
          view="3d"
          basemap={basemap}
          crop={crop}
          pointColour={pointColour}
        />
      </div>
      <div className="min-h-[140px] flex-1 border-t">
        <ComparisonProfile
          crop={crop}
          assignments={{}}
          angle={angle}
          height={Math.ceil(height / 5) * 5}
          radius={radius}
          minHeight={0}
          colour={pointColour}
          picked={picked}
          onPick={setPicked}
        />
      </div>
    </div>
  )
}
