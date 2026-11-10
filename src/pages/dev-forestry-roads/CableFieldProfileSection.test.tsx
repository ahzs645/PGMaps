import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CableFieldProfileSection } from './CableFieldProfileSection'
import { EXAMPLE_RIGGING } from './cableMechanics'
import { offsetCoordinate } from './engine'
import { RiggingSetPicker } from './RiggingSetPicker'
import type { CableLine, Coordinate, TerrainSource } from './types'
import type { RiggingSet } from './dline/riggingSets'

vi.mock('./Controls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./Controls')>()),
  RoadSelect: (await import('./roadSelectTestDouble')).RoadSelectTestDouble,
}))
vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement('span', { 'aria-label': label }, children),
}))
vi.mock('./SidebarParts', () => ({
  RoadSection: ({ children }: { children: ReactNode }) => createElement('section', {}, children),
}))

let renderer: ReactTestRenderer | undefined
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
})
const text = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(text).join('')
const button = (root: ReactTestInstance, label: RegExp) =>
  root.find(
    (node) => node.type === 'button' && (label.test(text(node).trim()) || label.test(node.props['aria-label'] ?? '')),
  )

const start: Coordinate = [-122.72, 53.89]
const line: CableLine = {
  id: 'd1',
  name: 'D-line 1',
  start,
  end: offsetCoordinate(start, 90, 300),
  startHeight: 12,
  endHeight: 10,
  deflectionPercent: 5,
  sagModel: 'mechanics',
  rigging: EXAMPLE_RIGGING,
}
const flat: TerrainSource = { elevationAt: () => 1000 }

describe('field-measured ground', () => {
  it('reads pasted slope legs from the terrain at the yarder and applies them to the D-line', async () => {
    const onEdit = vi.fn()
    await act(async () => {
      renderer = create(createElement(CableFieldProfileSection, { line, terrain: flat, onEdit }))
    })
    const root = renderer!.root
    await act(async () =>
      root.findByProps({ 'aria-label': 'Field shots as' }).props.onChange({ target: { value: 'slope' } }),
    )
    await act(async () => button(root, /^Terrain$/).props.onClick())
    await act(async () =>
      root.findByProps({ 'aria-label': 'Field shots' }).props.onChange({ target: { value: '104.403, 30\n200, 0' } }),
    )
    await act(async () => button(root, /^Apply shots$/).props.onClick())
    const next = onEdit.mock.calls[0][0](line) as CableLine
    expect(next.fieldProfile).toMatchObject({ use: true, method: 'slope', startStationM: 0, startElevationM: 1000 })
    // The comparison shows each shot against the terrain once the line holds the profile.
    await act(async () =>
      renderer!.update(createElement(CableFieldProfileSection, { line: next, terrain: flat, onEdit })),
    )
    const table = root.findByProps({ 'data-testid': 'cable-field-table' })
    expect(table.findAllByType('tr')).toHaveLength(4)
    expect(text(root.findByProps({ 'data-testid': 'cable-field-comparison' }))).toMatch(
      /largest \+30\.00 m at 100\.0 m/,
    )
  })

  it('names the line it cannot read and leaves the D-line alone', async () => {
    const onEdit = vi.fn()
    await act(async () => {
      renderer = create(createElement(CableFieldProfileSection, { line, terrain: flat, onEdit }))
    })
    const root = renderer!.root
    await act(async () =>
      root.findByProps({ 'aria-label': 'Field shots' }).props.onChange({ target: { value: '0, 1000\n100 high' } }),
    )
    await act(async () => button(root, /^Apply shots$/).props.onClick())
    expect(onEdit).not.toHaveBeenCalled()
    expect(text(root)).toContain('Line 2: enter two numbers.')
  })
})

describe('rigging sets', () => {
  it('saves the rigging under a name, applies a set and deletes it', async () => {
    const onSetsChange = vi.fn()
    const onApply = vi.fn()
    const props = { sets: [] as RiggingSet[], rigging: EXAMPLE_RIGGING, onApply, onSetsChange, newId: () => 'set-1' }
    await act(async () => {
      renderer = create(createElement(RiggingSetPicker, props))
    })
    const root = renderer!.root
    expect(text(root)).toContain('Rigging not saved as a set')
    await act(async () => button(root, /^Save this rigging as a set$/).props.onClick())
    const name = root.findByProps({ 'aria-label': 'New rigging set name' })
    await act(async () => name.props.onChange({ target: { value: 'Madill 071' } }))
    await act(async () =>
      root
        .findByProps({ 'aria-label': 'New rigging set name' })
        .props.onKeyDown({ key: 'Enter', preventDefault: () => {} }),
    )
    const sets = onSetsChange.mock.calls[0][0] as RiggingSet[]
    expect(sets).toEqual([{ id: 'set-1', name: 'Madill 071', rigging: EXAMPLE_RIGGING }])
    // Edited rigging no longer matches; choosing the set applies it.
    const edited = { ...EXAMPLE_RIGGING, payloadKg: 1 }
    await act(async () => renderer!.update(createElement(RiggingSetPicker, { ...props, sets, rigging: edited })))
    expect(root.findByProps({ 'aria-label': 'Rigging set' }).props.value).toBe('')
    await act(async () =>
      root.findByProps({ 'aria-label': 'Rigging set' }).props.onChange({ target: { value: 'set-1' } }),
    )
    expect(onApply).toHaveBeenCalledWith(sets[0])
    expect(text(root)).toContain('Edited since Madill 071')
    await act(async () => button(root, /^Delete rigging set Madill 071$/).props.onClick())
    expect(onSetsChange.mock.calls.at(-1)![0]).toEqual([])
  })
})
