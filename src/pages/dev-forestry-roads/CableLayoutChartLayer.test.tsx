import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EXAMPLE_RIGGING } from './cableMechanics'
import type { EditedLayout } from './cableLayout/layoutEdit'
import { layoutOverlay } from './cableLayout/overlay'
import { DEFAULT_SUPPORT_LAYOUT, layoutRun } from './cableLayout/settings'
import type { CableChartEdit } from './cableLayout/useLayoutEdit'
import { CableLayoutChartLayer, handleAfterDelete, markLabelPlacement } from './CableLayoutChartLayer'
import { offsetCoordinate } from './engine'
import type { CableLine, Coordinate, TerrainSource } from './types'

const start: Coordinate = [-122.72, 53.89]
const slope: TerrainSource = { elevationAt: (lng) => 1000 - (lng - start[0]) * 20_000 }
const edited: EditedLayout = {
  origin: 'hand',
  preTensionKN: 90,
  start: { heightM: 12 },
  end: { heightM: 10 },
  supports: [
    { stationM: 100, heightM: 14 },
    { stationM: 200, heightM: 12 },
  ],
}
const line: CableLine = {
  id: 'd1',
  name: 'D-line',
  start,
  end: offsetCoordinate(start, 90, 300),
  startHeight: 12,
  endHeight: 10,
  deflectionPercent: 5,
  sagModel: 'mechanics',
  rigging: EXAMPLE_RIGGING,
  supportLayout: { ...DEFAULT_SUPPORT_LAYOUT, edited },
}
const frame = {
  left: 50,
  top: 24,
  bottom: 36,
  plotWidth: 600,
  plotHeight: 200,
  x: (v: number) => 50 + v * 2,
  y: (v: number) => 224 - (v - 850),
}

let renderer: ReactTestRenderer | undefined
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
})

/** The chart layer over an edit of `line`, its rope check still pending. */
function element(edit: CableChartEdit) {
  const prepared = layoutRun(line, slope, line.supportLayout!)
  if (!prepared.ok) throw Error(prepared.error)
  const run = prepared.run
  const overlay = layoutOverlay(run, line.supportLayout!, null, {
    edited: { layout: edit.edited!, profile: run.input.profile, towerHeightM: 12, pending: true },
  })
  return createElement(
    'svg',
    null,
    createElement(CableLayoutChartLayer, { layout: overlay, edit, frame, domain: [0, 300, 850, 1050], height: 260 }),
  )
}

describe('the D-line chart layer', () => {
  it('picks the next handle after a delete, else the previous one, else the end', () => {
    expect(handleAfterDelete(0, 1)).toBe(0)
    expect(handleAfterDelete(1, 1)).toBe(0)
    expect(handleAfterDelete(0, 0)).toBe('end')
  })

  it('keeps a mark label inside the plot near its right edge', () => {
    const plot = { left: 50, right: 650 }
    expect(markLabelPlacement(100, 'clearance 8.6 m', 9, plot)).toEqual({ x: 103, anchor: 'start' })
    const right = markLabelPlacement(640, 'clearance 8.6 m', 9, plot)
    expect(right).toEqual({ x: 637, anchor: 'end' })
  })

  it('moves the focus to the next handle after Delete, and titles an end handle for height only', async () => {
    const commit = vi.fn()
    const edit: CableChartEdit = {
      edited,
      settings: line.supportLayout!,
      lengthM: 300,
      yarderAtEnd: false,
      commit,
      preview: vi.fn(),
      addSupport: vi.fn(),
      addSector: vi.fn(),
    }
    const focused: string[] = []
    await act(async () => {
      renderer = create(element(edit), {
        createNodeMock: (node) => ({
          focus: () => focused.push(String(node.props['data-support-handle'] ?? node.type)),
        }),
      })
    })
    const handles = () =>
      renderer!.root.findAll(
        (n: ReactTestInstance) => n.type === 'circle' && n.props['data-testid'] === 'road-cable-support-handle',
      )
    expect(handles().map((h) => h.props['data-support-handle'])).toEqual([0, 1, 'end'])
    const title = (h: ReactTestInstance) => String(h.findByType('title').children.join(''))
    expect(title(handles()[0])).toMatch(/drag sideways to move/)
    expect(title(handles()[2])).toBe('End support: drag up or down to change the height')
    const keys = { preventDefault: vi.fn(), stopPropagation: vi.fn(), shiftKey: false }
    // Delete support 1: support 2 takes index 0, and the focus stays on the handle at index 0.
    await act(async () => handles()[0].props.onKeyDown({ ...keys, key: 'Delete' }))
    expect(commit.mock.calls[0][0].supports).toEqual([edited.supports[1]])
    expect(focused).toEqual(['0'])
    // Delete the last support: the focus goes to the one before it.
    await act(async () => handles()[1].props.onKeyDown({ ...keys, key: 'Delete' }))
    expect(focused).toEqual(['0', '0'])
  })
})
