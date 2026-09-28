import { selectedDots } from '@/lib/diagrams/storyDiagrams'
import type { Category, Diagram } from '@/maps/project-story/editorial/model/types'
export function CategoryDotDiagram({
  diagram,
  categories,
  stepId,
  selectedCategory,
  onSelect,
}: {
  diagram: Extract<Diagram, { type: 'category-dots' }>
  categories: Category[]
  stepId?: string
  selectedCategory: string | null
  onSelect: (id: string | null) => void
}) {
  const step = diagram.steps.find((s) => s.id === stepId)
  const included = new Set(selectedDots(diagram.points, step).map((p) => p.id))
  const palette = new Map(categories.map((c) => [c.id, c.color]))
  return (
    <figure
      className="story-diagram"
      data-testid="category-dots"
      data-step={stepId ?? ''}
      data-selected-category={selectedCategory ?? ''}
    >
      <h3>{diagram.title}</h3>
      <p>{diagram.description}</p>
      <p className="story-diagram-note">
        {diagram.mode === 'illustrative' ? 'Illustrative data' : 'Measured data'} · {diagram.unit}
      </p>
      <svg
        viewBox="0 0 500 400"
        role="img"
        aria-label={`${diagram.title}: ${included.size} of ${diagram.points.length} dots in this step`}
      >
        {diagram.points.map((p) => (
          <circle
            key={p.id}
            data-point-id={p.id}
            cx={20 + p.x * 460}
            cy={20 + p.y * 360}
            r="7"
            fill={palette.get(p.categoryId)}
            stroke={p.categoryId === selectedCategory ? 'currentColor' : 'none'}
            strokeWidth="3"
            opacity={included.has(p.id) && (!selectedCategory || p.categoryId === selectedCategory) ? 1 : 0.15}
          />
        ))}
        {step?.region && (
          <ellipse
            cx={20 + step.region.x * 460}
            cy={20 + step.region.y * 360}
            rx={step.region.radius * 460}
            ry={step.region.radius * 360}
            fill="none"
            stroke="currentColor"
            strokeDasharray="6 4"
          />
        )}
      </svg>
      <figcaption>
        {step?.label ?? 'All categories'} · {included.size} / {diagram.points.length} dots
      </figcaption>
      <div className="story-category-controls" aria-label="Diagram categories">
        <button onClick={() => onSelect(null)} aria-pressed={!selectedCategory}>
          All categories
        </button>
        {categories.map((c) => (
          <button key={c.id} onClick={() => onSelect(c.id)} aria-pressed={c.id === selectedCategory}>
            <span style={{ background: c.color }} />
            {c.label} ({diagram.points.filter((p) => included.has(p.id) && p.categoryId === c.id).length})
          </button>
        ))}
      </div>
    </figure>
  )
}
