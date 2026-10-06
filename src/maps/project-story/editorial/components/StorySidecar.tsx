import { useRef, type ReactNode, type RefObject } from 'react'
import { ExpandableMedia } from './StoryMedia'
import { useReadingSection } from './useReadingSection'
import { useAdjacentImages } from './StoryImage'

export interface StorySidecarSlide {
  id: string
  content: ReactNode
  media: ReactNode
  imageUrl?: string
  preload?: () => void
}
/** Scroll-linked prose and media; content and map technology belong to callers. */
export function StorySidecar({
  id,
  slides,
  scrollRoot,
  variant = 'docked',
  side = 'left',
  width = 'medium',
}: {
  id: string
  slides: StorySidecarSlide[]
  scrollRoot: RefObject<HTMLDivElement>
  variant?: 'docked' | 'floating'
  side?: 'left' | 'right' | 'center'
  width?: 'medium' | 'large'
}) {
  const panels = useRef<Array<HTMLElement | null>>([])
  const host = useRef<HTMLElement>(null)
  const active = useReadingSection(scrollRoot, panels, slides.length)
  useAdjacentImages(
    host,
    scrollRoot,
    slides.map((slide) => slide.imageUrl),
    active,
    slides[active + 1]?.preload,
  )
  return (
    <section
      id={id}
      ref={host}
      className={`editorial-immersive is-${variant} ${side === 'right' ? 'is-right' : side === 'center' ? 'is-centered' : ''} ${width === 'large' ? 'is-large' : ''}`}
      data-testid={`editorial-immersive-${id}`}
      data-active-slide={active}
    >
      <div className="editorial-immersive-media">
        <ExpandableMedia>{slides[active]?.media}</ExpandableMedia>
      </div>
      <div className="editorial-immersive-narrative">
        {slides.map((slide, index) => (
          <section
            key={slide.id}
            id={slide.id}
            data-story-section
            ref={(element) => {
              panels.current[index] = element
            }}
            className={`editorial-slide ${active === index ? 'is-active' : ''}`}
            data-testid={`editorial-slide-${slide.id}`}
            data-active={active === index}
          >
            <div className="editorial-slide-copy">{slide.content}</div>
          </section>
        ))}
      </div>
    </section>
  )
}
