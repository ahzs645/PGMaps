import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { RockCutFields, rockCutSummary } from './RockCutFields'
import { ROCK_CUT_DEFAULTS } from './rockExcavation'
import type { RockCutTemplate, RoadTemplate } from './types'

const base: RoadTemplate = {
  leftWidth: 3,
  rightWidth: 3,
  crossfallPercent: 3,
  cutSlope: 0.75,
  fillSlope: 1.5,
  ditchWidth: 1,
  ditchDepth: 0.5,
  surfaceDepth: 0.25,
}
function mount(template: RoadTemplate) {
  const changes: (RockCutTemplate | undefined)[] = []
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(createElement(RockCutFields, { template, onChange: (value) => changes.push(value) }))
  })
  const button = (text: RegExp) =>
    renderer.root.findAll((node) => node.type === 'button' && text.test(String(node.props.children)))[0]
  return { renderer, changes, button }
}

describe('rock cut fields', () => {
  // The fields' explanations are tips that read the viewport; the renderer has none.
  beforeAll(() => {
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    })
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })
  afterAll(() => vi.unstubAllGlobals())
  it('starts off, and turns on with Lima VVA’s starting values', () => {
    const { changes, button, renderer } = mount(base)
    expect(renderer.root.findAllByType('input')).toHaveLength(0)
    act(() => button(/Cut rock with this template/).props.onClick())
    expect(changes).toEqual([ROCK_CUT_DEFAULTS])
    expect(rockCutSummary(base)).toBe('Off')
  })
  it('shows each value and turns off again', () => {
    const { changes, button, renderer } = mount({ ...base, rockCut: { ...ROCK_CUT_DEFAULTS } })
    expect(renderer.root.findAllByType('input')).toHaveLength(6)
    act(() => button(/Stop cutting rock/).props.onClick())
    expect(changes).toEqual([undefined])
    expect(rockCutSummary({ ...base, rockCut: ROCK_CUT_DEFAULTS })).toBe('ledge 0.5 m · blast 0.75 m · shallow ≤ 1 m')
  })
})
