/** Capability checks for the supported imported presentation, shared with package audit. */
export function validateImportedStory(graph) {
  const errors = []
  const nodes = graph?.nodes
  const known = new Set([
    'story',
    'storycover',
    'navigation',
    'text',
    'image',
    'video',
    'separator',
    'button',
    'carousel',
    'immersive',
    'immersive-slide',
    'immersive-narrative-panel',
    'webmap',
    'swipe',
    'tour',
    'tour-map',
    'credits',
    'attribution',
  ])
  if (!nodes || typeof graph.root !== 'string' || nodes[graph.root]?.type !== 'story' || !graph.resources)
    return ['Imported story requires its story root, nodes and resources']
  for (const [id, resource] of Object.entries(graph.resources)) {
    const delivery = resource?.data?.deliveryUrl
    if (
      delivery !== undefined &&
      (!['image', 'video'].includes(resource.type) ||
        typeof delivery !== 'string' ||
        !/^(\/data\/story-documents\/|https:\/\/)/.test(delivery))
    )
      errors.push(`${id}: deliveryUrl must be local story media or HTTPS image/video media`)
  }
  for (const [id, n] of Object.entries(nodes)) {
    if (!n || !known.has(n.type)) {
      errors.push(`${id}: unsupported node type ${n?.type}`)
      continue
    }
    if (
      n.children !== undefined &&
      (!Array.isArray(n.children) || n.children.some((c) => typeof c !== 'string' || !nodes[c]))
    ) {
      errors.push(`${id}: invalid children`)
      continue
    }
    if (n.type === 'immersive' && !['docked-panel', 'floating-panel'].includes(n.data?.subtype))
      errors.push(`${id}: unsupported immersive subtype ${n.data?.subtype}`)
    if (n.type === 'tour' && (n.data?.type !== 'guided-tour' || n.data?.subtype !== 'map-focused'))
      errors.push(`${id}: unsupported tour layout`)
    if (
      n.type === 'text' &&
      !['paragraph', 'large-paragraph', 'h2', 'h3', 'h4', 'quote', 'bullet-list'].includes(n.data?.type)
    )
      errors.push(`${id}: unsupported text type ${n.data?.type}`)
    for (const child of n.children ?? [])
      if (nodes[child]?.type === 'video' && n.type !== 'storycover')
        errors.push(`${child}: standalone video is not supported; video belongs to a cover`)
  }
  const visited = new Set(),
    active = new Set()
  function visit(id) {
    if (active.has(id)) {
      errors.push(`${id}: cyclic content`)
      return
    }
    if (visited.has(id)) return
    visited.add(id)
    active.add(id)
    const children = nodes[id]?.children
    if (Array.isArray(children)) for (const c of children) visit(c)
    active.delete(id)
  }
  visit(graph.root)
  return errors
}
