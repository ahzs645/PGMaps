import { createElement, useEffect, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlanViewBoundary } from './PlanViewBoundary'

let renderer: ReactTestRenderer | undefined
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
  vi.restoreAllMocks()
})

function MapView({ error }: { error: Error | null }) {
  // MapLibre is created in a mount effect. Exercise that failure path, not only a render error.
  useEffect(() => {
    if (error) throw error
  }, [error])
  return createElement('div', { 'data-map-view': true }, 'Plan map')
}

function ProfileView() {
  const [station, setStation] = useState(0)
  return createElement('button', { onClick: () => setStation(station + 10), 'data-profile': true }, station)
}

describe('the plan view error boundary', () => {
  it('keeps sibling view state through a map effect failure and retries only the map', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('Failed to initialize WebGL2')
    error.name = 'GPUInitializationError'
    const view = (error: Error | null) =>
      createElement(
        'main',
        {},
        createElement(ProfileView),
        createElement(PlanViewBoundary, { children: createElement(MapView, { error }) }),
      )
    act(() => {
      renderer = create(view(null))
    })
    act(() => renderer!.root.findByProps({ 'data-profile': true }).props.onClick())
    act(() => renderer!.update(view(error)))
    expect(renderer!.root.findByProps({ 'data-profile': true }).children).toEqual(['10'])
    expect(renderer!.root.findAllByProps({ 'data-map-view': true })).toHaveLength(0)
    expect(JSON.stringify(renderer!.toJSON())).toContain('WebGL 2 graphics are unavailable')

    // Updating the surrounding workspace leaves the fallback in place until the person retries.
    act(() => renderer!.update(view(null)))
    const retry = renderer!.root.findAllByType('button').find((button) => button.children.includes('Retry map'))!
    act(() => retry.props.onClick())
    expect(renderer!.root.findAllByProps({ 'data-map-view': true })).toHaveLength(1)
    expect(renderer!.root.findAllByProps({ 'data-testid': 'road-plan-unavailable' })).toHaveLength(0)
    expect(renderer!.root.findByProps({ 'data-profile': true }).children).toEqual(['10'])
  })

  it('uses a general explanation for a map failure unrelated to WebGL', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    act(() => {
      renderer = create(
        createElement(PlanViewBoundary, {
          children: createElement(MapView, { error: new Error('The map style could not be loaded.') }),
        }),
      )
    })
    expect(JSON.stringify(renderer!.toJSON())).toContain('The plan map could not start.')
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('The map style could not be loaded.')
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('WebGL 2 graphics are unavailable')
  })
})
