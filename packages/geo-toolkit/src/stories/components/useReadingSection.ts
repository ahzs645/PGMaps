import { useEffect, useState, type RefObject } from 'react'
import { useWorkspace } from '../../workspace/workspace-context.js'

export function useReadingSection(
  scrollRoot: RefObject<HTMLDivElement>,
  refs: RefObject<Array<HTMLElement | null>>,
  count: number,
) {
  const workspace = useWorkspace()
  const responsive = workspace?.responsive ?? 'viewport'
  const [active, setActive] = useState(0)
  useEffect(() => {
    const root = scrollRoot.current
    if (!root) return
    let raf = 0
    const update = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const mobile =
          responsive === 'container'
            ? root.getBoundingClientRect().width <= 700
            : window.matchMedia('(max-width: 700px)').matches
        const stickyTop = parseFloat(getComputedStyle(root).getPropertyValue('--editorial-top')) || 108
        const section = refs.current?.find(Boolean)
        const media = section
          ?.closest('.editorial-immersive, .editorial-tour')
          ?.querySelector('.editorial-immersive-media, .editorial-tour-map')
        const mediaHeight = media?.getBoundingClientRect().height ?? 210
        const readingLine =
          root.getBoundingClientRect().top +
          (mobile ? stickyTop + mediaHeight + 64 : Math.min(root.clientHeight * 0.48, 450))
        let next = 0
        refs.current?.forEach((section, index) => {
          if (section && section.getBoundingClientRect().top <= readingLine) next = index
        })
        setActive(Math.min(next, count - 1))
      })
    }
    root.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    const observer = responsive === 'container' ? new ResizeObserver(update) : null
    observer?.observe(root)
    update()
    return () => {
      cancelAnimationFrame(raf)
      root.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      observer?.disconnect()
    }
  }, [count, refs, scrollRoot, responsive])
  return active
}
