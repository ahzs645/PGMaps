import { createElement, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { StationBox } from './StationBox'

const LENGTH = 300
/**
 * The page around the box: it selects the typed station held to the line, and shows either that
 * station (a road whose section can be evaluated there) or the nearest 10 m one (a terrain profile).
 */
function Bar({ exact, log }: { exact: boolean; log: string[] }) {
  const [selected, setSelected] = useState(0)
  const shown = exact ? selected : Math.round(selected / 10) * 10
  return createElement(
    'div',
    null,
    createElement(StationBox, {
      selected,
      shown,
      length: LENGTH,
      onType: (entered: number) => {
        const bounded = Math.max(0, Math.min(LENGTH, entered))
        setSelected(bounded)
        return bounded
      },
      onCommit: () => log.push(`commit ${selected}`),
      onStep: (direction: 1 | -1) => setSelected(Math.max(0, Math.min(LENGTH, shown + direction * 10))),
    }),
    createElement('output', null, `shown ${shown}`),
    // Another view selecting a station: a chart, the slider, playback.
    createElement('button', { onClick: () => setSelected(120) }),
  )
}
function mount(exact: boolean) {
  const log: string[] = []
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(createElement(Bar, { exact, log }))
  })
  const input = () => renderer.root.findByType('input')
  return {
    log,
    box: () => String(input().props.value),
    shown: () => renderer.root.findByType('output').children.join(''),
    type: (value: string) => act(() => input().props.onChange({ target: { value } })),
    key: (key: string) => act(() => input().props.onKeyDown({ key, preventDefault: () => {} })),
    blur: () => act(() => input().props.onBlur()),
    selectElsewhere: () => act(() => renderer.root.findByType('button').props.onClick()),
  }
}

describe('the station box keeps what is typed until the entry is finished', () => {
  it('does not rewrite the text where only the nearest calculated station can be shown', () => {
    const bar = mount(false)
    // "8" used to become "10" under the cursor, so the next key made "105".
    bar.type('8')
    expect(bar.box()).toBe('8')
    expect(bar.shown()).toBe('shown 10')
    bar.type('85')
    expect(bar.box()).toBe('85')
    expect(bar.shown()).toBe('shown 90')
    expect(bar.log).toEqual([])
    // Enter finishes the entry: the box takes the station the views show.
    bar.key('Enter')
    expect(bar.box()).toBe('90')
    expect(bar.log).toEqual(['commit 85'])
  })

  it('finishes on blur, and keeps a typed station the views can show exactly', () => {
    const bar = mount(true)
    bar.type('8')
    expect(bar.box()).toBe('8')
    bar.type('85.')
    expect(bar.box()).toBe('85.')
    bar.type('85.4')
    expect(bar.shown()).toBe('shown 85.4')
    bar.blur()
    expect(bar.box()).toBe('85.4')
    expect(bar.log).toEqual(['commit 85.4'])
  })

  it('keeps the selection through empty or unfinished text, and holds a value to the line', () => {
    const bar = mount(false)
    bar.type('200')
    bar.type('')
    expect(bar.box()).toBe('')
    expect(bar.shown()).toBe('shown 200')
    bar.type('2000')
    expect(bar.box()).toBe('2000')
    expect(bar.shown()).toBe('shown 300')
    bar.blur()
    expect(bar.box()).toBe('300')
  })

  it('drops the entry when an arrow key or another view selects a station', () => {
    const bar = mount(false)
    bar.type('47')
    expect(bar.shown()).toBe('shown 50')
    bar.key('ArrowUp')
    expect(bar.box()).toBe('60')
    bar.type('47')
    expect(bar.box()).toBe('47')
    bar.selectElsewhere()
    expect(bar.box()).toBe('120')
    expect(bar.log).toEqual([])
  })
})
