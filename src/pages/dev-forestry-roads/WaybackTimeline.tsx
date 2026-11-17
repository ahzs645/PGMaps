import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { MapTimeline } from '@pgmaps/geo-toolkit/ui/map-timeline'
import { InlineAlert } from '@pgmaps/geo-toolkit/ui/map-panels'
import { Button } from '@/components/ui/button'
import { loadWaybackReleases, type WaybackRelease } from '@/lib/wayback'
import { isLocalPlane } from './localPlane'
import type { TerrainMetadata } from './types'

const ROAD_WAYBACK_ENABLED = (import.meta.env.VITE_ROAD_WAYBACK_TIMELINE ?? 'true') === 'true'

export function waybackTimelineAvailable(terrain: Pick<TerrainMetadata, 'epsg'>) {
  return ROAD_WAYBACK_ENABLED && !isLocalPlane(terrain)
}

const playbackSpeeds = [{ intervalMs: 2000, label: '1×' }]

export function useWaybackTimeline(active: boolean) {
  const [releases, setReleases] = useState<WaybackRelease[]>([])
  const [frame, setFrame] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!active || releases.length || error) return
    const controller = new AbortController()
    loadWaybackReleases(controller.signal).then(
      (newestFirst) => {
        if (controller.signal.aborted) return
        setFrame(newestFirst.length - 1)
        setReleases(newestFirst.reverse())
      },
      (reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load releases.')
      },
    )
    return () => controller.abort()
  }, [active, releases.length, error])

  const buckets = useMemo(
    () =>
      releases.map(({ id, date }, i) => {
        const year = date.slice(0, 4)
        const periodStart = year !== releases[i - 1]?.date.slice(0, 4)
        const day = new Date(date)
        return {
          key: id,
          label: date,
          tickLabel: periodStart ? year : date.slice(5),
          periodStart,
          start: day,
          end: day,
        }
      }),
    [releases],
  )

  return {
    release: releases[frame],
    frame,
    setFrame,
    buckets,
    error,
    retry: () => setError(''),
  }
}

export function WaybackTimeline({
  timeline,
  onClose,
}: {
  timeline: ReturnType<typeof useWaybackTimeline>
  onClose: () => void
}) {
  return (
    <section data-map-export-ignore aria-label="Historical imagery timeline" className="min-w-0 shrink-0">
      {timeline.release ? (
        <MapTimeline
          placement="inline"
          label="Esri Wayback mosaic release date"
          summary="Esri Wayback · mosaic release date. Local imagery may be older."
          buckets={timeline.buckets}
          value={timeline.frame}
          onValueChange={timeline.setFrame}
          speeds={playbackSpeeds}
          loop={false}
          onClose={onClose}
        />
      ) : (
        <div className="flex items-center gap-2">
          <InlineAlert tone={timeline.error ? 'error' : 'info'} loading={!timeline.error} className="min-w-0 flex-1">
            {timeline.error || 'Loading Wayback releases…'}
          </InlineAlert>
          {timeline.error && (
            <Button size="sm" variant="outline" onClick={timeline.retry}>
              Retry catalog
            </Button>
          )}
          <Button size="icon-2xs" variant="ghost" aria-label="Close timeline" onClick={onClose}>
            <X />
          </Button>
        </div>
      )}
    </section>
  )
}
