import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer'
import { afterEach, expect, it } from 'vitest'
import { JsonResults } from './PortalChecks'
import { PaginationControls } from '@/components/ui/pagination-controls'

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
  expect(text(tree!.root)).toContain('45 records · Page 3 of 3')
  act(() => tree!.update(<JsonResults data={rows.slice(0, 3)} />))
  expect(visibleRows()).toEqual(rows.slice(0, 3))
  expect(text(tree!.root)).toContain('3 records · Page 1 of 1')
})

it('keeps object responses inspectable without paging or slicing their properties', () => {
  const response = { metadata: { source: 'portal' }, counts: [1, 2, 3] }
  act(() => {
    tree = create(<JsonResults data={response} />)
  })
  expect(JSON.parse(tree!.root.findByType('pre').children.join(''))).toEqual(response)
  expect(tree!.root.findAllByType('nav')).toHaveLength(0)
})

it('restores the combined JSON count/page summary and groups its actions after it', () => {
  act(() => {
    tree = create(<JsonResults data={Array.from({ length: 8 }, (_, row) => ({ row }))} />)
  })
  const nav = tree!.root.findByType('nav')
  const summary = nav.findAllByType('span').find((node) => node.props['aria-live'] === 'polite')!
  expect(text(summary)).toBe('8 records · Page 1 of 1')
  expect(summary.props.className).toContain('text-sm')
  expect(nav.props.className).toContain('flex-wrap')
  const elements = nav.children.filter((child): child is ReactTestInstance => typeof child !== 'string')
  expect(elements.map((child) => child.type)).toEqual(['span', 'div'])
  expect(elements[1].findAllByType('button').map(text)).toEqual(['Previous', 'Next'])
  expect(button('Previous').props.disabled).toBe(true)
  expect(button('Next').props.disabled).toBe(true)
})

it('keeps the default Previous / summary / Next layout, labels and page callbacks unchanged', () => {
  const pages: number[] = []
  act(() => {
    tree = create(
      <PaginationControls page={1} pageCount={3} onPageChange={(page) => pages.push(page)} label="Default pages" />,
    )
  })
  const rendered = tree!.toJSON() as ReactTestRendererJSON
  expect(rendered.children!.map((child) => (typeof child === 'string' ? child : child.type))).toEqual([
    'button',
    'span',
    'button',
  ])
  expect(text(tree!.root)).toBe('Previous2 / 3Next')
  expect(tree!.root.findByType('nav').props.className).not.toContain('flex-wrap')
  act(() => button('Previous').props.onClick())
  act(() => button('Next').props.onClick())
  expect(pages).toEqual([0, 2])
})
