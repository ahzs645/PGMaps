import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CopyImageButton } from './copy-image-button'
import { SaveAsButton } from './save-as-button'

class FakeItem {
  constructor(readonly items: Record<string, Blob | Promise<Blob>>) {}
}

const text = (view: ReactTestRenderer) =>
  view.root
    .findAll((node) => typeof node.type === 'string')
    .flatMap((node) => node.children.filter((child): child is string => typeof child === 'string'))
    .join(' ')

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('CopyImageButton', () => {
  it('renders nothing where the browser cannot copy images, unless asked to explain', () => {
    // The (i) beside a disabled button reads the motion preference and animates.
    const media = { matches: false, addEventListener: () => {}, removeEventListener: () => {} }
    vi.stubGlobal('window', { matchMedia: () => media, addEventListener: () => {}, removeEventListener: () => {} })
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const none = { clipboard: null, ClipboardItem: null, isSecureContext: true }
    let view!: ReactTestRenderer
    act(() => {
      view = create(<CopyImageButton png={() => new Blob()} environment={none} />)
    })
    expect(view.toJSON()).toBeNull()
    act(() => {
      view.update(<CopyImageButton png={() => new Blob()} environment={none} whenUnsupported="explain" />)
    })
    expect(view.root.findAllByType('button')[0].props.disabled).toBe(true)
    expect(view.root.findAllByProps({ label: 'Why copying is unavailable' })).not.toHaveLength(0)
    act(() => view.unmount())
    vi.unstubAllGlobals()
  })

  it('starts the write inside the click and reports copied', async () => {
    const write = vi.fn(async (items: unknown[]) => {
      await (items[0] as FakeItem).items['image/png']
    })
    const png = vi.fn(async () => new Blob(['png'], { type: 'image/png' }))
    const onResult = vi.fn()
    let view!: ReactTestRenderer
    act(() => {
      view = create(
        <CopyImageButton
          png={png}
          onResult={onResult}
          environment={{ clipboard: { write }, ClipboardItem: FakeItem, isSecureContext: true }}
        />,
      )
    })
    await act(async () => {
      view.root.findAllByType('button')[0].props.onClick()
      expect(png).toHaveBeenCalledTimes(1)
      expect(write).toHaveBeenCalledTimes(1)
    })
    expect(onResult).toHaveBeenCalledWith({ copied: true })
    expect(text(view)).toContain('Copied')
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(text(view)).toContain('Copy image')
    act(() => view.unmount())
  })

  it('shows the failure’s reason', async () => {
    const write = vi.fn(async () => {
      throw new DOMException('denied', 'NotAllowedError')
    })
    let view!: ReactTestRenderer
    act(() => {
      view = create(
        <CopyImageButton
          png={() => new Blob(['png'], { type: 'image/png' })}
          environment={{ clipboard: { write }, ClipboardItem: FakeItem, isSecureContext: true }}
        />,
      )
    })
    await act(async () => {
      view.root.findAllByType('button')[0].props.onClick()
    })
    expect(text(view)).toContain('The browser did not allow copying')
    act(() => view.unmount())
  })
})

describe('SaveAsButton', () => {
  const pdf = { mime: 'application/pdf', extension: 'pdf', description: 'PDF document' }

  it('hides where there is no save dialog, unless asked to show', () => {
    let view!: ReactTestRenderer
    act(() => {
      view = create(
        <SaveAsButton
          suggestedName="a"
          fileType={pdf}
          content={() => 'x'}
          environment={{ showSaveFilePicker: null }}
        />,
      )
    })
    expect(view.toJSON()).toBeNull()
    act(() => {
      view.update(
        <SaveAsButton
          suggestedName="a"
          fileType={pdf}
          content={() => 'x'}
          environment={{ showSaveFilePicker: null, download: vi.fn() }}
          showWithoutPicker
        />,
      )
    })
    expect(view.root.findAllByType('button')).toHaveLength(1)
    act(() => view.unmount())
  })

  it('opens the dialog inside the click and reports the name chosen', async () => {
    const showSaveFilePicker = vi.fn(async () => ({
      name: 'chosen.pdf',
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    }))
    const onResult = vi.fn()
    let view!: ReactTestRenderer
    act(() => {
      view = create(
        <SaveAsButton
          suggestedName="sheet"
          fileType={pdf}
          content={() => 'x'}
          onResult={onResult}
          environment={{ showSaveFilePicker }}
        />,
      )
    })
    await act(async () => {
      view.root.findAllByType('button')[0].props.onClick()
      expect(showSaveFilePicker).toHaveBeenCalledTimes(1)
    })
    expect(onResult).toHaveBeenCalledWith({ outcome: 'saved', fileName: 'chosen.pdf' })
    expect(text(view)).toContain('Saved as chosen.pdf')
    act(() => view.unmount())
  })
})
