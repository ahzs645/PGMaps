import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { CostAttribution, CostInterval } from './costAttribution'
import { CostWhereItFalls, type CostStretchFocus } from './CostWhereItFalls'

// Twelve 10 m intervals, the last incomplete; a lump sum has no place on the road.
const amounts = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 0]
const intervals: CostInterval[] = amounts.map((_, k) => ({
  stationIndex: k + 1,
  start: k * 10,
  end: (k + 1) * 10,
  lengthM: 10,
  complete: k < 11,
}))
const placed = amounts.reduce((sum, value) => sum + value, 0)
const attribution: CostAttribution = {
  intervals,
  rows: [
    {
      rowId: 'cut',
      label: 'Cut',
      amount: placed,
      placed: amounts.map((value, k) => (k < 11 ? value : null)),
      placedTotal: placed,
      unplaced: 0,
      driverLabel: 'bank m³',
      quantity: amounts.map((value, k) => (k < 11 ? value / 2 : null)),
    },
    {
      rowId: 'mobilization',
      label: 'Mobilization',
      amount: 500,
      placed: amounts.map(() => 0),
      placedTotal: 0,
      unplaced: 500,
      unplacedReason: 'A lump sum for the whole road',
      driverLabel: '',
      quantity: amounts.map(() => null),
    },
  ],
  total: amounts,
  totalAmount: placed + 500,
  placedTotal: placed,
  unplacedTotal: 500,
}

type Node = ReactTestRenderer['root']
const textOf = (node: Node | string): string =>
  typeof node === 'string' ? node : node.children.map((child) => textOf(child as Node | string)).join('')
const stretchButtons = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.type === 'button' && String(node.props['aria-label'] ?? '').includes('plan'))

describe('where a cost row falls', () => {
  it('lists the costliest stretches with their quantity, and picks the governing station', () => {
    const onFocus = vi.fn<(focus: CostStretchFocus) => void>()
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(
        createElement(CostWhereItFalls, { attribution, id: 'cut', stretchLengthM: 20, onFocusStretch: onFocus }),
      )
    })
    const rows = stretchButtons(renderer)
    // Six 20 m stretches, five shown, costliest first.
    expect(rows).toHaveLength(5)
    expect(textOf(rows[0])).toBe('0+080.0–0+100.095 bank m³$190.0028.8% of the row')
    expect(textOf(rows[1])).toContain('0+060.0–0+080.0')
    expect(rows.map(textOf).find((text) => text.startsWith('0+100.0'))).toContain('55 bank m³ · 10 m unknown$110.00')
    act(() => rows[0].props.onClick())
    expect(onFocus).toHaveBeenCalledWith({
      rowId: 'cut',
      label: 'Cut',
      start: 80,
      end: 100,
      peakChainage: 100,
    })
    const showAll = renderer.root.find((node) => node.type === 'button' && textOf(node) === 'Show all 6 stretches')
    act(() => showAll.props.onClick())
    expect(stretchButtons(renderer)).toHaveLength(6)
    expect(textOf(renderer.root)).not.toContain('Not on the road')
  })

  it('shows the whole estimate with the part that has no place on the road', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(createElement(CostWhereItFalls, { attribution, id: 'total', stretchLengthM: 500 }))
    })
    expect(stretchButtons(renderer)).toHaveLength(1)
    expect(textOf(renderer.root)).toContain('Not on the road: $500.00')
    expect(textOf(renderer.root)).toContain('Mobilization $500.00 · A lump sum for the whole road')
  })
})
