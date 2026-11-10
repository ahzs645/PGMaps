import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { LandingCatchmentResults } from './LandingCatchmentResults'
import type { LandingCatchments } from './landingCatchments'

vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children }: { children: ReactNode }) => createElement('aside', {}, children),
}))

const catchments: LandingCatchments = {
  by: 'landing',
  rows: [
    {
      id: 'l1',
      name: 'L1',
      color: '#000000',
      status: 'existing',
      cells: 4,
      ha: 0.4,
      share: 1,
      meanM: 80,
      farthestM: 120,
    },
  ],
  group: new Int16Array(0),
  unassignedHa: 0,
  coveredHa: 0.4,
  offGrid: ['L4'],
}

const text = (node: ReturnType<ReactTestRenderer['toJSON']>): string =>
  node === null
    ? ''
    : Array.isArray(node)
      ? node.map(text).join('')
      : typeof node === 'string'
        ? node
        : text(node.children as never)

describe('LandingCatchmentResults', () => {
  it('lists a landing the run left out because it lies off the grid', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(createElement(LandingCatchmentResults, { catchments }))
    })
    const rows = renderer.root.findAll(
      (n) => n.props['data-testid'] === 'landing-catchment-off-grid' && typeof n.type === 'string',
    )
    expect(rows).toHaveLength(1)
    const all = text(renderer.toJSON())
    expect(all).toContain('L4off the grid: left out')
    expect(all).toContain('Every landing is listed')
  })
})
