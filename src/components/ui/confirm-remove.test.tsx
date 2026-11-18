import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

import { ConfirmRemoveButton } from './confirm-remove'

// The application's popover is a portal into the page; here it is the same open state without one.
vi.mock('@/components/ui/popover', async () => {
  const { cloneElement, createContext, useContext } = await import('react')
  type State = { open: boolean; onOpenChange: (open: boolean) => void }
  const Shown = createContext<State>({ open: false, onOpenChange: () => undefined })
  return {
    Popover: ({ children, ...state }: State & { children: React.ReactNode }) => (
      <Shown.Provider value={state}>{children}</Shown.Provider>
    ),
    PopoverTrigger: ({ children }: { children: React.ReactElement<{ onClick?: () => void }> }) => {
      const state = useContext(Shown)
      return cloneElement(children, { onClick: () => state.onOpenChange(!state.open) })
    },
    PopoverContent: ({ children, role }: { children: React.ReactNode; role?: string }) =>
      useContext(Shown).open ? <div role={role}>{children}</div> : null,
  }
})

function render(onConfirm = vi.fn()) {
  let view: ReturnType<typeof create>
  act(() => {
    view = create(
      <ConfirmRemoveButton
        label="Remove a.HEIC"
        question="Remove a.HEIC?"
        detail="Its record goes with it."
        onConfirm={onConfirm}
      />,
    )
  })
  return { view: view!, onConfirm }
}
const buttons = (view: ReturnType<typeof create>) => view.root.findAllByType('button')
const text = (button: ReturnType<typeof buttons>[number]) =>
  button.children.filter((child) => typeof child === 'string').join('')
// The popover's own element, not the component that may render it.
const asked = (view: ReturnType<typeof create>) =>
  view.root.findAll((node) => node.type === 'div' && node.props.role === 'alertdialog').length > 0

describe('ConfirmRemoveButton', () => {
  it('asks in a popover before it removes: the bin acts on nothing', () => {
    const { view, onConfirm } = render()
    expect(buttons(view)).toHaveLength(1)
    expect(buttons(view)[0].props['aria-label']).toBe('Remove a.HEIC')
    act(() => buttons(view)[0].props.onClick())
    expect(onConfirm).not.toHaveBeenCalled()
    expect(asked(view)).toBe(true)
    expect(view.root.findAllByType('p').map((p) => p.children.join(''))).toEqual([
      'Remove a.HEIC?',
      'Its record goes with it.',
    ])
    expect(buttons(view).slice(1).map(text)).toEqual(['Keep', 'Remove'])
    act(() => view.unmount())
  })

  it('gives Keep and Remove one size', () => {
    const { view } = render()
    act(() => buttons(view)[0].props.onClick())
    const [keep, remove] = buttons(view).slice(1)
    const height = (button: typeof keep) => /\bh-\d+\b/.exec(button.props.className)?.[0]
    expect(height(keep)).toBeTruthy()
    expect(height(remove)).toBe(height(keep))
    act(() => view.unmount())
  })

  it('removes on Remove and closes', () => {
    const { view, onConfirm } = render()
    act(() => buttons(view)[0].props.onClick())
    act(() => buttons(view)[2].props.onClick())
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(asked(view)).toBe(false)
    act(() => view.unmount())
  })

  it('keeps on Keep', () => {
    const { view, onConfirm } = render()
    act(() => buttons(view)[0].props.onClick())
    act(() => buttons(view)[1].props.onClick())
    expect(asked(view)).toBe(false)
    expect(onConfirm).not.toHaveBeenCalled()
    act(() => view.unmount())
  })
})
