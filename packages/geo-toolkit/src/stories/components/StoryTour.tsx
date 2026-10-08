import { useRef, type ReactNode, type RefObject } from 'react'
import { ExpandableMedia } from './StoryMedia.js'
import { useReadingSection } from './useReadingSection.js'

export interface StoryTourStop {
  id: string
  media: ReactNode
  content: ReactNode
}
/** Ordered photo tour with scroll, numbered and map-driven stop selection. */
export function StoryTour({
  id,
  stops,
  scrollRoot,
  renderMap,
}: {
  id: string
  stops: StoryTourStop[]
  scrollRoot: RefObject<HTMLDivElement>
  renderMap: (active: number, select: (index: number) => void) => ReactNode
}) {
  const refs = useRef<Array<HTMLElement | null>>([])
  const active = useReadingSection(scrollRoot, refs, stops.length)
  const select = (index: number) =>
    refs.current[index]?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    })
  return (
    <section id={id} className="editorial-tour" data-testid={`editorial-tour-${id}`} data-active-place={active}>
      <div className="editorial-tour-map">
        {/* select reads the ref only when a map interaction invokes it, never while rendering the slot. */}
        {/* eslint-disable-next-line react-hooks/refs */}
        <ExpandableMedia label="Expand map">{renderMap(active, select)}</ExpandableMedia>
        <nav className="editorial-tour-dots" aria-label="Tour stops">
          {stops.map((stop, index) => (
            <button
              key={stop.id}
              aria-label={`Stop ${index + 1}`}
              aria-current={index === active ? 'step' : undefined}
              onClick={() => select(index)}
            >
              {index + 1}
            </button>
          ))}
        </nav>
      </div>
      <div className="editorial-tour-narrative">
        {stops.map((stop, index) => (
          <section
            key={stop.id}
            id={stop.id}
            data-story-section
            ref={(element) => {
              refs.current[index] = element
            }}
            className="editorial-tour-stop"
            data-testid="editorial-tour-stop"
          >
            {stop.media}
            <div className="editorial-tour-copy">
              <div className="editorial-stop-number">
                {index + 1} / {stops.length}
              </div>
              {stop.content}
              <div className="editorial-tour-controls">
                <button disabled={index === 0} onClick={() => select(index - 1)} aria-label="Previous tour stop">
                  ←
                </button>
                <button
                  disabled={index === stops.length - 1}
                  onClick={() => select(index + 1)}
                  aria-label="Next tour stop"
                >
                  →
                </button>
              </div>
            </div>
          </section>
        ))}
      </div>
    </section>
  )
}
