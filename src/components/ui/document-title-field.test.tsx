import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

import { DocumentTitleField } from './document-title-field'

// The (i) is a portal bubble; here its text inline.
vi.mock('./info-tip', () => ({ InfoTip: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }))

/** Everything a rendered tree says, joined. */
const said = (node: unknown): string =>
  typeof node === 'string'
    ? node
    : Array.isArray(node)
      ? node.map(said).join('')
      : node && typeof node === 'object' && 'children' in node
        ? said((node as { children: unknown }).children)
        : ''

function render(value: string | undefined, onChange = vi.fn()) {
  let view!: ReactTestRenderer
  act(() => {
    view = create(<DocumentTitleField value={value} follows="Tabor Main" onChange={onChange} />)
  })
  const input = () => view.root.findByType('input')
  return { view, input, onChange }
}

describe('DocumentTitleField', () => {
  it('shows the followed name as its placeholder while no title is set', () => {
    const { input, view } = render(undefined)
    expect(input().props.value).toBe('')
    expect(input().props.placeholder).toBe('Tabor Main')
    expect(said(view.toJSON())).toContain('Follows the project name')
  })

  it('stores a typed title, keeps a trailing space while typing, and clears back to following', () => {
    const { input, onChange, view } = render(undefined)
    act(() => input().props.onChange({ target: { value: 'Haul' } }))
    expect(onChange).toHaveBeenLastCalledWith('Haul')
    act(() => view.update(<DocumentTitleField value="Haul" follows="Tabor Main" onChange={onChange} />))
    act(() => input().props.onChange({ target: { value: 'Haul ' } }))
    // The stored title is unchanged ("Haul"), so nothing is written, and the space stays in the box.
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(input().props.value).toBe('Haul ')
    act(() => input().props.onChange({ target: { value: '' } }))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })

  it('offers to follow the name again once a title is set', () => {
    const { view, onChange } = render('Haul road')
    const button = view.root.findAll(
      (node) => node.type === 'button' && said(node.children) === 'Follow the project name',
    )[0]
    act(() => button.props.onClick())
    expect(onChange).toHaveBeenCalledWith(undefined)
  })
})
