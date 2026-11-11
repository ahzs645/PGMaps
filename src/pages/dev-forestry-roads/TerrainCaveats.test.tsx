import { createElement, type ReactElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { TerrainCaveats } from './TerrainCaveats'

// The dialog shell needs a browser; this stub keeps its trigger and shows the body only while open.
vi.mock('@/components/ui/dialog-shell', () => ({
  PanelDialog: ({
    children,
    open,
    onOpenChange,
    trigger,
  }: {
    children: ReactNode
    open: boolean
    onOpenChange: (open: boolean) => void
    trigger: ReactElement<{ onClick?: () => void }>
  }) =>
    createElement(
      'span',
      {},
      createElement('span', { onClick: () => onOpenChange(true) }, trigger),
      open ? createElement('section', { role: 'dialog' }, children) : null,
    ),
}))

const render = (element: ReactElement) => {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(element)
  })
  return renderer
}
const triggerLabels = (renderer: ReactTestRenderer) =>
  renderer.root.findAllByType('button').map((button) => button.props['aria-label'])
const text = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON())

describe('terrain caveats', () => {
  it('keeps context warnings behind the triangle until it is clicked', () => {
    const renderer = render(<TerrainCaveats screening warnings={['Physical road history is missing.', 'No outlet.']} />)
    expect(triggerLabels(renderer)).toEqual(['Terrain and context caveats (3)'])
    expect(text(renderer)).not.toContain('Physical road history is missing.')
    act(() => renderer.root.findByType('button').parent!.props.onClick())
    expect(text(renderer)).toContain('Physical road history is missing.')
    expect(text(renderer)).toContain('No outlet.')
    expect(text(renderer)).toContain('Screening terrain.')
  })

  it('names a lone screening note as before', () => {
    expect(triggerLabels(render(<TerrainCaveats screening warnings={[]} />))).toEqual(['Screening terrain'])
  })

  it('shows nothing when there is nothing to caution', () => {
    expect(render(<TerrainCaveats screening={false} warnings={[]} />).toJSON()).toBeNull()
  })
})
