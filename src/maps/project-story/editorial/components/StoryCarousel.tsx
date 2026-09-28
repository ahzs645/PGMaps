import { useState, type ReactNode } from 'react'

/** Ordered media slots shared by imported documents and newly authored stories. */
export function StoryCarousel({ items }: { items: ReactNode[] }) {
  const [selected, setSelected] = useState(0)
  const active = Math.min(selected, Math.max(0, items.length - 1))
  return (
    <div className="editorial-carousel">
      {items[active]}
      {items.length > 1 && (
        <div className="editorial-carousel-controls">
          <button disabled={!active} onClick={() => setSelected(active - 1)} aria-label="Previous image">
            ←
          </button>
          <span>
            {active + 1} / {items.length}
          </span>
          <button
            disabled={active === items.length - 1}
            onClick={() => setSelected(active + 1)}
            aria-label="Next image"
          >
            →
          </button>
        </div>
      )}
    </div>
  )
}
