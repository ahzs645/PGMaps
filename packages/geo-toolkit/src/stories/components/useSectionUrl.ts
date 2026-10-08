import { useEffect, type RefObject } from 'react'

/** Opt-in reading links. Replace history entries so scrolling never fills Back. */
export function useSectionUrl(scrollRoot: RefObject<HTMLDivElement>, enabled: boolean, chapterIds: string[]) {
  const chapterKey = JSON.stringify(chapterIds)
  useEffect(() => {
    const root = scrollRoot.current
    if (!enabled || !root) return
    let frame = 0
    const chapters = new Set<string>(JSON.parse(chapterKey))
    const sections = Array.from(root.querySelectorAll<HTMLElement>('[id]')).filter(
      (element) => element.hasAttribute('data-story-section') || chapters.has(element.id),
    )
    const restore = () => {
      let id: string
      try {
        id = decodeURIComponent(window.location.hash.slice(1))
      } catch {
        return
      }
      if (!id) {
        root.scrollTo({ top: 0, behavior: 'instant' })
        return
      }
      sections.find((section) => section.id === id)?.scrollIntoView({ block: 'start', behavior: 'instant' })
    }
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const top = root.getBoundingClientRect().top
        const stickyTop = parseFloat(getComputedStyle(root).getPropertyValue('--editorial-top')) || 64
        let id = ''
        if (root.scrollTop > 1) {
          for (const section of sections) {
            // Sidecars and tours already compute the current panel from their
            // actual sticky media height. Use that state rather than guessing it.
            const parent = section.closest<HTMLElement>('.editorial-immersive, .editorial-tour')
            if (parent) {
              const rect = parent.getBoundingClientRect()
              if (rect.top > top + stickyTop + 32 || rect.bottom <= top + stickyTop + 32) continue
              const active = Number(parent.dataset.activeSlide ?? parent.dataset.activePlace)
              const panels = Array.from(parent.querySelectorAll<HTMLElement>('.editorial-slide, .editorial-tour-stop'))
              if (panels[active]?.id) id = panels[active].id
            } else if (section.getBoundingClientRect().top <= top + stickyTop + 32) id = section.id
          }
        }
        const hash = id ? `#${encodeURIComponent(id)}` : ''
        if (window.location.hash !== hash)
          window.history.replaceState(
            window.history.state,
            '',
            `${window.location.pathname}${window.location.search}${hash}`,
          )
      })
    }
    restore()
    root.addEventListener('scroll', update, { passive: true })
    window.addEventListener('hashchange', restore)
    window.addEventListener('popstate', restore)
    // Active panels update after their scroll RAF; observe that small state
    // change so URLs also follow tour buttons and map-driven navigation.
    const observer = new MutationObserver(update)
    observer.observe(root, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-active-slide', 'data-active-place'],
    })
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      root.removeEventListener('scroll', update)
      window.removeEventListener('hashchange', restore)
      window.removeEventListener('popstate', restore)
    }
  }, [enabled, scrollRoot, chapterKey])
}
