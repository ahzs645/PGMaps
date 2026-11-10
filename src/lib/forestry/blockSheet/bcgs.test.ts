import { describe, expect, it } from 'vitest'
import { bcgsMapsheet, ntsSeries } from './bcgs'

describe('BCGS 1:20,000 mapsheets', () => {
  it('matches the published grid at two checked places', () => {
    expect(bcgsMapsheet(-121.5254, 54.0595)).toBe('093I003')
    expect(bcgsMapsheet(-122.71, 53.895)).toBe('093G087')
  })

  it('names NTS series from longitude tens and latitude units', () => {
    expect(ntsSeries(-118, 49)).toBe('082')
    expect(ntsSeries(-123, 49)).toBe('092')
    expect(ntsSeries(-123, 57)).toBe('094')
    expect(ntsSeries(-130, 54)).toBe('103')
    expect(ntsSeries(-138, 59)).toBe('114')
  })

  it('snakes the letters: A–D east to west, E–H back, I–L, M–P', () => {
    // Series 093: 120–128°W, 52–56°N.
    expect(bcgsMapsheet(-120.5, 52.5)?.slice(3, 4)).toBe('A')
    expect(bcgsMapsheet(-127.5, 52.5)?.slice(3, 4)).toBe('D')
    expect(bcgsMapsheet(-127.5, 53.5)?.slice(3, 4)).toBe('E')
    expect(bcgsMapsheet(-120.5, 53.5)?.slice(3, 4)).toBe('H')
    expect(bcgsMapsheet(-120.5, 54.5)?.slice(3, 4)).toBe('I')
    expect(bcgsMapsheet(-127.5, 54.5)?.slice(3, 4)).toBe('L')
    expect(bcgsMapsheet(-127.5, 55.5)?.slice(3, 4)).toBe('M')
    expect(bcgsMapsheet(-120.5, 55.5)?.slice(3, 4)).toBe('P')
  })

  it('numbers sheets 001–100 from the south-west, west to east, rows northward', () => {
    // 093I spans 120–122°W, 54–55°N.
    expect(bcgsMapsheet(-121.99, 54.01)).toBe('093I001')
    expect(bcgsMapsheet(-120.01, 54.01)).toBe('093I010')
    expect(bcgsMapsheet(-121.99, 54.99)).toBe('093I091')
    expect(bcgsMapsheet(-120.01, 54.99)).toBe('093I100')
  })

  it('puts a point on a cell line in the cell north or east of it', () => {
    expect(bcgsMapsheet(-121.8, 54.3)).toBe('093I032')
    expect(bcgsMapsheet(-122, 54.1)).toBe('093I011')
  })

  it('returns null outside British Columbia’s series', () => {
    expect(bcgsMapsheet(-100, 54)).toBeNull()
    expect(bcgsMapsheet(-121, 47.9)).toBeNull()
    expect(bcgsMapsheet(-121, 60)).toBeNull()
    expect(bcgsMapsheet(Number.NaN, 54)).toBeNull()
  })
})
