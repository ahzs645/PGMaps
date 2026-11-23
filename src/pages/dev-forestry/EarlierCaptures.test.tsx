import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

import { EarlierCaptures } from './ViewsOfInterestPanel'
import { viewAtPoint, viewCaptureKey } from './viewsOfInterest'

// The (i) reads `window.matchMedia`; this renderer has no DOM, and the tip is not under test.
vi.mock('@/components/ui/info-tip', () => ({ InfoTip: () => null }))

const block = { id: 'block-1', name: 'Made-up block' }
const view = viewAtPoint({ lng: -122.7, lat: 53.9 }, block, [])
const text = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON())
const keepButtons = (renderer: ReactTestRenderer) =>
  renderer.root.findAll(
    (node) => node.type === 'button' && String(node.props.title ?? '').startsWith('Make this save an ordinary'),
  )

describe('earlier captures under a planned view', () => {
  it('lists saves under an earlier key, read-only, with what changed and one keep action each', () => {
    const edited = { ...view, focalMm: 28 }
    const saved = [
      { id: 'old', plannedViewId: view.id, plannedKey: viewCaptureKey(view) },
      { id: 'now', plannedViewId: view.id, plannedKey: viewCaptureKey(edited) },
    ]
    const kept: string[] = []
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(
        <EarlierCaptures
          view={edited}
          savedViews={saved}
          details={(id) => ({ name: `Saved ${id}`, thumbUrl: 'data:image/jpeg;base64,AA==', savedAt: null })}
          onKeep={(id) => kept.push(id)}
          busy={false}
        />,
      )
    })
    expect(text(renderer)).toContain('Earlier captures (1)')
    expect(text(renderer)).toContain('Saved old')
    expect(text(renderer)).toContain('Since then its lens changed.')
    expect(text(renderer)).not.toContain('Saved now')
    const buttons = keepButtons(renderer)
    expect(buttons).toHaveLength(1)
    act(() => buttons[0].props.onClick())
    expect(kept).toEqual(['old'])
  })

  it('shows nothing for a view with no earlier capture, and no action without a handler', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(
        <EarlierCaptures
          view={view}
          savedViews={[{ id: 'now', plannedViewId: view.id, plannedKey: viewCaptureKey(view) }]}
          busy={false}
        />,
      )
    })
    expect(renderer.toJSON()).toBeNull()
    act(() => {
      renderer.update(<EarlierCaptures view={view} savedViews={[{ id: 'old', plannedViewId: view.id }]} busy={false} />)
    })
    expect(text(renderer)).toContain('Taken under an earlier version of this view.')
    expect(keepButtons(renderer)).toHaveLength(0)
  })
})
