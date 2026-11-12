import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LAYOUT_STAGE,
  EMPTY_FIELD_CHECKLIST,
  FIELD_CHECK_LIMITS,
  fieldChecklistProgress,
  layoutStageOf,
  localIsoDate,
  parseFieldChecklist,
  parseLayoutStage,
  stampText,
  updateBoundaryNote,
  updateFieldCheck,
} from './fieldChecklist'
import { parseViaReview } from './via'

describe('layout stage', () => {
  it('reads pre-layout until the reviewer says otherwise', () => {
    expect(DEFAULT_LAYOUT_STAGE).toBe('pre-layout')
    expect(layoutStageOf(undefined)).toBe('pre-layout')
    expect(layoutStageOf({})).toBe('pre-layout')
    expect(layoutStageOf({ layoutStage: null })).toBe('pre-layout')
    expect(layoutStageOf({ layoutStage: 'post-layout' })).toBe('post-layout')
  })

  it('drops anything that is not a stage', () => {
    expect(parseLayoutStage('post-layout')).toBe('post-layout')
    expect(parseLayoutStage('during')).toBeNull()
    expect(parseLayoutStage(1)).toBeNull()
  })
})

describe('crew checklist', () => {
  const today = '2026-11-11'

  it('stamps each answer with who recorded it and when', () => {
    const named = { ...EMPTY_FIELD_CHECKLIST, checkedBy: '  J. Smith ' }
    const list = updateFieldCheck(named, 'viewpoints', 'station:road', { answer: 'yes' }, today)
    expect(list.viewpoints['station:road']).toEqual({ answer: 'yes', note: '', by: 'J. Smith', on: today })
    // A note keeps the answer.
    const noted = updateFieldCheck(list, 'viewpoints', 'station:road', { note: 'Pullout gated' }, '2026-11-12')
    expect(noted.viewpoints['station:road']).toEqual({
      answer: 'yes',
      note: 'Pullout gated',
      by: 'J. Smith',
      on: '2026-11-12',
    })
    // The input is never changed.
    expect(named.viewpoints).toEqual({})
  })

  it('removes an entry once it has neither an answer nor a note', () => {
    const list = updateFieldCheck(null, 'greenUp', 'opening-1', { answer: 'no' }, today)
    expect(Object.keys(list.greenUp)).toEqual(['opening-1'])
    expect(updateFieldCheck(list, 'greenUp', 'opening-1', { answer: null }, today).greenUp).toEqual({})
  })

  it('keeps only the newest entries past the limit', () => {
    let list = EMPTY_FIELD_CHECKLIST
    for (let i = 0; i < FIELD_CHECK_LIMITS.entries + 5; i++)
      list = updateFieldCheck(list, 'viewpoints', `view:${i}`, { answer: 'yes' }, today)
    const keys = Object.keys(list.viewpoints)
    expect(keys).toHaveLength(FIELD_CHECK_LIMITS.entries)
    expect(keys[0]).toBe('view:5')
    expect(keys.at(-1)).toBe(`view:${FIELD_CHECK_LIMITS.entries + 4}`)
  })

  it('records the boundary note with its stamp, and clears the stamp with the note', () => {
    const list = updateBoundaryNote(
      { ...EMPTY_FIELD_CHECKLIST, checkedBy: 'K. Lee' },
      'Follow the draw on the east side',
      today,
    )
    expect(list.boundary).toEqual({ note: 'Follow the draw on the east side', by: 'K. Lee', on: today })
    expect(updateBoundaryNote(list, '  ', today).boundary).toEqual({ note: '', by: '', on: '' })
  })

  it('counts only the viewpoints and openings listed now, plus the boundary', () => {
    let list = updateFieldCheck(null, 'viewpoints', 'station:road', { answer: 'yes' }, today)
    list = updateFieldCheck(list, 'viewpoints', 'view:gone', { answer: 'no' }, today)
    list = updateFieldCheck(list, 'greenUp', 'opening-1', { answer: 'no' }, today)
    const progress = fieldChecklistProgress(list, {
      viewpoints: ['station:road', 'view:a'],
      openings: ['opening-1'],
    })
    expect(progress).toEqual({ answered: 2, total: 4, flagged: 1, started: true, complete: false })
    const done = fieldChecklistProgress(
      updateBoundaryNote(updateFieldCheck(list, 'viewpoints', 'view:a', { answer: 'yes' }, today), 'East draw', today),
      { viewpoints: ['station:road', 'view:a'], openings: ['opening-1'] },
    )
    expect(done.complete).toBe(true)
    expect(fieldChecklistProgress(undefined, { viewpoints: [], openings: [] })).toEqual({
      answered: 0,
      total: 1,
      flagged: 0,
      started: false,
      complete: false,
    })
  })

  it('reads old and damaged records without failing', () => {
    expect(parseFieldChecklist(undefined)).toBeUndefined()
    expect(parseFieldChecklist('yes')).toBeUndefined()
    expect(parseFieldChecklist([])).toBeUndefined()
    expect(
      parseFieldChecklist({
        checkedBy: 7,
        viewpoints: {
          'station:road': { answer: 'yes', note: 'ok', by: 'J', on: '2026-11-10' },
          'view:bad': { answer: 'maybe', note: '' },
          'view:noted': { answer: 'maybe', note: 'gate locked', on: 'yesterday' },
        },
        greenUp: 'all of them',
      }),
    ).toEqual({
      checkedBy: '',
      viewpoints: {
        'station:road': { answer: 'yes', note: 'ok', by: 'J', on: '2026-11-10' },
        'view:noted': { answer: null, note: 'gate locked', by: '', on: '' },
      },
      greenUp: {},
      boundary: { note: '', by: '', on: '' },
    })
  })

  it('travels on the VIA review, and a review saved before it reads back unchanged', () => {
    const old = parseViaReview({ rationale: 'Seen from Hwy 16.' })!
    expect('layoutStage' in old).toBe(false)
    expect('fieldChecklist' in old).toBe(false)
    const list = updateFieldCheck(
      { ...EMPTY_FIELD_CHECKLIST, checkedBy: 'J' },
      'viewpoints',
      'station:a',
      { answer: 'no' },
      today,
    )
    const parsed = parseViaReview(JSON.parse(JSON.stringify({ layoutStage: 'post-layout', fieldChecklist: list })))!
    expect(parsed.layoutStage).toBe('post-layout')
    expect(parsed.fieldChecklist).toEqual(list)
    expect(parseViaReview({ layoutStage: 'later' })!.layoutStage).toBeUndefined()
  })

  it('writes the stamp with whichever half is known', () => {
    expect(stampText({ by: 'J. Smith', on: '2026-11-10' })).toBe('J. Smith, 2026-11-10')
    expect(stampText({ by: '', on: '2026-11-10' })).toBe('2026-11-10')
    expect(stampText(null)).toBe('')
  })

  it('dates in local time', () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
  })
})
