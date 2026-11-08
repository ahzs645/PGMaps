import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { Field } from './Controls'
import { RoadDeactivationEditor } from './RoadDeactivationEditor'
import type { RoadDeactivationEvidence } from './roadHistory'

vi.mock('./Controls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./Controls')>()),
  RoadSelect: (await import('./roadSelectTestDouble')).RoadSelectTestDouble,
}))
vi.mock('@/components/ui/map-panels', () => ({
  CollapsibleSection: ({ children }: { children: ReactNode }) => createElement('section', {}, children),
  InlineAlert: ({ children }: { children: ReactNode }) => createElement('div', { role: 'alert' }, children),
}))
vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement('aside', { 'aria-label': label }, children),
}))

it('stages event dates and provenance together, rejects invalid history and protects a newer source record', async () => {
  let value: RoadDeactivationEvidence | undefined
  let renderer!: ReactTestRenderer
  const saved = vi.fn((next: RoadDeactivationEvidence) => {
    value = next
    renderer.update(view())
  })
  const view = () => createElement(RoadDeactivationEditor, { value, onChange: saved })
  await act(async () => {
    renderer = create(view())
  })
  const button = (label: string) =>
    renderer.root.findAllByType('button').find((node) => node.children.join('') === label)!
  const input = (label: string) =>
    renderer.root
      .findAllByType(Field)
      .find((field) => field.props.label === label)!
      .findByType('input')
  const change = async (label: string, text: string) => {
    await act(async () => input(label).props.onChange({ target: { value: text } }))
  }
  try {
    await act(async () =>
      renderer.root
        .findByProps({ 'aria-label': 'Recorded physical status' })
        .props.onChange({ target: { value: 'deactivated' } }),
    )
    await act(async () => button('Save road history').props.onClick())
    expect(saved).not.toHaveBeenCalled()
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toMatch(/reference/)
    await change('Road event source reference', 'Example report D-12')
    await change('Deactivated on (known event date)', '2026-02-30')
    await act(async () => button('Save road history').props.onClick())
    expect(saved).not.toHaveBeenCalled()
    await change('Deactivated on (known event date)', '2016-09-15')
    expect(value).toBeUndefined()
    await act(async () => button('Save road history').props.onClick())
    expect(saved).toHaveBeenCalledTimes(1)
    expect(value).toMatchObject({
      status: 'deactivated',
      reference: 'Example report D-12',
      deactivatedOn: '2016-09-15',
    })

    await change('Road event source reference', 'Unsaved old draft')
    value = {
      status: 'reactivated',
      basis: 'source-record',
      reference: 'New completion report',
      reactivatedOn: '2026-06-01',
    }
    await act(async () => renderer.update(view()))
    expect(button('Save road history').props.disabled).toBe(true)
    await act(async () => button('Save road history').props.onClick())
    expect(saved).toHaveBeenCalledTimes(1)
    await act(async () => button('Reload evidence').props.onClick())
    expect(input('Road event source reference').props.value).toBe('New completion report')
    expect(input('Reactivated on (known event date)').props.value).toBe('2026-06-01')
  } finally {
    await act(async () => renderer.unmount())
  }
})
