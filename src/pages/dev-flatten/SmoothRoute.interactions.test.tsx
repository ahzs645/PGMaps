import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SmoothRoute } from './SmoothRoute'

vi.mock('@/components/ui/map', () => ({
  MapRoute: (props: { id: string; coordinates: number[][]; opacity: number; opacityTransitionMs: number }) => (
    <div
      data-route={props.id}
      data-coordinates={props.coordinates}
      data-opacity={props.opacity}
      data-transition={props.opacityTransitionMs}
    />
  ),
}))
afterEach(() => vi.unstubAllGlobals())

describe('persistent route crossfade', () => {
  it('rotates both persistent buffers without losing the previous route or flipping on an unchanged input', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const a: [number, number][] = [
        [0, 0],
        [1, 1],
      ],
      b: [number, number][] = [
        [0, 0],
        [2, 2],
      ],
      c: [number, number][] = [
        [0, 0],
        [3, 3],
      ]
    let view: ReturnType<typeof create>
    act(() => {
      view = create(<SmoothRoute coordinates={a} />)
    })
    try {
      const route = (id: string) => view!.root.findByProps({ 'data-route': id })
      expect(route('flatten-selected').props['data-opacity']).toBe(1)
      act(() => view!.update(<SmoothRoute coordinates={b} />))
      expect(route('flatten-selected').props['data-coordinates']).toBe(a)
      expect(route('flatten-selected').props['data-opacity']).toBe(0)
      expect(route('flatten-selected-next').props['data-coordinates']).toBe(b)
      expect(route('flatten-selected-next').props['data-opacity']).toBe(1)
      act(() => view!.update(<SmoothRoute coordinates={b} />))
      expect(route('flatten-selected-next').props['data-opacity']).toBe(1)
      act(() => view!.update(<SmoothRoute coordinates={c} />))
      expect(route('flatten-selected').props['data-coordinates']).toBe(c)
      expect(route('flatten-selected').props['data-opacity']).toBe(1)
      expect(route('flatten-selected-next').props['data-coordinates']).toBe(b)
      expect(route('flatten-selected').props['data-transition']).toBe(160)
    } finally {
      act(() => view!.unmount())
    }
  })

  it('retains the reduced-motion setting', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    let view: ReturnType<typeof create>
    act(() => {
      view = create(
        <SmoothRoute
          coordinates={[
            [0, 0],
            [1, 1],
          ]}
        />,
      )
    })
    try {
      expect(view!.root.findByProps({ 'data-route': 'flatten-selected' }).props['data-transition']).toBe(0)
    } finally {
      act(() => view!.unmount())
    }
  })
})
