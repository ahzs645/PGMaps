import { createElement, useState } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { GradeCell } from './GradeScheduleFields'
import { useProfileEditing, type ChartDomain, type ProfileFrame } from './ProfileEditing'
import type { ProfileJunction } from './profileJunctions'
import type { VerticalControl, VerticalPoint } from './types'

const pvi = (id: string, chainage: number, elevation: number): VerticalPoint => ({
  id,
  chainage,
  elevation,
  curveLength: 0,
})
const start = () => [pvi('a', 0, 100), pvi('b', 100, 105), pvi('c', 200, 103)]
const domain: ChartDomain = [0, 200, 90, 120]
const frame: ProfileFrame = {
  x: (c) => 50 + c * 2,
  y: (e) => 20 + (120 - e) * 10,
  top: 20,
  left: 50,
  plotWidth: 400,
  plotHeight: 300,
}
const junction: ProfileJunction = {
  id: 'spur@150',
  otherRoadId: 'spur',
  otherRoadName: 'Spur 2',
  kind: 'meets',
  chainage: 150,
  otherChainage: 0,
  level: 105,
  levelKind: 'design',
  designHere: 104,
  groundHere: 103,
  difference: 1,
}

/** The chart's side of the hook: the PVIs it holds, and the layers it draws. */
function Chart({ controls, log }: { controls?: VerticalControl[]; log: VerticalPoint[][] }) {
  const [points, setPoints] = useState(start)
  const editing = useProfileEditing({
    sorted: points,
    editable: true,
    roadLength: 200,
    controls,
    onVerticalChange: (next) => {
      log.push(next)
      setPoints(next)
    },
    onStation: () => {},
    freezeDomain: () => {},
    junctions: [junction],
  })
  return createElement(
    'svg',
    null,
    editing.layers(frame, 360, 40, domain),
    points.map((p) =>
      createElement('circle', {
        key: p.id,
        'data-pvi': p.id,
        onKeyDown: (event: Parameters<typeof editing.pviKeyDown>[0]) => editing.pviKeyDown(event, p.id),
      }),
    ),
  )
}

function mount(controls?: VerticalControl[]) {
  const log: VerticalPoint[][] = []
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(createElement(Chart, { controls, log }))
  })
  const key = (node: ReactTestInstance, key: string, extra: object = {}) =>
    act(() =>
      node.props.onKeyDown({
        key,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        preventDefault: () => {},
        stopPropagation: () => {},
        ...extra,
      }),
    )
  return {
    log,
    grips: () => renderer.root.findAll((n) => n.props['data-testid'] === 'road-profile-tangent-grip'),
    junctions: () => renderer.root.findAll((n) => n.props['data-testid'] === 'road-profile-junction'),
    pvi: (id: string) => renderer.root.find((n) => n.type === 'circle' && n.props['data-pvi'] === id),
    key,
  }
}

describe('profile grade editing', () => {
  it('draws one grip per tangent and raises a tangent from the keyboard, keeping its grade', () => {
    const chart = mount()
    expect(chart.grips()).toHaveLength(2)
    chart.key(chart.grips()[1], 'ArrowUp', { shiftKey: true })
    expect(chart.log.at(-1)!.map((p) => p.elevation)).toEqual([100, 106, 104])
  })

  it('opens the grade of a tangent with Enter', () => {
    const chart = mount()
    expect(chart.grips()[0].props['aria-expanded']).toBe(false)
    chart.key(chart.grips()[0], 'Enter')
    expect(chart.grips()[0].props['aria-expanded']).toBe(true)
  })

  it('removes a focused PVI with Delete, and keeps the last two', () => {
    const chart = mount()
    chart.key(chart.pvi('b'), 'Delete')
    expect(chart.log.at(-1)!.map((p) => p.id)).toEqual(['a', 'c'])
    chart.key(chart.pvi('c'), 'Backspace')
    expect(chart.log).toHaveLength(1)
  })

  it('slides a PVI along its grade in with Alt+ArrowRight', () => {
    const chart = mount()
    chart.key(chart.pvi('b'), 'ArrowRight', { altKey: true })
    expect(chart.log.at(-1)![1]).toMatchObject({ chainage: 105, elevation: 105.25 })
  })

  it('keeps a tangent on its control when the keys would move it off', () => {
    const control: VerticalControl = {
      id: 'k',
      chainage: 100,
      elevation: 105,
      toleranceAboveM: 0,
      toleranceBelowM: 0,
      gradePercent: null,
      gradeTolerancePercent: 0,
    }
    const chart = mount([control])
    chart.key(chart.grips()[0], 'ArrowUp')
    expect(chart.log).toHaveLength(0)
  })

  it('marks a junction with the other road and its difference, as a button', () => {
    const chart = mount()
    const [marker] = chart.junctions()
    expect(marker.props.role).toBe('button')
    expect(marker.props['aria-label']).toMatch(/^Spur 2 meets this road at 0\+150\.0; formation 105\.00 m/)
    const text = marker.findByType('text').children.join('')
    expect(text).toBe('Spur 2 +1.00 m')
  })
})

describe('typing a grade in the vertical schedule', () => {
  function cell(hold: 'back' | 'ahead', backId = 'a') {
    const log: VerticalPoint[][] = []
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(
        createElement(GradeCell, {
          label: 'grade out',
          value: 5,
          points: start(),
          backId,
          hold,
          onVerticalChange: (points: VerticalPoint[]) => log.push(points),
        }),
      )
    })
    const input = renderer.root.findByType('input')
    return {
      log,
      type: (value: string) => act(() => input.props.onChange({ target: { value } })),
      renderer,
    }
  }

  it('moves the ahead PVI when the back one holds', () => {
    const c = cell('back')
    c.type('3')
    expect(c.log.at(-1)!.map((p) => p.elevation)).toEqual([100, 103, 103])
  })

  it('moves the back PVI when the ahead one holds', () => {
    const c = cell('ahead')
    c.type('-2')
    expect(c.log.at(-1)!.map((p) => p.elevation)).toEqual([107, 105, 103])
  })

  it('shows why a grade is refused and changes nothing', () => {
    // V2 rising to 201 m would leave 101 % into it.
    const c = cell('ahead', 'b')
    c.type('-98')
    expect(c.log).toHaveLength(0)
    expect(JSON.stringify(c.renderer.toJSON())).toMatch(/grade into V2 \+101\.00 %/)
  })

  it('shows a dash where there is no tangent', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(
        createElement(GradeCell, { label: 'in', value: null, points: start(), backId: null, hold: 'back' }),
      )
    })
    expect(renderer.toJSON()).toBe('—')
  })
})
