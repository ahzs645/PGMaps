import { describe, expect, it } from 'vitest'
import { cleanAddress, formatFullAddress } from './address'

describe('establishment addresses', () => {
  it('drops HealthSpace N/A placeholders', () => {
    expect(cleanAddress('2825 12th Avenue, Prince George, N/A')).toBe('2825 12th Avenue, Prince George')
    expect(cleanAddress('N/A')).toBe('')
    expect(cleanAddress('4555 Leno Road, Prince George, V2N 6E3')).toBe('4555 Leno Road, Prince George, V2N 6E3')
  })

  it('falls back to the short address when the full one is empty', () => {
    expect(formatFullAddress({ full_address: 'N/A', address: '217 Gordon Crescent' })).toBe('217 Gordon Crescent')
  })
})
