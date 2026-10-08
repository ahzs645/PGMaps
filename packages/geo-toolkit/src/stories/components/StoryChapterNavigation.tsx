import { useRef } from 'react'

export function StoryChapterNavigation({
  chapters,
  active,
  onSelect,
}: {
  chapters: Array<{ id: string; label: string }>
  active: string
  onSelect: (id: string) => void
}) {
  const rail = useRef<HTMLElement>(null)
  return (
    <div className="editorial-nav-shell">
      <nav ref={rail} className="editorial-chapters" data-testid="editorial-nav" aria-label="Story chapters">
        {chapters.map((chapter) => (
          <button
            type="button"
            key={chapter.id}
            aria-current={active === chapter.id ? 'location' : undefined}
            onClick={() => onSelect(chapter.id)}
          >
            {chapter.label}
          </button>
        ))}
      </nav>
      <button
        type="button"
        className="editorial-nav-next"
        aria-label="More chapters"
        onClick={() =>
          rail.current?.scrollBy({
            left: rail.current.clientWidth * 0.6,
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          })
        }
      >
        ›
      </button>
    </div>
  )
}
