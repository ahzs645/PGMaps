import { useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { memoWithLatestHandlers, sameBag, sameShape } from './memoWithLatestHandlers'

describe('sameShape', () => {
  it('compares plain objects and arrays by their entries, a few levels deep', () => {
    expect(sameShape({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toBe(true)
    expect(sameShape({ a: 1, b: [1, 2] }, { a: 1, b: [1, 3] })).toBe(false)
    expect(sameShape({ a: 1 }, { a: 1, b: undefined })).toBe(false)
    expect(sameShape({ n: Number.NaN }, { n: Number.NaN })).toBe(true)
  })

  it('compares class instances and anything past the depth by identity, so it errs towards rendering', () => {
    expect(sameShape({ m: new Map() }, { m: new Map() })).toBe(false)
    expect(sameShape({ a: { b: { c: 1 } } }, { a: { b: { c: 1 } } }, 2)).toBe(false)
    const deep = { c: 1 }
    expect(sameShape({ a: { b: deep } }, { a: { b: deep } }, 2)).toBe(true)
  })

  it('does not look inside React elements', () => {
    expect(sameShape({ e: <span /> }, { e: <span /> })).toBe(false)
  })
})

describe('sameBag', () => {
  it('compares a bag field by identity, except a small record of plain values', () => {
    const source = { elevationAt: () => 1 }
    expect(sameBag({ source, saved: { at: 1, current: true } }, { source, saved: { at: 1, current: true } })).toBe(true)
    // Equal content is not enough for anything that can be keyed by identity.
    expect(sameBag({ source }, { source: { elevationAt: source.elevationAt } })).toBe(false)
    expect(sameBag({ saved: { at: 1 } }, { saved: { at: 2 } })).toBe(false)
  })
})

describe('memoWithLatestHandlers', () => {
  type Props = {
    label: string
    style: { tone: string }
    workspace: { source: { elevationAt: () => number }; update: (value: string) => void }
    onClick: () => string
  }
  const renders: string[] = []
  const received: Props['workspace']['source'][] = []
  const Child = memoWithLatestHandlers(
    function Child(props: Props) {
      renders.push(props.label)
      received.push(props.workspace.source)
      return <button onClick={() => props.onClick()}>{props.label}</button>
    },
    { bags: ['workspace'] },
  )

  const source = { elevationAt: () => 800 }
  const clicked: string[] = []
  function Parent() {
    const [count, setCount] = useState(0)
    const [label, setLabel] = useState('A')
    // Fresh closures, object literals and a spread workspace every render, as a large page builds them.
    return (
      <>
        <input name="count" onChange={(event) => setCount(Number(event.target.value))} />
        <input name="label" onChange={(event) => setLabel(event.target.value)} />
        <Child
          label={label}
          style={{ tone: 'plain' }}
          workspace={{ source, update: (value) => clicked.push(`${value}:${count}`) }}
          onClick={() => {
            clicked.push(`click:${count}`)
            return String(count)
          }}
        />
      </>
    )
  }
  const set = (renderer: ReactTestRenderer, name: string, value: string) =>
    act(() => renderer.root.findByProps({ name }).props.onChange({ target: { value } }))

  it('skips renders that change only handlers and rebuilt objects, and handlers stay current', () => {
    renders.length = 0
    clicked.length = 0
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(<Parent />)
    })
    expect(renders).toEqual(['A'])
    set(renderer, 'count', '5')
    expect(renders).toEqual(['A'])
    // The skipped render's handler still sees count 5.
    act(() => renderer.root.findByType('button').props.onClick())
    expect(clicked).toEqual(['click:5'])
    const child = renderer.root.findByType(Child)
    set(renderer, 'count', '6')
    ;(child.props as Props).workspace.update('p')
    expect(clicked).toEqual(['click:5', 'p:6'])
    set(renderer, 'label', 'B')
    expect(renders).toEqual(['A', 'B'])
  })

  it('hands the component the caller’s own objects, so identity checks still hold', () => {
    expect(received.length).toBeGreaterThan(0)
    for (const value of received) expect(value).toBe(source)
  })
})
