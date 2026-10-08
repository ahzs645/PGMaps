import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createScaleLegend } from '../scales/legend.js'
import { ScaleLegend } from './scale-legend.js'

describe('shared scale legend presentation', () => {
  it('preserves unequal measured intervals and the same missing color', () => {
    const legend = createScaleLegend(
      {
        domain: [0, 100],
        breaks: [0, 10, 100],
        colors: ['#00ff00', '#ff0000'],
        missingColor: '#999999',
        bins: [
          { min: 0, max: 10, color: '#00ff00', includesMax: false },
          { min: 10, max: 100, color: '#ff0000', includesMax: true },
        ],
      },
      { title: 'Measured concentration', unit: 'ppm' },
    )
    const html = renderToStaticMarkup(createElement(ScaleLegend, { legend }))
    expect(html).toContain('width:10%;background-color:#00ff00')
    expect(html).toContain('width:90%;background-color:#ff0000')
    expect(html).toContain('background-color:#999999')
    expect(html).toContain('Measured concentration')
    expect(html).toContain('No data')
    expect(html).toContain('≤')
  })
})
