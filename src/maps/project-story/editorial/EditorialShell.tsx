import { useEffect, useState, type ReactNode, type RefObject, type ComponentProps } from 'react'
import { useTheme } from 'next-themes'
import { WorkspaceProvider, useWorkspace } from '@pgmaps/geo-toolkit/workspace/workspace-context'
import { ProjectBackButton } from '@/components/projects/ProjectBackButton'
import { StoryChapterNavigation } from './components/StoryChapterNavigation'
import { useSectionUrl } from './components/useSectionUrl'
import './EditorialStory.css'
function EditorialShellContent({
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
  const workspace = useWorkspace()
  useSectionUrl(
    scrollRoot,
    sectionUrl,
    chapters.map((chapter) => chapter.id),
  )
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
      <div
        ref={scrollRoot}
        className="editorial-story"
        data-theme={workspace?.theme}
        data-testid="editorial-story"
        aria-label={title}
      >
        {cover}
        <StoryChapterNavigation chapters={chapters} active={chapter} onSelect={scroll} />
        {children}
      </div>
    </div>
  )
}

/** Imported documents enter outside SharedMapLayout; retain the application's viewport presentation. */
export function EditorialShell(props: ComponentProps<typeof EditorialShellContent>) {
  const workspace = useWorkspace()
  const { resolvedTheme } = useTheme()
  if (workspace) return <EditorialShellContent {...props} />
  return (
    <WorkspaceProvider
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      eventTarget={typeof window === 'undefined' ? undefined : window}
      placement="viewport"
      responsive="viewport"
      toolbar={
        typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('[data-map-mobile-toolbar="true"]')
      }
      onDialogOpenChange={(hidden) =>
        window.dispatchEvent(new CustomEvent('pgmaps:mobile-toolbar-visibility', { detail: { hidden } }))
      }
    >
      <EditorialShellContent {...props} />
    </WorkspaceProvider>
  )
}
