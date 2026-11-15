import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EXAMPLE_RIGGING } from './cableMechanics'
import { loadSkylineXlLibrary } from './cableEquipment/cableEquipment'
import { saveRiggingSet, type RiggingSet } from './dline/riggingSets'
import { RiggingSetPicker } from './RiggingSetPicker'

vi.mock('@/components/ui/dialog-shell', () => ({
  PanelDialog: ({ children, footer, title }: { children: ReactNode; footer: ReactNode; title: string }) =>
    createElement('div', { role: 'dialog', 'aria-label': title }, children, footer),
}))
vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement('span', { 'aria-label': label }, children),
}))
vi.mock('@/components/ui/map-panels', () => ({
  InlineAlert: ({ children }: { children: ReactNode }) => createElement('div', { role: 'note' }, children),
  KeyValueRows: ({ rows }: { rows: { label: string; value: string }[] }) =>
    createElement(
      'dl',
      {},
      rows.map((row) => `${row.label}: ${row.value}; `),
    ),
}))
vi.mock('./Controls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./Controls')>()),
  RoadSelect: (await import('./roadSelectTestDouble')).RoadSelectTestDouble,
  OptionalNumberField: ({
    label,
    value,
    onChange,
    description,
  }: {
    label: string
    value: number | null
    onChange: (value: number | null) => void
    description?: ReactNode
  }) =>
    createElement(
      'label',
      {},
      createElement('input', {
        'aria-label': label,
        value: value ?? '',
        onChange: (event: { target: { value: string } }) =>
          onChange(event.target.value ? Number(event.target.value) : null),
      }),
      description,
    ),
}))

let renderer: ReactTestRenderer | undefined
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
})
const text = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(text).join('')
const button = (root: ReactTestInstance, label: RegExp) =>
  root.find((node) => node.type === 'button' && label.test(text(node).trim()))
const choose = (root: ReactTestInstance, label: string, value: string) =>
  act(async () => root.findByProps({ 'aria-label': label }).props.onChange({ target: { value } }))

