import { useEffect, useRef, useState } from 'react'

/** Full-bleed cover reusable with any authored media and byline. */
export function StoryCover({
  title,
  summary,
  byline,
  video,
  poster,
}: {
  title: string
  summary?: string
  byline?: string
  video?: string
  poster?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const host = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(true)
  const [playing, setPlaying] = useState(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (playing && visible)
      void videoRef.current?.play().catch((error) => {
        // Scrolling away can pause an outstanding play request. Preserve the
        // reader's preference so returning to the cover can resume playback.
        if (error.name !== 'AbortError') setPlaying(false)
      })
    else videoRef.current?.pause()
  }, [playing, visible])
  useEffect(() => {
    if (!host.current) return
    let onScreen = true
    const update = () => setVisible(onScreen && !document.hidden)
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting
      update()
    })
    observer.observe(host.current)
    document.addEventListener('visibilitychange', update)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  return (
    <section ref={host} className="editorial-cover" data-testid="editorial-cover">
      {video ? (
        <video ref={videoRef} src={video} poster={poster} muted loop playsInline preload="metadata" />
      ) : poster ? (
        <img src={poster} alt="" />
      ) : null}
      <div className="editorial-cover-shade" />
      <div className="editorial-cover-copy">
        <h1>{title}</h1>
        <p>{summary}</p>
        <div className="editorial-byline">{byline}</div>
      </div>
      {video && (
        <button
          type="button"
          className="editorial-video-toggle"
          onClick={() => setPlaying(!playing)}
          aria-label={playing ? 'Pause cover video' : 'Play cover video'}
        >
          {playing ? 'Ⅱ' : '▶'}
        </button>
      )}
      <button
        type="button"
        className="editorial-cover-next"
        aria-label="Start reading"
        onClick={(event) =>
          event.currentTarget.closest('section')?.nextElementSibling?.scrollIntoView({
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          })
        }
      >
        ⌄
      </button>
    </section>
  )
}
