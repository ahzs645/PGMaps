import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { normalizeProjectPackage } from '@/lib/projectPackages'
import { parseEditorialDocument, validateEditorialDocument } from './validate.mjs'
import { ancestorIds, radialHierarchyLayout, selectedDots } from '@/lib/diagrams/storyDiagrams'
const fixture = () => JSON.parse(readFileSync('public/data/story-documents/native-example/story.json', 'utf8'))
describe('native editorial contract', () => {
  it('loads a native package and independently authored document', () => {
    const raw = JSON.parse(readFileSync('public/data/projects/example/native-editorial.json', 'utf8'))
    expect(normalizeProjectPackage(raw)?.workspace?.type).toBe('story-map')
    expect(parseEditorialDocument(fixture()).chapters).toHaveLength(5)
    raw.workspace.document.schema = 'invented'
    expect(normalizeProjectPackage(raw)?.workspace).toBeUndefined()
  })
  it('rejects broken views, duplicate IDs and unsafe content', () => {
    const d = fixture()
    d.views.cariboo.mapId = 'missing'
    d.chapters[1].id = d.chapters[0].id
    d.chapters[0].blocks[0].text = [{ text: 'bad', href: 'javascript:alert(1)' }]
    const errors = validateEditorialDocument(d)
    expect(errors.join(' ')).toMatch(/unknown reference/)
    expect(errors.join(' ')).toMatch(/unique safe ID/)
    expect(errors.join(' ')).toMatch(/unsafe link/)
    expect(() => parseEditorialDocument(d)).toThrow()
  })
  it('rejects unknown blocks, nested sidecars, mismatched actions and diagram steps', () => {
    const d = fixture()
    d.actions['zoom-cariboo'].targetId = 'nonexistent'
    d.chapters[0].blocks.push({ id: 'bad', type: 'unknown' })
    d.chapters[1].blocks[0].steps[0].content.push({ id: 'nested', type: 'sidecar' })
    d.chapters[2].blocks[0] = { id: 'bad-step', type: 'diagram', diagramId: 'dots', stepId: 'missing' }
    const errors = validateEditorialDocument(d).join(' ')
    expect(errors).toMatch(/unsupported media/)
    expect(errors).toMatch(/unsupported prose/)
    expect(errors).toMatch(/view target/)
    expect(errors).toMatch(/unknown diagram step/)
  })
  it('validates tree integrity, categories, point coordinates and explicit mark budgets', () => {
    const d = fixture()
    d.diagrams.taxonomy.nodes[0].parentId = 'region-5910'
    d.diagrams.dots.points[0].x = 2
    d.diagrams.dots.points[1].categoryId = 'missing'
    d.diagrams.dots.points = Array.from({ length: 1001 }, () => d.diagrams.dots.points[0])
    const errors = validateEditorialDocument(d).join(' ')
    expect(errors).toMatch(/cycle/)
    expect(errors).toMatch(/1–1000/)
    expect(errors).toMatch(/invalid or duplicate point/)
  })
  it('requires a supported map source and accurate map-view references', () => {
    const d = fixture()
    d.maps.regions.layers[0].format = 'climate-grid'
    d.views.cariboo.visibleLayerIds = ['missing']
    expect(validateEditorialDocument(d).join(' ')).toMatch(/geojson or pmtiles/)
    expect(validateEditorialDocument(d).join(' ')).toMatch(/unknown layer/)
  })
  it('keeps radial geometry deterministic and selects the ancestor path', () => {
    const d = parseEditorialDocument(fixture()).diagrams.taxonomy
    if (d.type !== 'radial-hierarchy') throw Error()
    expect(radialHierarchyLayout(d.nodes)).toEqual(radialHierarchyLayout(d.nodes))
    expect(ancestorIds(d.nodes, 'region-5950')).toEqual(new Set(['region-5950', 'bc']))
    expect(radialHierarchyLayout(d.nodes).nodes).toHaveLength(9)
  })
  it('filters dot samples without mutating their stable coordinates', () => {
    const d = parseEditorialDocument(fixture()).diagrams.dots
    if (d.type !== 'category-dots') throw Error()
    const before = structuredClone(d.points)
    const selected = selectedDots(d.points, d.steps[1])
    expect(selected.length).toBeGreaterThan(0)
    expect(selected.length).toBeLessThan(d.points.length)
    expect(selected.every((p) => Math.hypot(p.x - 0.5, p.y - 0.5) <= 0.28)).toBe(true)
    expect(selectedDots(d.points, d.steps[2])).toHaveLength(10)
    expect(d.points).toEqual(before)
  })
})