describe('Start a rigging set from equipment', () => {
  it('builds a set from SkylineXL, saves it with its equipment, and offers the spar height', async () => {
    const lib = await loadSkylineXlLibrary()
    const onSetsChange = vi.fn()
    const onApply = vi.fn()
    const onUse = vi.fn()
    let next = 0
    const props = {
      sets: [] as RiggingSet[],
      rigging: EXAMPLE_RIGGING,
      onApply,
      onSetsChange,
      newId: () => `set-${++next}`,
      yarderHeight: { valueM: 12, onUse },
    }
    await act(async () => {
      renderer = create(createElement(RiggingSetPicker, props))
    })
    const root = renderer!.root
    await act(async () => button(root, /^Start from equipment…$/).props.onClick())
    // The library loads lazily.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const dialog = root.findByProps({ role: 'dialog' })
    expect(text(dialog)).not.toContain('Reading the equipment library')
    expect(button(dialog, /^Save set$/).props.disabled).toBe(true)
    const yarder = lib.yarders.find((y) => y.id === 'madill-071-tower')!
    const mm = yarder.lines.skyline!.diameterMm
    const carriage = lib.carriages.find((c) => mm < c.skylineDiameterMm[0] - 1 || mm > c.skylineDiameterMm[1] + 1)!
    await choose(dialog, 'Yarder', yarder.id)
    await choose(dialog, 'Carriage', carriage.id)
    // SkylineXL's own check, shown without refusing the set.
    expect(text(dialog)).toContain(`outside ${carriage.name}'s`)
    expect(text(dialog)).toContain(
      `Not in SkylineXL: example value ${EXAMPLE_RIGGING.payloadKg.toLocaleString('en-CA')}`,
    )
    await choose(dialog, 'Payload (kg)', '2500')
    expect(text(dialog)).not.toContain(`example value ${EXAMPLE_RIGGING.payloadKg.toLocaleString('en-CA')}`)
    expect(text(dialog)).toContain(
      'From USDA Forest Service SkylineXL 25.0 (database updated 2024-11-01, public domain',
    )
    await act(async () => button(dialog, /^Save and use$/).props.onClick())
    const sets = onSetsChange.mock.calls[0][0] as RiggingSet[]
    expect(sets).toHaveLength(1)
    expect(sets[0]).toMatchObject({ id: 'set-1', name: `${yarder.name} + ${carriage.name}` })
    expect(sets[0].rigging.payloadKg).toBe(2500)
    expect(sets[0].equipment).toMatchObject({ origin: 'skylinexl', yarderId: yarder.id, carriageId: carriage.id })
    expect(onApply).toHaveBeenCalledWith(sets[0])
    expect(root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
    // Applied: the picker prints the set's provenance and offers the tower as the yarder height.
    await act(async () =>
      renderer!.update(createElement(RiggingSetPicker, { ...props, sets, rigging: sets[0].rigging })),
    )
    expect(text(root.findByProps({ 'data-testid': 'rigging-set-provenance' }))).toBe(sets[0].equipment!.provenance)
    await act(async () => button(root, /^Use as yarder height$/).props.onClick())
    expect(onUse).toHaveBeenCalledWith(yarder.towerHeightM)
    // Once the yarder stands at the spar height, nothing is offered.
    await act(async () =>
      renderer!.update(
        createElement(RiggingSetPicker, {
          ...props,
          sets,
          rigging: sets[0].rigging,
          yarderHeight: { valueM: yarder.towerHeightM, onUse },
        }),
      ),
    )
    expect(root.findAllByProps({ 'data-testid': 'rigging-set-spar-height' })).toHaveLength(0)
    // Edited and saved again under its name: the equipment stays, and the note names the change.
    const edited = { ...sets[0].rigging, carriageKg: sets[0].rigging.carriageKg + 100 }
    const resaved = saveRiggingSet(sets, sets[0].name, edited, undefined, props.newId)
    await act(async () =>
      renderer!.update(createElement(RiggingSetPicker, { ...props, sets: resaved, rigging: edited })),
    )
    expect(text(root.findByProps({ 'data-testid': 'rigging-set-provenance' }))).toMatch(
      /Changed in this project since: carriage mass\.$/,
    )
  })

  it('needs a skyline rope for a running yarder, and refuses a name another set has', async () => {
    const lib = await loadSkylineXlLibrary()
    const running = lib.yarders.find((y) => !y.lines.skyline)!
    const taken = saveRiggingSet([], 'Taken', EXAMPLE_RIGGING, undefined, () => 'taken')
    await act(async () => {
      renderer = create(
        createElement(RiggingSetPicker, {
          sets: taken,
          rigging: EXAMPLE_RIGGING,
          onApply: vi.fn(),
          onSetsChange: vi.fn(),
          newId: () => 'n',
        }),
      )
    })
    const root = renderer!.root
    await act(async () => button(root, /^Start from equipment…$/).props.onClick())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const dialog = root.findByProps({ role: 'dialog' })
    await choose(dialog, 'Yarder', running.id)
    await choose(dialog, 'Carriage', lib.carriages[0].id)
    expect(text(dialog)).toContain('choose the skyline rope to model')
    const rope = lib.ropes.find(
      (r) =>
        r.diameterMm >= lib.carriages[0].skylineDiameterMm[0] && r.diameterMm <= lib.carriages[0].skylineDiameterMm[1],
    )!
    await choose(dialog, 'Skyline rope', rope.id)
    expect(button(dialog, /^Save set$/).props.disabled).toBe(false)
    await choose(dialog, 'Equipment set name', 'taken')
    expect(text(dialog)).toContain('Another set has that name.')
    expect(button(dialog, /^Save set$/).props.disabled).toBe(true)
  })
})
