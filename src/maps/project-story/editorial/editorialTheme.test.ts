import { describe, expect, it } from 'vitest'
import type { StyleSpecification } from 'maplibre-gl'
import { editorialStyleForTheme } from './useEditorialBasemapTheme'

describe('incoming editorial styles', () => {
  it('prepares light paint without changing cached dark cartography or thematic colors', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {},
      layers: [
        { id: 'pgmaps-story-background', type: 'background', paint: { 'background-color': '#343737' } },
        { id: 'editorial-source-branch', type: 'background', paint: { 'background-color': '#ff0000' } },
      ],
    }
    const light = editorialStyleForTheme(style, 'light')
    expect(light.layers[0].paint).toEqual({ 'background-color': '#f4f5f2' })
    expect(light.layers[1]).toEqual(style.layers[1])
    expect(style.layers[0].paint).toEqual({ 'background-color': '#343737' })
    expect(editorialStyleForTheme(style, 'dark')).toBe(style)
  })
})
