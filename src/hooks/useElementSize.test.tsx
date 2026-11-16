import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useElementSize, type ElementSize, type ElementSizeOptions } from './useElementSize'
import { nextFold, useSizeFold, type FoldThresholds } from './useSizeFold'

let renderer: ReactTestRenderer | undefined
afterEach(() => {
  if (renderer) act(() => renderer?.unmount())
  renderer = undefined
  vi.unstubAllGlobals()
})

/** An element whose box the test sets, and the ResizeObserver callback watching it. */
function fakeElement(size: ElementSize) {
  let box = size
  const observers: (() => void)[] = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: () => void) {}
      observe() {
        observers.push(this.callback)
      }
      disconnect() {
        observers.splice(observers.indexOf(this.callback), 1)
      }
    },
  )
  const element = { getBoundingClientRect: () => ({ ...box }) } as unknown as Element
  return {
    element,
    resize(next: ElementSize) {
      box = next
      act(() => observers.forEach((callback) => callback()))
    },
    observing: () => observers.length,
  }
}

function measure(element: Element, options?: ElementSizeOptions) {
  const seen: ElementSize[] = []
  function Probe() {
    seen.push(useElementSize(element, options))
    return null
  }
  act(() => {
    renderer = create(<Probe />)
  })
  return seen
}

describe('useElementSize', () => {
  it('reports the size measured on mount, then each change, without re-rendering for the same size', () => {
    const fake = fakeElement({ width: 300, height: 200 })
    const seen = measure(fake.element)
    expect(seen.at(-1)).toEqual({ width: 300, height: 200 })
    const renders = seen.length
    fake.resize({ width: 300, height: 200 })
    expect(seen.length).toBe(renders)
    fake.resize({ width: 320, height: 200 })
    expect(seen.at(-1)).toEqual({ width: 320, height: 200 })
  })

  it('keeps the last size while the element is hidden, unless told to keep every measurement', () => {
    const fake = fakeElement({ width: 300, height: 200 })
    const seen = measure(fake.element)
    fake.resize({ width: 0, height: 0 })
    expect(seen.at(-1)).toEqual({ width: 300, height: 200 })
    act(() => renderer?.unmount())
    renderer = undefined
    const every = measure(fake.element, { accept: () => true })
    fake.resize({ width: 0, height: 0 })
    expect(every.at(-1)).toEqual({ width: 0, height: 0 })
  })

  it('reports the initial size until there is an element, and stops observing on unmount', () => {
    const fake = fakeElement({ width: 300, height: 200 })
    const seen: ElementSize[] = []
    function Probe() {
      seen.push(useElementSize(null, { initial: { width: 640, height: 400 } }))
      return null
    }
    act(() => {
      renderer = create(<Probe />)
    })
    expect(seen.at(-1)).toEqual({ width: 640, height: 400 })
    measure(fake.element)
    expect(fake.observing()).toBe(1)
    act(() => renderer?.unmount())
    renderer = undefined
    expect(fake.observing()).toBe(0)
  })
})

describe('size folds', () => {
  const chart: FoldThresholds = { foldBelow: 260, unfoldFrom: 284 }

  it('folds below one size and unfolds only from a larger one', () => {
    expect(nextFold(false, 258, chart)).toBe(true)
    expect(nextFold(true, 274, chart)).toBe(true)
    expect(nextFold(true, 284, chart)).toBe(false)
    expect(nextFold(false, 274, chart)).toBe(false)
  })

  it('keeps its state while the size is unmeasured or hidden', () => {
    expect(nextFold(true, 0, chart)).toBe(true)
    expect(nextFold(false, Number.NaN, chart)).toBe(false)
  })

  it('refuses a fold that would unfold below where it folds', () => {
    expect(() => nextFold(false, 100, { foldBelow: 260, unfoldFrom: 250 })).toThrow('must unfold at or above')
  })

  // The loop the gap prevents: folding gives the slot back 16 px of the panel's grip reserve.
  it('settles where a fold that changes its own size would otherwise flip every render', () => {
    const states: boolean[] = []
    let slot = 258
    function Slot() {
      const folded = useSizeFold(slot, chart)
      states.push(folded)
      return null
    }
    act(() => {
      renderer = create(<Slot />)
    })
    for (let frame = 0; frame < 6; frame++) {
      slot = states.at(-1) ? 274 : 258
      act(() => renderer?.update(<Slot />))
    }
    expect(new Set(states.slice(1))).toEqual(new Set([true]))
  })
})
