import { useEffect, useState, type ReactNode, type RefObject } from 'react'
import { ProjectBackButton } from '@/components/projects/ProjectBackButton'
import { StoryChapterNavigation } from './components/StoryChapterNavigation'
import { useSectionUrl } from './components/useSectionUrl'
import './EditorialStory.css'
export function EditorialShell({
  title,
  onBack,
  scrollRoot,
  chapters,
  cover,
  children,
  sectionUrl = false,
}: {
  title: string
  onBack: () => void
  scrollRoot: RefObject<HTMLDivElement>
  chapters: { id: string; label: string }[]
  cover?: ReactNode
  children: ReactNode
  sectionUrl?: boolean
}) {
  useSectionUrl(scrollRoot, sectionUrl, chapters.map((chapter) => chapter.id))
  const [chapter, setChapter] = useState('')
  useEffect(() => {
    const root = scrollRoot.current
    if (!root) return
    const measure = () => root.style.setProperty('--editorial-viewport', `${root.clientHeight}px`)
    measure()
    const size = new ResizeObserver(measure)
    size.observe(root)
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setChapter(e.target.id)
      },
      { root, rootMargin: '-100px 0px -60% 0px', threshold: 0 },
    )
    for (const ch of chapters) {
      const el = Array.from(root.querySelectorAll('[id]')).find((el) => el.id === ch.id)
      if (el) observer.observe(el)
    }
    return () => {
      size.disconnect()
      observer.disconnect()
    }
  }, [scrollRoot, chapters])
  const scroll = (id?: string) => {
    const root = scrollRoot.current
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    if (id)
      Array.from(root?.querySelectorAll('[id]') ?? [])
        .find((el) => el.id === id)
        ?.scrollIntoView({ behavior, block: 'start' })
    else root?.scrollTo({ top: 0, behavior })
  }
  return (
    <div className="editorial-workspace">
      <div className="editorial-project-toolbar" aria-label="Project navigation">
        <ProjectBackButton onBack={onBack} />
        <button className="editorial-project-title" aria-label={`${title}: Return to top`} onClick={() => scroll()}>
          {title}
        </button>
      </div>
      <div ref={scrollRoot} className="editorial-story" data-testid="editorial-story" aria-label={title}>
        {cover}
        <StoryChapterNavigation chapters={chapters} active={chapter} onSelect={scroll} />
        {children}
      </div>
    </div>
  )
}
