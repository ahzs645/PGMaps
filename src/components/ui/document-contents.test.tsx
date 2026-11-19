import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ContentsChoice, ContentsPart } from '@/lib/documentContents/contents'

import { DocumentContents, type DocumentContentsProps } from './document-contents'

vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement('aside', { 'aria-label': label }, children),
}))

vi.mock('@/components/ui/styled-select', async (actual) => ({
  ...(await actual<typeof import('./styled-select')>()),
  StyledSelect: (await import('./styledSelectTestDouble')).StyledSelectTestDouble,
}))

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
    PopoverContent: ({ children, role, ...props }: { children: React.ReactNode; role?: string }) =>
      useContext(Shown).open ? (
        <div role={role} aria-label={(props as { 'aria-label'?: string })['aria-label']}>
          {children}
        </div>
      ) : null,
  }
})

let renderer: ReactTestRenderer | undefined
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
})

const part = (key: string, extra: Partial<ContentsPart> = {}): ContentsPart => ({
  key,
  label: key.toUpperCase(),
  state: 'on',
  ...extra,
})

function render(props: Partial<DocumentContentsProps> & { parts: ContentsPart[] }) {
  const element = <DocumentContents subject="the report" data-testid="contents" {...props} />
  act(() => {
    if (renderer) renderer.update(element)
    else renderer = create(element)
  })
  return renderer!.root
}

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('')
const row = (root: ReactTestInstance, key: string) =>
  root.find((node) => node.type === 'li' && node.props['data-contents-row'] === key)
const checkbox = (scope: ReactTestInstance) =>
  scope.find((node) => node.type === 'input' && node.props['data-contents-focus'] === 'state')
const buttonNamed = (root: ReactTestInstance, name: string) =>
  root.find((node) => node.type === 'button' && (node.props['aria-label'] === name || textOf(node) === name))
const queryButton = (root: ReactTestInstance, name: string) =>
  root.findAll((node) => node.type === 'button' && (node.props['aria-label'] === name || textOf(node) === name))
const status = (root: ReactTestInstance) => textOf(root.find((node) => node.props.role === 'status'))
const announced = (root: ReactTestInstance) => textOf(root.find((node) => node.props['aria-live'] === 'polite'))
const keyEvent = (key: string) => ({
  altKey: true,
  key,
  target: null,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
})

