import { stratify, cluster, linkRadial } from 'd3'
import type { HierarchyNode, DotPoint, DotStep } from '@/maps/project-story/editorial/model/types'
export function radialHierarchyLayout(nodes: HierarchyNode[]) {
  const root = stratify<HierarchyNode>()
    .id((n) => n.id)
    .parentId((n) => n.parentId)(nodes)
  const placed = cluster<HierarchyNode>().size([Math.PI * 2, 200])(root)
  const link = linkRadial<
    { source: { x: number; y: number }; target: { x: number; y: number } },
    { x: number; y: number }
  >()
    .angle((d) => d.x)
    .radius((d) => d.y)
  return {
    nodes: placed
      .descendants()
      .map((n) => ({ ...n.data, x: Math.sin(n.x) * n.y, y: -Math.cos(n.x) * n.y, depth: n.depth })),
    links: placed.links().map((l) => ({ id: l.target.id!, path: link(l) ?? '' })),
  }
}
export function ancestorIds(nodes: HierarchyNode[], id: string | null) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const result = new Set<string>()
  let n = id ? byId.get(id) : undefined
  while (n && !result.has(n.id)) {
    result.add(n.id)
    n = n.parentId ? byId.get(n.parentId) : undefined
  }
  return result
}
export function selectedDots(points: DotPoint[], step?: DotStep) {
  return points.filter(
    (p) =>
      (!step?.categoryIds || step.categoryIds.includes(p.categoryId)) &&
      (!step?.region || Math.hypot(p.x - step.region.x, p.y - step.region.y) <= step.region.radius),
  )
}
