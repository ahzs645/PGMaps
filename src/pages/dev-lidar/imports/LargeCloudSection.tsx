import { InfoTip } from '@/components/ui/info-tip'
import { SidebarSection } from '@/components/ui/map-panels'
import { Button } from '@/components/ui/button'
import { DEFAULT_LOCALE } from '@/lib/format'
import { projectedViewBox, type MapView } from './coordinates'
import { DETAIL_POINTS, clipBox, estimateArea, type LargeLazPlan, type NativeBox } from './largeLaz'

export interface LargeCloud {
  file: File
  plan: LargeLazPlan
  stride: number
  overview: File
  overviewPoints: number
  detail: { points: number; hectares: number; thinned: number | null } | null
}

const n = (value: number) => value.toLocaleString(DEFAULT_LOCALE)
const megabytes = (bytes: number) => (bytes / 1024 ** 2).toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 0 })

/** Where the next full-detail read would land, and whether it fits. */
function detailTarget(plan: LargeLazPlan, view: MapView | null) {
  if (!plan.epsg) return { box: null, note: "This file's CRS has no EPSG code, so the map view can't be placed in it." }
  if (!view) return { box: null, note: 'Waiting for the map.' }
  let box: NativeBox | null
  try {
    box = clipBox(plan, projectedViewBox(view, 'EPSG:' + plan.epsg))
  } catch {
    box = null
  }
  if (!box) return { box: null, note: 'Move the map over the point cloud.' }
  const estimate = estimateArea(plan, box)
  const hectares = ((box[2] - box[0]) * (box[3] - box[1])) / 10_000
  const area = `${hectares.toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 1 })} ha`
  if (estimate > DETAIL_POINTS * 2)
    return {
      box: null,
      note: `This view holds about ${n(estimate)} points over ${area}. Zoom in to under ${n(DETAIL_POINTS)}.`,
    }
  return { box, note: `This view holds about ${n(estimate)} points over ${area}.` }
}

export function LargeCloudSection({
  cloud,
  view,
  busy,
  onDetail,
  onOverview,
}: {
  cloud: LargeCloud
  view: MapView | null
  busy: boolean
  onDetail: (box: NativeBox) => void
  onOverview: () => void
}) {
  const { plan, detail } = cloud
  const target = detailTarget(plan, view)
  return (
    <SidebarSection
      title="Large point cloud"
      subtitle={cloud.file.name}
      actions={
        <InfoTip label="About large point clouds">
          This file is too large to load whole, so it is read in its own compressed chunks, a few at a time, and never
          held in memory at once. The overview keeps one point in {n(cloud.stride)}, spread over the whole file. Full
          detail reads the file again and keeps every point in the area the map shows, up to {n(DETAIL_POINTS)} points;
          a larger area is thinned evenly. Each read takes about as long as the first.
        </InfoTip>
      }
    >
      <p className="text-xs text-muted-foreground">
        {n(plan.header.points)} points · {n(plan.chunks.length)} chunks · {megabytes(cloud.file.size)} MB
      </p>
      <p className="mt-1 text-xs">
        {detail
          ? `Showing full detail: ${n(detail.points)} points over ${detail.hectares.toFixed(1)} ha${detail.thinned ? `, thinned from ${n(detail.thinned)}` : ''}.`
          : `Showing the overview: ${n(cloud.overviewPoints)} points, one in ${n(cloud.stride)}.`}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !target.box}
          onClick={() => target.box && onDetail(target.box)}
        >
          Full detail for this view
        </Button>
        {detail && (
          <Button size="sm" variant="outline" disabled={busy} onClick={onOverview}>
            Whole-file overview
          </Button>
        )}
      </div>
      <p className="mt-1 text-2xs text-muted-foreground">{target.note}</p>
    </SidebarSection>
  )
}
