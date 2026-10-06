import { describe, expect, it } from 'vitest'
import { mapTooltipHtml } from './map-tooltip-card'

describe('mapTooltipHtml', () => {
  it('escapes source content in every field before it reaches setHTML', () => {
    const source = '<img src=x onerror="alert(1)"> & \'source\''
    const html = mapTooltipHtml({
      title: source,
      subtitle: source,
      lines: [source],
      rows: [[source, source]],
      footer: source,
    })
    expect(html).not.toContain('<img')
    expect(html.match(/&lt;img/g)).toHaveLength(6)
    expect(html).toContain('&quot;alert(1)&quot;')
    expect(html).toContain('&amp; &#39;source&#39;')
  })

  it('keeps numeric zero while omitting absent rows and empty details', () => {
    const html = mapTooltipHtml({
      title: 'Coverage',
      rows: [['Count', 0], ['Missing', null], ['Unknown', undefined], ['Empty', '']],
      lines: [''],
    })
    expect(html).toContain('Count:')
    expect(html).toContain('>0</span>')
    expect(html).not.toMatch(/Missing|Unknown|Empty/)
  })
})
