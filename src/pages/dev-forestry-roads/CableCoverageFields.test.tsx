import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CableCoverageFields } from './CableCoverageFields'
import { DEFAULT_CABLE_RULE, type CableCoverageRule } from './cableCoverageRule'
import { EXAMPLE_RIGGING } from './cableMechanics'
import { saveRiggingSet } from './dline/riggingSets'

vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children }: { children: ReactNode }) => createElement('aside', {}, children),
}))

let renderer: ReactTestRenderer | undefined
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
})
const text = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(text).join('')

describe('the yarder’s rigging set', () => {
  it('applies a set with its own restore, since the header Undo does not cover panel settings', async () => {
    const heavy = { ...EXAMPLE_RIGGING, ropeDiameterMm: 25, payloadKg: 4000 }
    const sets = saveRiggingSet([], 'Heavy', heavy, undefined, () => 'heavy')
    let rule: CableCoverageRule = DEFAULT_CABLE_RULE
    const draw = () =>
      createElement(CableCoverageFields, {
        rule,
        onRule: (update) => {
          rule = update(rule)
        },
        riggingSets: { sets, onSetsChange: vi.fn() },
      })
    await act(async () => {
      renderer = create(draw())
    })
    const root = renderer!.root
    const undoRow = () =>
      root.findAll((n) => n.props['data-testid'] === 'yarder-set-undo' && typeof n.type === 'string')
    expect(undoRow()).toHaveLength(0)
    const picker = root.find((n) => n.props.ariaLabel === 'Rigging set' && typeof n.props.onValueChange === 'function')
    await act(async () => picker.props.onValueChange('heavy'))
    expect(rule.rigging.payloadKg).toBe(4000)
    await act(async () => renderer!.update(draw()))
    expect(text(undoRow()[0])).toMatch(/Heavy applied to the yarder.*Restore previous rigging.*header Undo does not/)
    const restore = undoRow()[0].find((n) => n.type === 'button')
    await act(async () => restore.props.onClick())
    expect(rule.rigging).toEqual(DEFAULT_CABLE_RULE.rigging)
    expect(rule.maxBreakDeg).toBe(DEFAULT_CABLE_RULE.maxBreakDeg)
    await act(async () => renderer!.update(draw()))
    expect(undoRow()).toHaveLength(0)
  })
})
