import type { ReactNode } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

import { ResultRow } from '@/components/ui/result-list'
import { ExistingOpeningGreenUp } from './ExistingOpeningGreenUp'
import { createEmptyScene, type ForestryScene } from './scene'
import type { TargetPolygon } from './types'

// The virtualizer needs a DOM; the double draws every row. The real one draws rows only inside an element carrying
// `data-map-sidebar-scroll`, which is what the test asserts the rows sit in.
vi.mock('@/components/ui/virtual-result-list', () => ({
  VirtualResultList: <T,>({
    items,
    getKey,
    children,
  }: {
    items: readonly T[]
    getKey: (item: T) => string
    children: (item: T) => ReactNode
  }) => items.map((item) => <div key={getKey(item)}>{children(item)}</div>),
}))

const square: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-122.7, 53.9],
      [-122.69, 53.9],
      [-122.69, 53.91],
      [-122.7, 53.91],
      [-122.7, 53.9],
    ],
  ],
}
function sceneWithOpenings(): ForestryScene {
  const opening = (id: string, name: string): TargetPolygon =>
    ({ id, name, role: 'harvested', geometry: square, harvestYear: 2015, clearcutPercent: 100 }) as TargetPolygon
  return { ...createEmptyScene(), targets: [opening('a', 'Opening A'), opening('b', 'Opening B')] }
}

describe('ExistingOpeningGreenUp', () => {
  it('draws its rows when no sidebar scroller is around it (shown in Save & export)', () => {
    let view: ReturnType<typeof create>
    act(() => {
      view = create(<ExistingOpeningGreenUp scene={sceneWithOpenings()} onChange={() => undefined} />, {
        // A dialog's projection slot: nothing above the list scrolls.
        createNodeMock: () => ({ parentElement: { closest: () => null } }),
      })
    })
    const own = view!.root.findAll((node) => node.type === 'div' && node.props['data-map-sidebar-scroll'] === 'true')
    expect(own).toHaveLength(1)
    expect(own[0].findAllByType(ResultRow).map((row) => row.props.title)).toEqual(['Opening A', 'Opening B'])
    act(() => view!.unmount())
  })
})
