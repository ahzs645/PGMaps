import { createElement, useEffect, useState } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GradeCell } from './GradeScheduleFields'
import {
  focusAfterRemoval,
  junctionDifferenceText,
  junctionLabelText,
  useProfileEditing,
  type ChartDomain,
  type JunctionLabelPlacement,
  type ProfileFrame,
} from './ProfileEditing'
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

describe('junction labels the chart placed', () => {
  function draw(labels: Map<string, JunctionLabelPlacement>, difference: number | null = 1) {
    function Labelled() {
      const editing = useProfileEditing({
        sorted: start(),
        editable: false,
        roadLength: 200,
        onStation: () => {},
        freezeDomain: () => {},
        junctions: [{ ...junction, difference }],
      })
      return createElement('svg', null, editing.layers(frame, 360, 40, domain, labels))
    }
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(createElement(Labelled))
    })
    return renderer.root.findAll((n) => n.type === 'text' && n.props['data-junction-label'])
  }

  it('draws the label where the chart put it', () => {
    const [text] = draw(new Map([[junction.id, { x: 120, y: 60, anchor: 'end', text: 'Spur 2 +1.00 m' }]]))
    expect(text.props).toMatchObject({ x: 120, y: 60, textAnchor: 'end' })
    expect(text.children.join('')).toBe('Spur 2 +1.00 m')
  })

  it('leaves a label the chart had no room for to the tooltip', () => {
    expect(draw(new Map())).toHaveLength(0)
  })

  it('prints no difference too small to read', () => {
    expect(junctionLabelText({ ...junction, difference: 0.004 }, 'Spur 2')).toBe('Spur 2')
    expect(junctionLabelText({ ...junction, difference: -0.3 }, 'Spur 2')).toBe('Spur 2 −0.30 m')
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
    const input = () => renderer.root.findByType('input')
    return {
      log,
      // A typed grade applies on Enter, never while it is being typed.
      type: (value: string) => {
        act(() => input().props.onChange({ target: { value } }))
        act(() => input().props.onKeyDown({ key: 'Enter', preventDefault: () => {} }))
      },
      input,
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

  it('keeps a refused grade as typed, and Enter on it never applies the rounded grade instead', () => {
    // The shared number field reset its text to the stored grade (5.00) after the refusal, and Enter
    // then applied that rounded text, moving a PVI by millimetres.
    const c = cell('ahead', 'b')
    c.type('-98')
    expect(c.input().props.value).toBe('-98')
    act(() => c.input().props.onKeyDown({ key: 'Enter', preventDefault: () => {} }))
    act(() => c.input().props.onBlur())
    expect(c.log).toHaveLength(0)
    expect(c.input().props.value).toBe('-98')
    expect(JSON.stringify(c.renderer.toJSON())).toMatch(/grade into V2/)
    // Typing a grade that fits clears the refusal and applies it.
    c.type('-2')
    expect(c.log).toHaveLength(1)
    expect(JSON.stringify(c.renderer.toJSON())).not.toMatch(/grade into V2/)
  })

  it('applies nothing while a grade is being typed, only on Enter or blur', () => {
    const c = cell('back')
    act(() => c.input().props.onChange({ target: { value: '-' } }))
    act(() => c.input().props.onChange({ target: { value: '-9' } }))
    expect(c.log).toHaveLength(0)
    act(() => c.input().props.onBlur())
    expect(c.log).toHaveLength(1)
    expect(c.log[0].map((p) => p.elevation)).toEqual([100, 91, 103])
  })

  it('changes a grade past the cap to the cap and says so', () => {
    const c = cell('back')
    c.type('150')
    expect(c.log.at(-1)!.map((p) => p.elevation)).toEqual([100, 200, 103])
    expect(JSON.stringify(c.renderer.toJSON())).toMatch(/150 is outside −100 to 100, so it was changed to 100\./)
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

describe('cancelling a drag and deleting a PVI', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('Escape mid-drag cancels the drag through the history, not as a new edit', () => {
    const keys = new EventTarget()
    vi.stubGlobal('window', keys)
    const phases: string[] = []
    const log: VerticalPoint[][] = []
    const hook: { current?: ReturnType<typeof useProfileEditing> } = {}
    function Harness() {
      const [points, setPoints] = useState(start)
      const editing = useProfileEditing({
        sorted: points,
        editable: true,
        roadLength: 200,
        onVerticalChange: (next) => {
          log.push(next)
          setPoints(next)
        },
        onStation: () => {},
        freezeDomain: () => {},
        onEditGesture: (phase) => phases.push(phase),
      })
      useEffect(() => {
        hook.current = editing
      })
      return null
    }
    act(() => {
      create(createElement(Harness))
    })
    const pointer = { currentTarget: { focus: () => {} }, shiftKey: false } as never
    act(() => {
      hook.current!.startPvi(pointer, 'b', domain)
    })
    act(() => {
      hook.current!.move(pointer, 100, 110, { chainageM: 0.5, elevationM: 0.1 })
    })
    expect(log).toHaveLength(1)
    const escape = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' })
    act(() => {
      keys.dispatchEvent(escape)
    })
    // The workspace puts the project back; the hook adds no edit of its own.
    expect(phases).toEqual(['start', 'cancel'])
    expect(log).toHaveLength(1)
    expect(hook.current!.dragging).toBe(false)
  })

  it("hands focus to the PVI now in the deleted one's place, or the last one", () => {
    const body = {}
    vi.stubGlobal('document', { activeElement: body, body })
    const focused: number[] = []
    const handles = [0, 1].map((i) => ({ focus: () => focused.push(i) }))
    const chart = {
      querySelectorAll: () => handles,
      hasAttribute: () => true,
      focus: () => focused.push(-1),
    } as unknown as SVGSVGElement
    focusAfterRemoval(chart, 1)
    focusAfterRemoval(chart, 2)
    expect(focused).toEqual([1, 1])
    // Focus that already moved somewhere is left alone.
    vi.stubGlobal('document', { activeElement: {}, body })
    focusAfterRemoval(chart, 0)
    expect(focused).toEqual([1, 1])
  })
})

describe('a junction in words', () => {
  it("says which road is higher instead of a sign beside this road's level", () => {
    // "This formation 759.42 m (+0.88 m)" read as if this road were the higher one.
    expect(junctionDifferenceText(0.88)).toBe('Its level is 0.88 m above this formation')
    expect(junctionDifferenceText(-0.88)).toBe('Its level is 0.88 m below this formation')
    expect(junctionDifferenceText(0.001)).toBe('Level with this formation')
  })
})
