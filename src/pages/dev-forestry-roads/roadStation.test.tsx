import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { memoWithLatestHandlers } from '@/lib/memoWithLatestHandlers'
import { RoadStationProvider, StationValue, useLiveStation, useStationReader } from './roadStation'

describe('the sidebar station', () => {
  it('falls back to the workspace station without the page providers', () => {
    function Reader() {
      const live = useLiveStation({ station: 40 })
      const read = useStationReader({ station: 40 })
      return <output data-live={live} data-read={read()} />
    }
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(<Reader />)
    })
    expect(renderer.root.findByType('output').props).toMatchObject({ 'data-live': 40, 'data-read': 40 })
  })

  it('updates what shows the station while the memoized sidebar around it skips the render', () => {
    const sidebarRenders: number[] = []
    const reads: number[] = []
    // The workspace's own station stays NaN, as the page hands it to the sidebar.
    const workspace = { station: Number.NaN }
    const Sidebar = memoWithLatestHandlers(
      function Sidebar(props: { workspace: { station: number } }) {
        sidebarRenders.push(1)
        const read = useStationReader(props.workspace)
        return (
          <>
            <StationValue workspace={props.workspace}>{(station) => <output>{station}</output>}</StationValue>
            <button onClick={() => reads.push(read())} />
          </>
        )
      },
      { bags: ['workspace'] },
    )
    function Page({ children }: { children?: ReactNode }) {
      const [station, setStation] = useState(10)
      // As the page: a stable reader of the committed station.
      const committed = useRef(station)
      useLayoutEffect(() => {
        committed.current = station
      }, [station])
      const read = useCallback(() => committed.current, [])
      return (
        <RoadStationProvider station={station} read={read}>
          <input onChange={(event) => setStation(Number(event.target.value))} />
          <Sidebar workspace={{ ...workspace }} />
          {children}
        </RoadStationProvider>
      )
    }
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(<Page />)
    })
    expect(renderer.root.findByType('output').children).toEqual(['10'])
    act(() => renderer.root.findByType('input').props.onChange({ target: { value: '30' } }))
    expect(renderer.root.findByType('output').children).toEqual(['30'])
    expect(sidebarRenders).toHaveLength(1)
    act(() => renderer.root.findByType('button').props.onClick())
    expect(reads).toEqual([30])
  })
})
