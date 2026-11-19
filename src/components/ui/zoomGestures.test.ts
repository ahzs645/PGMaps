import { describe, expect, it, vi } from 'vitest'

import { isZoomWheel, listenZoomGestures, wheelZoomFactor, zoomKey } from './zoomGestures'

describe('zoom gestures', () => {
  it('zooms a mouse notch by a held step and a pinch by its own small steps', () => {
    // A notch (about 100 pixels, or one line) is held to the same step either way.
    expect(wheelZoomFactor({ deltaY: -100, deltaMode: 0 })).toBeCloseTo(Math.exp(0.3))
    expect(wheelZoomFactor({ deltaY: -3, deltaMode: 1 })).toBeCloseTo(Math.exp(0.3))
    expect(wheelZoomFactor({ deltaY: 100, deltaMode: 0 })).toBeCloseTo(Math.exp(-0.3))
    // A pinch's step passes whole: in and out by the same amount cancel.
    const step = wheelZoomFactor({ deltaY: -4, deltaMode: 0 })
    expect(step).toBeCloseTo(Math.exp(0.04))
    expect(step * wheelZoomFactor({ deltaY: 4, deltaMode: 0 })).toBeCloseTo(1)
  })

  it('takes a zoom only with Ctrl (a pinch) or ⌘ held', () => {
    expect(isZoomWheel({ ctrlKey: true, metaKey: false })).toBe(true)
    expect(isZoomWheel({ ctrlKey: false, metaKey: true })).toBe(true)
    expect(isZoomWheel({ ctrlKey: false, metaKey: false })).toBe(false)
  })

  it('reads +, - and 0 as zoom keys, never while typing or with Alt', () => {
    const key = (k: string, extra: Partial<{ altKey: boolean; target: unknown }> = {}) =>
      zoomKey({ key: k, altKey: false, target: null, ...extra } as Parameters<typeof zoomKey>[0])
    expect(key('+')).toBe('in')
    expect(key('=')).toBe('in')
    expect(key('-')).toBe('out')
    expect(key('0')).toBe('fit')
    expect(key('a')).toBeNull()
    expect(key('+', { altKey: true })).toBeNull()
    expect(key('+', { target: { tagName: 'INPUT' } })).toBeNull()
    expect(key('0', { target: { isContentEditable: true } })).toBeNull()
  })

  it('zooms on a pinch or a Ctrl wheel, hands a plain wheel to its owner, and follows Safari’s pinch', () => {
    const target = new EventTarget()
    const onZoom = vi.fn()
    const onWheel = vi.fn(() => false)
    const stop = listenZoomGestures(target, onZoom, onWheel)

    const wheel = (init: Partial<WheelEvent>) =>
      Object.assign(new Event('wheel', { cancelable: true }), { deltaY: 0, deltaMode: 0, ...init })
    const pinch = wheel({ deltaY: -4, ctrlKey: true, clientX: 10, clientY: 20 } as Partial<WheelEvent>)
    target.dispatchEvent(pinch)
    expect(pinch.defaultPrevented).toBe(true)
    expect(onZoom).toHaveBeenLastCalledWith(expect.closeTo(Math.exp(0.04)), pinch)
    // A plain wheel scrolls: the viewer's owner sees it, and the browser keeps it unless the owner takes it.
    const scroll = wheel({ deltaY: 40 } as Partial<WheelEvent>)
    target.dispatchEvent(scroll)
    expect(onWheel).toHaveBeenCalledWith(scroll)
    expect(scroll.defaultPrevented).toBe(false)

    // Safari reports the whole gesture's scale; each change zooms by its ratio to the last.
    const gesture = (type: string, scale: number) =>
      Object.assign(new Event(type, { cancelable: true }), { scale, clientX: 5, clientY: 6 })
    target.dispatchEvent(gesture('gesturestart', 1))
    target.dispatchEvent(gesture('gesturechange', 1.5))
    target.dispatchEvent(gesture('gesturechange', 3))
    expect(onZoom.mock.calls.slice(-2).map(([factor]) => factor)).toEqual([1.5, 2])
    expect(onZoom).toHaveBeenLastCalledWith(2, { clientX: 5, clientY: 6 })

    stop()
    target.dispatchEvent(wheel({ deltaY: -4, ctrlKey: true } as Partial<WheelEvent>))
    expect(onZoom).toHaveBeenCalledTimes(3)
  })
})
