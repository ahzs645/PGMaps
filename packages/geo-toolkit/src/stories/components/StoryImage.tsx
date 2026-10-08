import { useEffect, useLayoutEffect, useRef, useState, type ImgHTMLAttributes, type RefObject } from 'react'

/** Keep the last decoded image on screen until its replacement can paint. */
export function StoryImage({ src, alt, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const host = useRef<HTMLImageElement>(null)
  const [near, setNear] = useState(false)
  const [displayed, setDisplayed] = useState<string>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!host.current) return
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: '600px' })
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!near || !src) return
    let cancelled = false
    const image = new Image()
    image.src = src
    void image
      .decode()
      .then(() => {
        if (!cancelled) {
          setDisplayed(src)
          setFailed(false)
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [near, src])
  return (
    <>
      <img
        {...props}
        ref={host}
        src={displayed}
        alt={displayed === src ? alt : ''}
        aria-busy={near && displayed !== src && !failed}
        data-image-state={failed ? 'error' : displayed === src ? 'ready' : 'loading'}
      />
      {failed && <span role="status">Image unavailable.{displayed && ' The previous image is shown.'}</span>}
    </>
  )
}

/** Warm only adjacent image media in nearby sidecars, never all story maps. */
export function useAdjacentImages(
  host: RefObject<HTMLElement>,
  scrollRoot: RefObject<HTMLDivElement>,
  urls: Array<string | undefined>,
  active: number,
  preload?: () => void,
) {
  const prepare = useRef(preload)
  useLayoutEffect(() => {
    prepare.current = preload
  }, [preload])
  const key = JSON.stringify(urls.slice(Math.max(0, active - 1), active + 2).filter(Boolean))
  useEffect(() => {
    const element = host.current
    if (!element) return
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
      .connection
    if (connection?.saveData || /(^|-)2g|3g/.test(connection?.effectiveType ?? '')) return
    let images: HTMLImageElement[] = []
    let nearby = false
    const warm = () => {
      images = []
      if (!nearby || document.hidden) return
      prepare.current?.()
      images = (JSON.parse(key) as string[]).map((src) => {
        const image = new Image()
        image.src = src
        void image.decode().catch(() => {})
        return image
      })
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        nearby = entry.isIntersecting
        warm()
      },
      { root: scrollRoot.current, rootMargin: '600px' },
    )
    observer.observe(element)
    document.addEventListener('visibilitychange', warm)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', warm)
      images.forEach((image) => {
        image.src = ''
      })
      images = []
    }
  }, [host, scrollRoot, key, active])
}
