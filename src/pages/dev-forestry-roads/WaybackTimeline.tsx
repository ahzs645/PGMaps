import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { PlaybackControls } from '@pgmaps/geo-toolkit/ui/playback-controls'
import { Button } from '@/components/ui/button'
import { loadWaybackReleases, type WaybackRelease } from '@/lib/wayback'

export const ROAD_WAYBACK_ENABLED = import.meta.env.VITE_ROAD_WAYBACK_TIMELINE === 'true'

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

  return {
    release: releases[frame],
    frame,
    setFrame,
    count: releases.length,
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
  const [playing, setPlaying] = useState(false)
  return (
    <section
      data-map-export-ignore
      aria-label="Historical imagery timeline"
      className="w-80 max-w-full overflow-y-auto rounded-lg border bg-background/95 p-2 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold">Esri Wayback releases</h3>
        <Button size="icon-2xs" variant="ghost" aria-label="Close imagery timeline" onClick={onClose}>
          <X />
        </Button>
      </div>
      {timeline.error ? (
        <div className="text-xs">
          <span role="alert">{timeline.error}</span>{' '}
          <Button size="sm" variant="outline" onClick={timeline.retry}>
            Retry catalog
          </Button>
        </div>
      ) : timeline.release ? (
        <>
          <PlaybackControls
            frame={timeline.frame}
            frameCount={timeline.count}
            onFrameChange={timeline.setFrame}
            frameLabel={timeline.release.date}
            playing={playing}
            onPlayingChange={setPlaying}
            intervalMs={2000}
            loop={false}
            label="Wayback timeline"
          />
          <p className="mt-1 text-2xs text-muted-foreground">Mosaic release date. Local imagery may be older.</p>
        </>
      ) : (
        <p role="status" className="text-xs">
          Loading Wayback releases…
        </p>
      )}
    </section>
  )
}