describe('DocumentContents', () => {
  it('draws each part in print order and toggles a state', () => {
    const onState = vi.fn()
    const root = render({ parts: [part('a'), part('b', { state: 'off' }), part('c')], onState })
    const keys = root.findAll((node) => node.type === 'li').map((node) => node.props['data-contents-row'])
    expect(keys).toEqual(['a', 'b', 'c'])
    expect(checkbox(row(root, 'a')).props.checked).toBe(true)
    expect(checkbox(row(root, 'b')).props.checked).toBe(false)
    // A part left out keeps its place.
    expect(row(root, 'b').props['data-prints']).toBe('false')
    // Without a row lead the checkbox is labelled by the part's name.
    expect(textOf(row(root, 'a').find((node) => node.type === 'label'))).toBe('A')
    expect(status(root)).toBe('2 of 3 print')
    act(() => checkbox(row(root, 'b')).props.onChange({ target: { checked: true } }))
    expect(onState).toHaveBeenCalledWith('b', 'on')
    act(() => checkbox(row(root, 'a')).props.onChange({ target: { checked: false } }))
    expect(onState).toHaveBeenLastCalledWith('a', 'off')
    expect(
      root.find((node) => node.type === 'section' && node.props['data-testid'] === 'contents').props['aria-label'],
    ).toBe('Contents of the report')
  })

  it('sets every switchable part with All and None in one write', () => {
    const onStates = vi.fn()
    const parts = [
      part('a'),
      part('b', { state: 'off' }),
      part('lock', { locked: 'Always printed' }),
      part('gone', { unavailable: 'No culverts', state: 'off' }),
    ]
    const root = render({ parts, onState: vi.fn(), onStates })
    act(() => buttonNamed(root, 'All').props.onClick())
    expect(onStates).toHaveBeenLastCalledWith({ b: 'on' })
    act(() => buttonNamed(root, 'None').props.onClick())
    expect(onStates).toHaveBeenLastCalledWith({ a: 'off' })
  })

  it('draws a dropdown per row for three choices, named by stateLabel', () => {
    const choices: ContentsChoice[] = [
      { value: 'package', label: 'In package', included: true },
      { value: 'appendix', label: 'Appendix (separate PDF)', included: true },
      { value: 'omit', label: 'Leave out', included: false },
    ]
    const onState = vi.fn()
    const root = render({
      parts: [part('a', { state: 'package' }), part('b', { state: 'omit' })],
      choices,
      stateLabel: 'where it goes',
      onState,
      onStates: vi.fn(),
    })
    const select = row(root, 'b').find((node) => node.type === 'select')
    expect(select.props['aria-label']).toBe('B: where it goes')
    expect(select.props.value).toBe('omit')
    act(() => select.props.onChange({ target: { value: 'appendix' } }))
    expect(onState).toHaveBeenCalledWith('b', 'appendix')
    // All and None belong to two-state lists only.
    expect(queryButton(root, 'All')).toHaveLength(0)
    expect(status(root)).toBe('1 of 2 print')
  })

  it('shows a locked part with its text and no control, and an unavailable one disabled with its reason', () => {
    const root = render({
      parts: [
        part('cover', { locked: 'Always printed' }),
        part('culverts', { unavailable: 'No culverts on this road' }),
      ],
      onState: vi.fn(),
    })
    const cover = row(root, 'cover')
    expect(cover.findAll((node) => node.type === 'input')).toHaveLength(0)
    expect(textOf(cover)).toContain('Always printed')
    const culverts = row(root, 'culverts')
    expect(checkbox(culverts).props.disabled).toBe(true)
    expect(checkbox(culverts).props.checked).toBe(false)
    expect(textOf(culverts)).toContain('No culverts on this road')
  })

  it('moves a part with Alt and an arrow key and announces it', () => {
    const onMove = vi.fn()
    const root = render({ parts: [part('a'), part('b'), part('c')], onState: vi.fn(), onMove })
    const down = keyEvent('ArrowDown')
    act(() => row(root, 'b').props.onKeyDownCapture(down))
    expect(down.preventDefault).toHaveBeenCalled()
    expect(onMove).toHaveBeenCalledWith('b', 2, ['a', 'c', 'b'])
    expect(announced(root)).toBe('B, moved from 2 to 3 of 3')
    act(() => row(root, 'a').props.onKeyDownCapture(keyEvent('ArrowUp')))
    expect(onMove).toHaveBeenCalledTimes(1)
    // Without Alt the key is the control's own.
    const plain = { ...keyEvent('ArrowDown'), altKey: false }
    act(() => row(root, 'a').props.onKeyDownCapture(plain))
    expect(plain.preventDefault).not.toHaveBeenCalled()
  })

  it('moves a part from its menu, each item named with the part', () => {
    const onMove = vi.fn()
    const root = render({ parts: [part('a'), part('b'), part('c'), part('d')], onState: vi.fn(), onMove })
    act(() => buttonNamed(row(root, 'c'), "Options for 'C'").props.onClick())
    expect(buttonNamed(root, "Move 'C' up").props.disabled).toBe(false)
    expect(buttonNamed(root, "Move 'C' to bottom").props.disabled).toBe(false)
    act(() => buttonNamed(root, "Move 'C' to top").props.onClick())
    expect(onMove).toHaveBeenCalledWith('c', 0, ['c', 'a', 'b', 'd'])
    expect(announced(root)).toBe('C, moved from 3 to 1 of 4')
    // The menu closed.
    expect(queryButton(root, "Move 'C' up")).toHaveLength(0)
  })

  it('refuses a move across a pinned part and draws no grip on it', () => {
    const onMove = vi.fn()
    const root = render({
      parts: [part('cover', { pinned: true }), part('a'), part('b')],
      onState: vi.fn(),
      onMove,
    })
    expect(queryButton(row(root, 'cover'), "Options for 'COVER'")).toHaveLength(0)
    expect(row(root, 'cover').findAll((node) => node.props['data-contents-focus'] === 'grip')).toHaveLength(0)
    expect(row(root, 'a').findAll((node) => node.props['data-contents-focus'] === 'grip')).toHaveLength(1)
    act(() => row(root, 'a').props.onKeyDownCapture(keyEvent('ArrowUp')))
    expect(onMove).not.toHaveBeenCalled()
    act(() => buttonNamed(row(root, 'a'), "Options for 'A'").props.onClick())
    expect(buttonNamed(root, "Move 'A' up").props.disabled).toBe(true)
    expect(buttonNamed(root, "Move 'A' to top").props.disabled).toBe(true)
    expect(buttonNamed(root, "Move 'A' down").props.disabled).toBe(false)
  })

  it('keeps moves inside a group and draws each group with its count and switch', () => {
    const onMove = vi.fn()
    const onStates = vi.fn()
    const root = render({
      parts: [
        part('r1', { group: 'report' }),
        part('r2', { group: 'report', state: 'off' }),
        part('p1', { group: 'plot' }),
      ],
      groups: [
        { id: 'report', title: 'Report sections' },
        { id: 'plot', title: 'Plot book' },
      ],
      onState: vi.fn(),
      onStates,
      onMove,
    })
    expect(root.findAll((node) => node.type === 'h5').map(textOf)).toEqual(['Report sections', 'Plot book'])
    expect(textOf(root)).toContain('1 of 2')
    act(() => row(root, 'r2').props.onKeyDownCapture(keyEvent('ArrowDown')))
    expect(onMove).not.toHaveBeenCalled()
    // A part alone in its group cannot move, so it has no menu.
    expect(queryButton(row(root, 'p1'), "Options for 'P1'")).toHaveLength(0)
    const reportSwitch = root.find(
      (node) => node.type === 'input' && node.props['aria-label'] === 'Print every part of Report sections',
    )
    expect(reportSwitch.props.checked).toBe(false)
    act(() => reportSwitch.props.onChange())
    expect(onStates).toHaveBeenCalledWith({ r2: 'on' })
  })

  it('removes a part a person added, and adds one', () => {
    const onRemove = vi.fn()
    const onAdd = vi.fn()
    const root = render({
      parts: [part('a', { removable: true }), part('b')],
      onState: vi.fn(),
      onRemove,
      add: { label: 'Add a part…', options: [{ id: 'x', label: 'X' }], onAdd },
    })
    act(() => buttonNamed(row(root, 'a'), "Options for 'A'").props.onClick())
    act(() => buttonNamed(root, "Remove 'A'").props.onClick())
    expect(onRemove).toHaveBeenCalledWith('a')
    expect(announced(root)).toBe('A removed')
    const adder = root.find((node) => node.type === 'select' && node.props['aria-label'] === 'Add a part…')
    act(() => adder.props.onChange({ target: { value: 'x' } }))
    expect(onAdd).toHaveBeenCalledWith('x')
  })

  describe('presets', () => {
    const options = [
      { id: 'full', label: 'Full' },
      { id: 'short', label: 'Short' },
      { id: 'mine', label: 'Mine', saved: true },
    ]
    const presetSelect = (root: ReactTestInstance) =>
      root.find((node) => node.type === 'select' && node.props['aria-label'] === 'Preset for the report')
    const optionTexts = (select: ReactTestInstance) =>
      select.findAll((node) => node.type === 'option').map((node) => textOf(node))

    it('shows the chosen preset, marks it modified, and chooses another', () => {
      const onChoose = vi.fn()
      const onReset = vi.fn()
      let root = render({
        parts: [part('a')],
        onState: vi.fn(),
        presets: { options, value: 'short', onChoose, onReset },
      })
      expect(presetSelect(root).props.value).toBe('short')
      expect(buttonNamed(root, 'Reset').props.disabled).toBe(true)
      act(() => presetSelect(root).props.onChange({ target: { value: 'full' } }))
      expect(onChoose).toHaveBeenCalledWith('full')
      root = render({
        parts: [part('a')],
        onState: vi.fn(),
        presets: { options, value: 'short', modified: true, onChoose, onReset },
      })
      expect(optionTexts(presetSelect(root))).toContain('Short · modified')
      expect(buttonNamed(root, 'Reset').props.disabled).toBe(false)
      act(() => buttonNamed(root, 'Reset').props.onClick())
      expect(onReset).toHaveBeenCalled()
    })

    it('shows Custom when no preset matches', () => {
      const root = render({
        parts: [part('a')],
        onState: vi.fn(),
        presets: { options, value: null, onChoose: vi.fn() },
      })
      const select = presetSelect(root)
      const custom = select.find((node) => node.type === 'option' && textOf(node) === 'Custom')
      expect(custom.props.disabled).toBe(true)
      expect(select.props.value).toBe(custom.props.value)
      // Saved presets are listed apart.
      expect(select.find((node) => node.type === 'optgroup').props.label).toBe('Saved in this browser')
    })

    it('saves the contents as a preset under a typed name', () => {
      const onSaveAs = vi.fn()
      const root = render({
        parts: [part('a')],
        onState: vi.fn(),
        presets: { options, value: 'full', onChoose: vi.fn(), onSaveAs },
      })
      act(() => buttonNamed(root, 'Save as preset…').props.onClick())
      const input = root.find((node) => node.type === 'input' && node.props['aria-label'] === 'Preset name')
      act(() => input.props.onChange({ target: { value: '  Field copy ' } }))
      act(() => root.find((node) => node.type === 'form').props.onSubmit({ preventDefault: vi.fn() }))
      expect(onSaveAs).toHaveBeenCalledWith('Field copy')
      expect(root.findAll((node) => node.type === 'form')).toHaveLength(0)
    })

    it('deletes a saved preset after asking once, and offers no delete for a built-in one', () => {
      const onDelete = vi.fn()
      let root = render({
        parts: [part('a')],
        onState: vi.fn(),
        presets: { options, value: 'full', onChoose: vi.fn(), onDelete },
      })
      expect(queryButton(root, "Delete preset 'Full'")).toHaveLength(0)
      root = render({
        parts: [part('a')],
        onState: vi.fn(),
        presets: { options, value: 'mine', onChoose: vi.fn(), onDelete },
      })
      act(() => buttonNamed(root, "Delete preset 'Mine'").props.onClick())
      expect(onDelete).not.toHaveBeenCalled()
      const confirm = root.find(
        (node) => node.type === 'button' && textOf(node) === 'Delete' && !node.props['aria-label'],
      )
      act(() => confirm.props.onClick())
      expect(onDelete).toHaveBeenCalledWith('mine')
    })
  })

  it('selects a part for the preview and goes back to the whole document', () => {
    const onSelect = vi.fn()
    let root = render({
      parts: [part('a'), part('b')],
      onState: vi.fn(),
      onSelect,
      preview: <p>Preview</p>,
      previewLabel: 'Whole report',
    })
    const name = buttonNamed(row(root, 'b'), 'B')
    expect(name.props['aria-pressed']).toBe(false)
    act(() => name.props.onClick())
    expect(onSelect).toHaveBeenCalledWith('b')
    root = render({
      parts: [part('a'), part('b')],
      onState: vi.fn(),
      onSelect,
      selected: 'b',
      preview: <p>Preview</p>,
      previewLabel: 'Whole report',
    })
    expect(buttonNamed(row(root, 'b'), 'B').props['aria-pressed']).toBe(true)
    const preview = root.find((node) => node.props['data-contents-preview'] === '')
    expect(textOf(preview.find((node) => node.type === 'h4'))).toBe('B')
    act(() => buttonNamed(preview, 'Whole report').props.onClick())
    expect(onSelect).toHaveBeenLastCalledWith(null)
    // The checkbox keeps the part's name for a screen reader.
    expect(textOf(checkbox(row(root, 'a')).parent!)).toBe('A')
  })

  it('rings the row named by focusKey', () => {
    const root = render({ parts: [part('a'), part('b')], onState: vi.fn(), focusKey: 'b' })
    expect(row(root, 'b').props['data-focused']).toBe('true')
    expect(row(root, 'a').props['data-focused']).toBeUndefined()
  })

  it('is read-only without onState: no controls, no grips, no menus', () => {
    const root = render({
      parts: [part('a'), part('b', { state: 'off' })],
      summary: 'One PDF; 1 part left out.',
    })
    expect(root.findAll((node) => node.type === 'input' || node.type === 'select')).toHaveLength(0)
    expect(root.findAll((node) => node.props['data-contents-focus'] === 'grip')).toHaveLength(0)
    expect(queryButton(root, 'All')).toHaveLength(0)
    expect(status(root)).toBe('One PDF; 1 part left out.')
    expect(row(root, 'b').find((node) => node.props.role === 'img').props['aria-label']).toBe('Left out')
  })

  it('shows the caller’s row action and Usual order', () => {
    const onResetOrder = vi.fn()
    const root = render({
      parts: [part('a'), part('b')],
      onState: vi.fn(),
      onMove: vi.fn(),
      onResetOrder,
      rowAction: (entry) => <button type="button">Edit {entry.label}</button>,
    })
    expect(queryButton(row(root, 'a'), 'Edit A')).toHaveLength(1)
    act(() => buttonNamed(root, 'Usual order').props.onClick())
    expect(onResetOrder).toHaveBeenCalled()
  })

  it('leads a row with the caller’s picture inside its checkbox label, with its note beside it', () => {
    const onState = vi.fn()
    const root = render({
      parts: [
        part('seen', { detail: 'Captured' }),
        part('later', { state: 'off', note: 'To capture on Preview or Download' }),
        part('bare'),
      ],
      onState,
      rowLead: (entry) => (entry.key === 'bare' ? null : <img src={`${entry.key}.png`} alt="" className="w-16" />),
    })
    const later = row(root, 'later')
    const label = later.find((node) => node.type === 'label')
    const lead = label.find((node) => node.props['data-contents-lead'] === '')
    // Decoration only: the checkbox is still named by the part alone.
    expect(lead.props['aria-hidden']).toBe('true')
    expect(lead.findByType('img').props.src).toBe('later.png')
    // The picture comes before the name, inside the label, so a click on it toggles the part.
    expect(textOf(label)).toBe('LATERTo capture on Preview or Download')
    const note = label.find((node) => node.props.id && textOf(node) === 'To capture on Preview or Download')
    expect(checkbox(later).props['aria-describedby']).toContain(note.props.id)
    act(() => checkbox(later).props.onChange({ target: { checked: true } }))
    expect(onState).toHaveBeenCalledWith('later', 'on')
    // A word or two stays the row's detail; a row the caller gives no picture draws none.
    expect(textOf(row(root, 'seen'))).toContain('Captured')
    expect(row(root, 'bare').findAll((node) => node.props['data-contents-lead'] === '')).toHaveLength(0)
  })

  it('puts the picture after the state control and before the name when the name selects the part', () => {
    const root = render({
      parts: [part('a', { note: 'Changed since its capture' })],
      onState: vi.fn(),
      onSelect: vi.fn(),
      rowLead: () => <img src="a.png" alt="" />,
    })
    const items = row(root, 'a').children.filter((child): child is ReactTestInstance => typeof child !== 'string')
    const at = (test: (node: ReactTestInstance) => boolean) => items.findIndex((item) => item.findAll(test).length > 0)
    const control = at((node) => node.type === 'input')
    const lead = at((node) => node.props['data-contents-lead'] === '')
    const name = at((node) => node.type === 'button' && node.props['data-contents-focus'] === 'name')
    expect(control).toBeLessThan(lead)
    expect(lead).toBeLessThan(name)
    expect(textOf(row(root, 'a'))).toContain('Changed since its capture')
  })

  it('prints a part’s note on its own line after its locked text', () => {
    const root = render({
      parts: [part('first', { locked: 'Always written', note: 'No screenshot: View 2' })],
      onState: vi.fn(),
    })
    const lines = row(root, 'first').findAll((node) => node.type === 'span' && node.props.className === 'block')
    expect(lines.map(textOf)).toEqual(['Always written', 'No screenshot: View 2'])
  })
})
