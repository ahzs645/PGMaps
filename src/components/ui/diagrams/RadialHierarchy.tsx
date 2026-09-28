import { useMemo } from 'react'
import { ancestorIds, radialHierarchyLayout } from '@/lib/diagrams/storyDiagrams'
import type { Category, HierarchyNode } from '@/maps/project-story/editorial/model/types'
export function RadialHierarchy({
  nodes,
  categories,
  title,
  description,
  selectedCategory,
  onSelect,
}: {
  nodes: HierarchyNode[]
  categories: Category[]
  title: string
  description: string
  selectedCategory: string | null
  onSelect: (id: string | null) => void
}) {
  const layout = useMemo(() => radialHierarchyLayout(nodes), [nodes])
  const selected = nodes.find((n) => n.categoryId === selectedCategory)?.id ?? null
  const path = ancestorIds(nodes, selected)
  const palette = new Map(categories.map((c) => [c.id, c.color]))
  const branch = (parent?: string): React.ReactNode => (
    <ul>
      {nodes
        .filter((n) => n.parentId === parent)
        .map((n) => (
          <li key={n.id}>
            <button type="button" aria-pressed={n.id === selected} onClick={() => onSelect(n.categoryId ?? null)}>
              {n.label}
            </button>
            {nodes.some((child) => child.parentId === n.id) && branch(n.id)}
          </li>
        ))}
    </ul>
  )
  return (
    <figure className="story-diagram" data-testid="radial-hierarchy" data-selected-category={selectedCategory ?? ''}>
      <h3>{title}</h3>
      <p>{description}</p>
      <svg viewBox="-380 -240 760 480" role="img" aria-label={title}>
        {layout.links.map((l) => (
          <path
            key={l.id}
            d={l.path}
            fill="none"
            stroke="currentColor"
            opacity={path.has(l.id) ? 1 : 0.25}
            strokeWidth={path.has(l.id) ? 3 : 1}
          />
        ))}
        {layout.nodes.map((n) => (
          <g key={n.id} transform={`translate(${n.x},${n.y})`}>
            <circle r={n.id === selected ? 9 : 6} fill={palette.get(n.categoryId ?? '') ?? 'currentColor'} />
            <text x={n.x < 0 ? -12 : 12} textAnchor={n.x < 0 ? 'end' : 'start'} dy=".35em">
              <title>{n.label}</title>
              {n.label.length > 24 ? `${n.label.slice(0, 23)}…` : n.label}
            </text>
          </g>
        ))}
      </svg>
      <div className="story-diagram-tree" aria-label={`${title} categories`}>
        {branch()}
      </div>
    </figure>
  )
}
