import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { balanceWhatIf } from './balanceLine'
import { BalanceLineOverlay, BalanceWhatIfPanel } from './MassHaulBalanceLine'

// The InfoTip's popover needs a browser window; render its text inline.
vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement('span', { 'aria-label': label }, children),
}))

const curve: [number, number][] = [
  [0, 0],
  [100, 500],
  [300, 0],
]
const frame = {
  left: 50,
  top: 20,
  plotWidth: 300,
  plotHeight: 100,
  x: (v: number) => 50 + v,
  y: (v: number) => 120 - v / 5,
}

let renderer: ReactTestRenderer | undefined
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
})
const text = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : text(child))).join('')

describe('what-if balance line', () => {
  it('offers one button while off, and opens at zero', async () => {
    const onOpen = vi.fn()
    await act(async () => {
      renderer = create(
        createElement(BalanceWhatIfPanel, {
          result: null,
          range: [0, 500],
          freeHaulM: 100,
          onLevel: vi.fn(),
          onOpen,
          onClose: vi.fn(),
          onStation: vi.fn(),
        }),
      )
    })
    const button = renderer!.root.find((node) => node.props['data-testid'] === 'road-mass-whatif-open')
    await act(async () => button.props.onClick())
    expect(onOpen).toHaveBeenCalled()
  })
  it('states the loops, totals and overhaul, labelled as a what-if, with reset and close', async () => {
    const onLevel = vi.fn(),
      onClose = vi.fn(),
      onStation = vi.fn()
    await act(async () => {
      renderer = create(
        createElement(BalanceWhatIfPanel, {
          result: balanceWhatIf(curve, 0, 100),
          range: [0, 500],
          freeHaulM: 100,
          onLevel,
          onOpen: vi.fn(),
          onClose,
          onStation,
        }),
      )
    })
    const panel = renderer!.root.find((node) => node.props['data-testid'] === 'road-mass-whatif')
    expect(text(panel)).toContain('What-if only: the design and the reported haul are unchanged.')
    const totals = renderer!.root.find((node) => node.props['data-testid'] === 'road-mass-whatif-totals')
    expect(text(totals)).toMatch(/^Moves 500 m³, 75,000 m³·m inside the road/)
    expect(text(totals)).toMatch(/1 closed loop balances 300 m of road/)
    expect(text(totals)).toMatch(/overhaul 33[34] m³, 33,333 m³·m past 100 m free haul/)
    const loop = renderer!.root
      .find((node) => node.props['data-testid'] === 'road-mass-whatif-loops')
      .findByType('button')
    expect(text(loop)).toMatch(/0\+000\.0–0\+300\.0 · 300 m: 500 m³ up-station · mean haul 150 m · overhaul 33[34] m³/)
    await act(async () => loop.props.onClick())
    expect(onStation).toHaveBeenCalledWith(0)
    const buttons = renderer!.root.findAllByType('button')
    await act(async () => buttons.find((b) => text(b) === 'Reset to 0')!.props.onClick())
    expect(onLevel).toHaveBeenCalledWith(0)
    await act(async () => buttons.find((b) => text(b) === 'Close what-if')!.props.onClick())
    expect(onClose).toHaveBeenCalled()
  })
  it('moves by keyboard within the curve’s range, and Escape turns it off', async () => {
    const onLevel = vi.fn(),
      onClose = vi.fn()
    await act(async () => {
      renderer = create(
        createElement(
          'svg',
          null,
          createElement(BalanceLineOverlay, {
            result: balanceWhatIf(curve, 250, null),
            range: [0, 500],
            frame,
            domainY: [0, 500],
            onLevel,
            onClose,
          }),
        ),
      )
    })
    const handle = renderer!.root.find((node) => node.props.role === 'slider')
    expect(handle.props['aria-valuenow']).toBe(250)
    const key = (k: string, shiftKey = false) => {
      const event = { key: k, shiftKey, preventDefault: vi.fn(), stopPropagation: vi.fn() }
      handle.props.onKeyDown(event)
      return event
    }
    expect(key('ArrowUp').stopPropagation).toHaveBeenCalled()
    expect(onLevel).toHaveBeenLastCalledWith(255)
    key('ArrowDown', true)
    expect(onLevel).toHaveBeenLastCalledWith(200)
    key('End')
    expect(onLevel).toHaveBeenLastCalledWith(500)
    // Left and right stay with the chart, which steps the station.
    expect(key('ArrowLeft').stopPropagation).not.toHaveBeenCalled()
    key('Escape')
    expect(onClose).toHaveBeenCalled()
    // The closed loop's two ends are ticked on the line.
    const line = renderer!.root.find((node) => node.props['data-testid'] === 'road-mass-balance-line')
    expect(line.findAllByType('line').filter((l) => l.props.y1 !== l.props.y2)).toHaveLength(2)
  })
})

describe('what-if totals with a loop at a road end', () => {
  it('says the volume moved includes a loop that runs to a road end, without claiming it balances road', async () => {
    // Above the line all the way: one loop open at both ends, nothing closed.
    const rising: [number, number][] = [
      [0, 100],
      [100, 600],
      [300, 200],
    ]
    await act(async () => {
      renderer = create(
        createElement(BalanceWhatIfPanel, {
          result: balanceWhatIf(rising, 0, null),
          range: [0, 600],
          freeHaulM: null,
          onLevel: vi.fn(),
          onOpen: vi.fn(),
          onClose: vi.fn(),
          onStation: vi.fn(),
        }),
      )
    })
    const totals = text(renderer!.root.find((node) => node.props['data-testid'] === 'road-mass-whatif-totals'))
    expect(totals).toMatch(/0 closed loops balance 0 m of road/)
    expect(totals).toMatch(/1 loop runs to a road end, where only its inner part balances/)
    expect(totals).not.toMatch(/Balances 0 m of road/)
  })

  it('hands focus back to the open button when the what-if closes from a focused control', async () => {
    const body = {}
    vi.stubGlobal('document', { activeElement: body, body })
    const focused: string[] = []
    const props = {
      range: [0, 500] as [number, number],
      freeHaulM: null,
      onLevel: vi.fn(),
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onStation: vi.fn(),
    }
    await act(async () => {
      renderer = create(createElement(BalanceWhatIfPanel, { ...props, result: balanceWhatIf(curve, 0, null) }), {
        createNodeMock: (element) => ({
          focus: () => focused.push(String(element.props['data-testid'] ?? element.type)),
        }),
      })
    })
    await act(async () => renderer!.update(createElement(BalanceWhatIfPanel, { ...props, result: null })))
    expect(focused).toEqual(['road-mass-whatif-open'])
    vi.unstubAllGlobals()
  })
})
