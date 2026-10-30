import { useLayoutEffect, type Dispatch, type SetStateAction } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it } from 'vitest'
import { useKeyedState } from './useKeyedState'

let renderer: ReactTestRenderer | undefined
let value: string
let update: Dispatch<SetStateAction<string>>
function Harness({ request = 'source-a', enabled = true }: { request?: string; enabled?: boolean }) {
  const [state, setState] = useKeyedState(request, () => 'idle', enabled)
  useLayoutEffect(() => {
    value = state
    update = setState
  })
  return null
}
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
})

it('retains a disabled lazy resource but clears its previous error when the same request is enabled again', () => {
  act(() => {
    renderer = create(<Harness />)
  })
  act(() => update('failed request'))
  const previousActivation = update
  act(() => renderer!.update(<Harness enabled={false} />))
  expect(value).toBe('failed request')
  act(() => renderer!.update(<Harness enabled />))
  expect(value).toBe('idle')
  act(() => update('fresh response'))
  expect(value).toBe('fresh response')
  act(() => previousActivation('late failure from the previous activation'))
  expect(value).toBe('fresh response')
})

it('ignores stale source setters and resets only when an inactive source is requested', () => {
  act(() => {
    renderer = create(<Harness />)
  })
  const stale = update
  act(() => update('response a'))
  act(() => renderer!.update(<Harness request="source-b" enabled={false} />))
  expect(value).toBe('response a')
  act(() => renderer!.update(<Harness request="source-b" />))
  expect(value).toBe('idle')
  act(() => update('response b'))
  act(() => stale('late response a'))
  expect(value).toBe('response b')
})
