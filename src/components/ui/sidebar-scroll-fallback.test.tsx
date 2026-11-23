import { useEffect } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

import { needsOwnScroller, SidebarScrollFallback } from './sidebar-scroll-fallback'

// A node whose parent either sits in a sidebar scroller or not.
const nodeIn = (sidebar: boolean) => () => ({ parentElement: { closest: () => (sidebar ? {} : null) } })
const scrollers = (view: ReturnType<typeof create>) =>
  view.root.findAll((node) => node.type === 'div' && node.props['data-map-sidebar-scroll'] === 'true')

describe('SidebarScrollFallback', () => {
  it('asks only the parent, so its own scroller does not count as the sidebar', () => {
    expect(needsOwnScroller(null)).toBe(false)
    expect(needsOwnScroller({ parentElement: null })).toBe(true)
    expect(needsOwnScroller({ parentElement: { closest: () => null } })).toBe(true)
    expect(needsOwnScroller({ parentElement: { closest: () => ({}) } })).toBe(false)
  })

  it('adds nothing inside a sidebar scroller', () => {
    let view: ReturnType<typeof create>
    act(() => {
      view = create(
        <SidebarScrollFallback>
          <p>row</p>
        </SidebarScrollFallback>,
        { createNodeMock: nodeIn(true) },
      )
    })
    expect(scrollers(view!)).toHaveLength(0)
    expect(view!.root.findAllByType('p')).toHaveLength(1)
    act(() => view!.unmount())
  })

  it('is a bounded scroller of its own where none is around it, and mounts the list again in it', () => {
    const mounts = vi.fn()
    function List() {
      useEffect(() => mounts(), [])
      return <p>row</p>
    }
    let view: ReturnType<typeof create>
    act(() => {
      view = create(
        <SidebarScrollFallback>
          <List />
        </SidebarScrollFallback>,
        { createNodeMock: nodeIn(false) },
      )
    })
    const [own] = scrollers(view!)
    expect(own.props.className).toContain('overflow-y-auto')
    expect(own.findAllByType('p')).toHaveLength(1)
    // Once in the sidebar's place, once again in its own scroller: a virtualizer keeps the scroller it first found.
    expect(mounts).toHaveBeenCalledTimes(2)
    act(() => view!.unmount())
  })
})
