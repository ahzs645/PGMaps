import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CopyButton } from '@/components/ui/copy-button'

let renderer: ReactTestRenderer | undefined
afterEach(() => {
  if (renderer) act(() => renderer?.unmount())
  renderer = undefined
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('shared copy button', () => {
  it('exposes manual-copy feedback instead of a false success when support is absent', async () => {
    vi.stubGlobal('navigator', {})
    const onResult = vi.fn()
    act(() => {
      renderer = create(<CopyButton text="original link" onResult={onResult} failedLabel="Select link to copy" />)
    })
    await act(async () => {
      await renderer!.root.findByType('button').props.onClick()
    })
    expect(renderer!.root.findByType('button').children).toEqual(['Select link to copy'])
    expect(onResult).toHaveBeenCalledWith({ copied: false, text: 'original link' })
  })

  it('disables pending copies and does not invoke a host callback after unmount', async () => {
    let resolve!: () => void
    const writeText = () =>
      new Promise<void>((done) => {
        resolve = done
      })
    const onResult = vi.fn()
    act(() => {
      renderer = create(<CopyButton text="link" options={{ writeText }} onResult={onResult} />)
    })
    let pending!: Promise<void>
    act(() => {
      pending = renderer!.root.findByType('button').props.onClick()
    })
    expect(renderer!.root.findByType('button').props.disabled).toBe(true)
    act(() => renderer!.unmount())
    renderer = undefined
    await act(async () => {
      resolve()
      await pending
    })
    expect(onResult).not.toHaveBeenCalled()
  })

  it('cleans its feedback timer on unmount', async () => {
    vi.useFakeTimers()
    act(() => {
      renderer = create(<CopyButton text="link" options={{ writeText: vi.fn() }} />)
    })
    await act(async () => {
      await renderer!.root.findByType('button').props.onClick()
    })
    expect(renderer!.root.findByType('button').children).toEqual(['Copied'])
    expect(vi.getTimerCount()).toBe(1)
    act(() => renderer!.unmount())
    renderer = undefined
    expect(vi.getTimerCount()).toBe(0)
  })
})
