import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { SymbolStyle, SymbolStyleDefaults } from '@/lib/mapSheet/symbolStyle'
import { SymbolStyleEditor } from './symbol-style-fields'

const DEFAULTS: SymbolStyleDefaults = {
  label: 'Old growth',
  color: '#4d7c0f',
  pattern: 'solid',
  dash: 'solid',
  width: 1,
  opacity: 0.2,
}

function render(value: SymbolStyle, onChange = vi.fn()) {
  let view!: ReactTestRenderer
  act(() => {
    view = create(<SymbolStyleEditor shape="area" defaults={DEFAULTS} value={value} onChange={onChange} label="Look" />)
  })
  const field = (label: string) =>
    view.root.find((node) => node.props.label === label && typeof node.props.onValueChange === 'function')
  return { view, field, onChange }
}

describe('organic hatch settings in the look editor', () => {
  it('shows them only for the organic pattern and saves only what differs from the default', () => {
    expect(
      render({ pattern: 'diagonal' }).view.root.findAll(
        (node) => node.props['data-organic-hatch-settings'] !== undefined,
      ),
    ).toHaveLength(0)
    const { field, onChange } = render({ pattern: 'organic', organic: { seed: 4 } })
    expect(field('Spacing').props.value).toBe(2.5)
    act(() => field('Spacing').props.onValueChange(3.5))
    expect(onChange).toHaveBeenLastCalledWith({ pattern: 'organic', organic: { seed: 4, spacing: 3.5 } })
    act(() => field('Seed').props.onValueChange(8))
    expect(onChange).toHaveBeenLastCalledWith({ pattern: 'organic' })
  })
})
