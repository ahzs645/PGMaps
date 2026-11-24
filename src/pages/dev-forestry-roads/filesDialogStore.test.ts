import { describe, expect, it, vi } from 'vitest'
import { createFilesDialogStore } from './filesDialogStore'

describe('createFilesDialogStore', () => {
  it('opens on an output, follows the shown one and closes', () => {
    const store = createFilesDialogStore()
    expect(store.get()).toEqual({ output: null, selected: 'project', today: '' })
    store.open('report-pdf', '2026-11-24')
    expect(store.get()).toEqual({ output: 'report-pdf', selected: 'report-pdf', today: '2026-11-24' })
    store.select('plotbook')
    expect(store.get()).toEqual({ output: 'report-pdf', selected: 'plotbook', today: '2026-11-24' })
    store.close()
    expect(store.get()).toEqual({ output: null, selected: 'plotbook', today: '2026-11-24' })
  })

  it('tells its listeners only of a change, and keeps the state object otherwise', () => {
    const store = createFilesDialogStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    const closed = store.get()
    store.close()
    expect(listener).not.toHaveBeenCalled()
    expect(store.get()).toBe(closed)
    store.open('project', '2026-11-24')
    store.select('project')
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    store.close()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
