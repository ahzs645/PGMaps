import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it } from 'vitest'
import { JsonResults } from './PortalChecks'

let tree: ReactTestRenderer | undefined
afterEach(() => {
  act(() => tree?.unmount())
})
function text(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(text).join('')
}
const visibleRows = () => JSON.parse(tree!.root.findByType('pre').children.join('')) as { row: number }[]
const button = (label: string) => tree!.root.findAllByType('button').find((node) => text(node) === label)!

it('makes all JSON results reachable in pages of 20 and clamps when results shrink', () => {
  const rows = Array.from({ length: 45 }, (_, row) => ({ row }))
  act(() => {
    tree = create(<JsonResults data={{ results: rows }} />)
  })
  expect(visibleRows()).toEqual(rows.slice(0, 20))
  expect(button('Previous').props.disabled).toBe(true)
  act(() => button('Next').props.onClick())
  expect(visibleRows()).toEqual(rows.slice(20, 40))
  act(() => button('Next').props.onClick())
  expect(visibleRows()).toEqual(rows.slice(40))
  expect(button('Next').props.disabled).toBe(true)
  expect(text(tree!.root)).toContain('Page 3 of 3')
  act(() => tree!.update(<JsonResults data={rows.slice(0, 3)} />))
  expect(visibleRows()).toEqual(rows.slice(0, 3))
  expect(text(tree!.root)).toContain('Page 1 of 1')
})

it('keeps object responses inspectable without paging or slicing their properties', () => {
  const response = { metadata: { source: 'portal' }, counts: [1, 2, 3] }
  act(() => {
    tree = create(<JsonResults data={response} />)
  })
  expect(JSON.parse(tree!.root.findByType('pre').children.join(''))).toEqual(response)
  expect(tree!.root.findAllByType('nav')).toHaveLength(0)
})
