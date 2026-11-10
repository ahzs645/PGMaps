import { describe, expect, it } from 'vitest'
import { clockText, saveStateText } from './saveState'

const at = (hour: number, minute: number, day = 9) => new Date(2026, 10, day, hour, minute).getTime()
const now = at(14, 5)

describe('saveStateText', () => {
  it('gives the time of the browser save and says when no file holds the project', () => {
    expect(saveStateText({ kind: 'saved', at: at(14, 2) }, null, now)).toMatchObject({
      text: 'Saved in this browser 14:02 · not yet saved to a file',
      tone: 'default',
    })
  })

  it('tells a current project file from one the project has moved on from', () => {
    const saved = { kind: 'saved' as const, at: at(14, 2) }
    expect(saveStateText(saved, { at: at(13, 58), current: true }, now).text).toBe(
      'Saved in this browser 14:02 · file saved 13:58',
    )
    expect(saveStateText(saved, { at: at(13, 58), current: false }, now).text).toBe(
      'Saved in this browser 14:02 · not saved to a file since 13:58',
    )
  })

  it('marks a refused save, an unsavable draft and a training session', () => {
    expect(saveStateText({ kind: 'failed' }, null, now)).toMatchObject({ tone: 'danger' })
    expect(saveStateText({ kind: 'failed' }, null, now).detail).toContain('Use Save to download the project file')
    expect(
      saveStateText({ kind: 'invalid', reason: 'Left width must be between 0.1 and 50.' }, null, now).detail,
    ).toContain('Left width must be between 0.1 and 50.')
    expect(saveStateText({ kind: 'training', at: at(14, 2) }, null, now)).toMatchObject({ tone: 'warning' })
  })

  it('has a short form of every state for a narrow header', () => {
    const file = { at: at(13, 58), current: true }
    expect(saveStateText({ kind: 'saved', at: at(14, 2) }, null, now).short).toBe('Saved 14:02 · no file')
    expect(saveStateText({ kind: 'saved', at: at(14, 2) }, file, now).short).toBe('Saved 14:02 · file saved')
    expect(saveStateText({ kind: 'saved', at: at(14, 2) }, { ...file, current: false }, now).short).toBe(
      'Saved 14:02 · file out of date',
    )
    expect(saveStateText({ kind: 'failed' }, null, now).short).toBe('Not saved · no file')
    expect(saveStateText({ kind: 'invalid', reason: 'x' }, null, now).short).toBe('Last valid version kept')
    for (const kind of ['pending', 'saving'] as const)
      expect(saveStateText({ kind }, null, now).short.length).toBeLessThanOrEqual(25)
    expect(saveStateText({ kind: 'training', at: at(14, 2) }, null, now).short).toBe('Training session · no file')
  })

  it('adds the date to a time that is not today', () => {
    expect(clockText(at(9, 7), now)).toBe('09:07')
    expect(clockText(at(16, 30, 8), now)).toBe('8 Nov 16:30')
  })
})
