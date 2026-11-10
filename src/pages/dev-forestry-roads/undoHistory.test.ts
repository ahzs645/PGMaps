import { describe, expect, it } from 'vitest'
import {
  addCheckpoint,
  checkpointName,
  emptyHistory,
  historyRows,
  MAX_CHECKPOINTS,
  recordStep,
  startsUndoStep,
  travel,
  UNDO_MERGE_MS,
  type History,
} from './undoHistory'

const describe2 = (before: string, after: string) => `${before}→${after}`

/** a → b ("typed b") → c → d, with d current. */
function edits(): { history: History<string>; current: string } {
  let history = emptyHistory<string>()
  history = recordStep(history, 'a', 'typed b', 1)
  history = recordStep(history, 'b', undefined, 2)
  history = recordStep(history, 'c', 'typed d', 3)
  return { history, current: 'd' }
}

describe('undo history', () => {
  it('lists every state, named by the step that made it', () => {
    const { history, current } = edits()
    expect(historyRows(history, current, describe2)).toEqual([
      { offset: -3, label: 'Earliest state kept', at: null },
      { offset: -2, label: 'typed b', at: 1 },
      { offset: -1, label: 'b→c', at: 2 },
      { offset: 0, label: 'typed d', at: 3 },
    ])
  })

  it('jumps several steps at once, and the labels move with their steps', () => {
    const { history, current } = edits()
    const back = travel(history, current, -2)!
    expect(back.state).toBe('b')
    expect(back.history.past.map((e) => e.state)).toEqual(['a'])
    expect(back.history.future.map((e) => e.state)).toEqual(['d', 'c'])
    // The same list, with the current state two rows up.
    expect(historyRows(back.history, back.state, describe2)).toEqual([
      { offset: -1, label: 'Earliest state kept', at: null },
      { offset: 0, label: 'typed b', at: 1 },
      { offset: 1, label: 'b→c', at: 2 },
      { offset: 2, label: 'typed d', at: 3 },
    ])
    const forward = travel(back.history, back.state, 2)!
    expect(forward.state).toBe('d')
    expect(forward.history).toEqual(history)
    expect(travel(history, current, -4)).toBeNull()
    expect(travel(history, current, 1)).toBeNull()
    expect(travel(history, current, 0)).toBeNull()
  })

  it('drops redo on a new edit and keeps only the newest steps', () => {
    const { history, current } = edits()
    const back = travel(history, current, -1)!
    const edited = recordStep(back.history, back.state, 'other', 4)
    expect(edited.future).toEqual([])
    let long = emptyHistory<number>()
    for (let i = 0; i < 40; i++) long = recordStep(long, i, undefined, i, 30)
    expect(long.past).toHaveLength(30)
    expect(long.past[0].state).toBe(10)
  })

  it('names checkpoints and keeps the newest', () => {
    expect(checkpointName('  Before   switchback ', [])).toBe('Before switchback')
    expect(checkpointName('', [{ id: 'x', name: 'x', state: 1, at: 0 }])).toBe('Checkpoint 2')
    let list: { id: string; name: string; state: number; at: number }[] = []
    for (let i = 0; i < MAX_CHECKPOINTS + 2; i++)
      list = addCheckpoint(list, { id: `c${i}`, name: `c${i}`, state: i, at: i })
    expect(list).toHaveLength(MAX_CHECKPOINTS)
    expect(list[0].id).toBe(`c${MAX_CHECKPOINTS + 1}`)
  })
})

describe('when an edit starts a step of its own', () => {
  it('merges quick typing, but never a discrete action such as a preset click', () => {
    expect(startsUndoStep(1000, 1000 + UNDO_MERGE_MS - 50)).toBe(false)
    expect(startsUndoStep(1000, 1000 + UNDO_MERGE_MS + 1)).toBe(true)
    expect(startsUndoStep(1000, 1400, true)).toBe(true)
  })
})
