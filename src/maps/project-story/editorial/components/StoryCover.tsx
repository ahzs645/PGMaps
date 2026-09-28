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
  const [playing, setPlaying] = useState(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (playing) void videoRef.current?.play().catch(() => setPlaying(false))
    else videoRef.current?.pause()
  }, [playing])
  return (
    <section className="editorial-cover" data-testid="editorial-cover">
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
