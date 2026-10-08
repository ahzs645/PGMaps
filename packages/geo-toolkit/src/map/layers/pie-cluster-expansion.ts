import { createDonutElement, pieMarkerDonutProperties } from '../../visualizations/donut.js'

export const SPIDERFY_LIMIT = 16
export const CLUSTER_LIST_PAGE_SIZE = 50

export function getClusterLeafProperties(feature: GeoJSON.Feature): Record<string, unknown> {
  return (feature.properties ?? {}) as Record<string, unknown>
}

export function getClusterLeafTitle(properties: Record<string, unknown>, fallbackIndex: number): string {
  const label = String(properties.spiderTitle ?? properties.name ?? '').trim()
  return label || `Record ${fallbackIndex + 1}`
}

export function createSpiderElement(
  leaves: GeoJSON.Feature[],
  onSelect: (properties: Record<string, unknown>) => void,
  pieStyle?: {
    bandColors: readonly string[]
    showCount: boolean
    centerStyle: 'white' | 'transparent'
  },
): HTMLDivElement {
  const root = document.createElement('div')
  root.style.width = '1px'
  root.style.height = '1px'
  root.style.pointerEvents = 'none'

  const svgNamespace = 'http://www.w3.org/2000/svg'
  const lines = document.createElementNS(svgNamespace, 'svg')
  lines.setAttribute('width', '1')
  lines.setAttribute('height', '1')
  lines.style.position = 'absolute'
  lines.style.overflow = 'visible'
  lines.style.pointerEvents = 'none'
  root.appendChild(lines)

  const count = leaves.length
  const radius = pieStyle ? (count <= 8 ? 64 : 82) : count <= 8 ? 42 : 58
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const motionEasing = 'cubic-bezier(0.22, 1, 0.36, 1)'
  leaves.forEach((leaf, index) => {
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius
    const properties = getClusterLeafProperties(leaf)
    const color = String(properties.color ?? '#92400e')
    const title = getClusterLeafTitle(properties, index)
    const subtitle = String(properties.spiderSubtitle ?? '').trim()

    const halo = document.createElementNS(svgNamespace, 'line')
    halo.setAttribute('x1', '0')
    halo.setAttribute('y1', '0')
    halo.setAttribute('x2', String(x))
    halo.setAttribute('y2', String(y))
    halo.setAttribute('stroke', '#ffffff')
    halo.setAttribute('stroke-width', '4')
    halo.setAttribute('stroke-linecap', 'round')
    lines.appendChild(halo)

    const line = document.createElementNS(svgNamespace, 'line')
    line.setAttribute('x1', '0')
    line.setAttribute('y1', '0')
    line.setAttribute('x2', String(x))
    line.setAttribute('y2', String(y))
    line.setAttribute('stroke', '#64748b')
    line.setAttribute('stroke-width', '1.5')
    line.setAttribute('stroke-linecap', 'round')
    lines.appendChild(line)

    const button = document.createElement('button')
    button.type = 'button'
    const countLabel = pieStyle ? `${Number(properties.count) || 0} publications` : ''
    button.setAttribute(
      'aria-label',
      subtitle ? `${title}, ${subtitle}` : countLabel ? `${title}, ${countLabel}` : title,
    )
    button.title = subtitle ? `${title}\n${subtitle}` : title
    button.style.position = 'absolute'
    button.style.left = `${x}px`
    button.style.top = `${y}px`
    button.style.padding = '0'
    if (pieStyle) {
      const donut = createDonutElement(
        pieMarkerDonutProperties(properties, pieStyle.bandColors),
        pieStyle.bandColors,
        pieStyle.showCount,
        pieStyle.centerStyle,
      )
      button.style.width = donut.style.width
      button.style.height = donut.style.height
      button.style.border = '0'
      button.style.borderRadius = '9999px'
      button.style.background = 'transparent'
      button.appendChild(donut)
    } else {
      button.style.width = '18px'
      button.style.height = '18px'
      button.style.border = '2px solid #ffffff'
      button.style.borderRadius = '9999px'
      button.style.background = color
      button.style.boxShadow = '0 1px 4px rgba(15,23,42,0.5)'
    }
    button.style.cursor = 'pointer'
    button.style.pointerEvents = 'auto'
    button.style.transform = 'translate(-50%, -50%)'
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      onSelect(properties)
    })
    root.appendChild(button)

    if (!reduceMotion) {
      const distance = Math.hypot(x, y)
      const delay = index * 40

      for (const connector of [halo, line]) {
        connector.style.strokeDasharray = String(distance)
        connector.style.strokeDashoffset = '0'
      }

      requestAnimationFrame(() => {
        for (const connector of [halo, line]) {
          connector.animate(
            [
              { opacity: 0, strokeDashoffset: String(distance) },
              { opacity: 1, strokeDashoffset: '0' },
            ],
            {
              duration: 300,
              delay,
              easing: motionEasing,
              fill: 'both',
            },
          )
        }

        button.animate(
          [
            {
              opacity: 0,
              transform: `translate(-50%, -50%) translate(${-x}px, ${-y}px) scale(0.7)`,
            },
            {
              opacity: 1,
              transform: 'translate(-50%, -50%) translate(0, 0) scale(1)',
            },
          ],
          {
            duration: 360,
            delay,
            easing: motionEasing,
            fill: 'both',
          },
        )
      })
    }
  })

  return root
}
