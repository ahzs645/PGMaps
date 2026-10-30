import { describe, expect, it } from 'vitest'
import { createEngineeringDesign } from './engineeringTypes'
import { importRoadLibrary, parseProject, serializeProject } from './project'
import { createDemoProject, DEFAULT_TEMPLATE } from './terrain'
import { addVerticalAlternative, setVerticalAlternativeCostMode } from './verticalAlternatives'
import type { Alignment, AlignmentEngineering, RoadTemplate } from './types'

function road(): Alignment {
  const engineering = createEngineeringDesign()
  engineering.materials = [
    {
      id: 'soil',
      name: 'Reviewed soil',
      color: '#997744',
      cutRate: 5,
      reusableFraction: 0.8,
      compactionFactor: 0.9,
      quality: 70,
    },
    {
      id: 'strip',
      name: 'Organic stripping',
      color: '#765432',
      cutRate: 3,
      reusableFraction: 0,
      compactionFactor: 1,
      purpose: 'stripping',
    },
  ]
  engineering.templates = [{ id: 'old-template', name: 'Original section', template: { ...DEFAULT_TEMPLATE } }]
  engineering.assignments = [{ id: 'a', start: 0, end: 100, templateId: 'old-template', side: 'both', transitionM: 0 }]
  engineering.strata = [{ id: 'h', start: 0, end: 100, materialId: 'soil', topDepthM: 0, bottomDepthM: null }]
  return {
    id: 'r',
    name: 'Reference retention',
    color: '#16817a',
    points: [
      { id: 's', coordinate: [-122.8, 53.9], radiusM: 0 },
      { id: 'e', coordinate: [-122.8, 53.901], radiusM: 0 },
    ],
    vertical: [
      { id: 'v0', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'v1', chainage: 100, elevation: 801, curveLength: 0 },
    ],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
    engineering,
  }
}
const layer = (materialId = 'soil'): NonNullable<RoadTemplate['layers']>[number] => ({
  id: 'base-course',
  name: 'Base course',
  side: 'both',
  depthM: 0.2,
  materialId,
})
const component = (materialId = 'soil'): NonNullable<RoadTemplate['components']>[number] => ({
  id: 'key',
  name: 'Rock key',
  side: 'right',
  kind: 'key',
  condition: 'fill',
  widthM: 1,
  riseM: 0,
  depthM: 0.5,
  materialId,
})
const library = (materials: AlignmentEngineering['materials'] = []) => ({
  schema: 'pgmaps-road-library-v1',
  templates: [{ id: 'new-template', name: 'New library section', template: { ...DEFAULT_TEMPLATE } }],
  materials,
})
const requirement = () => ({ id: 'q', start: 0, end: 100, layer: 'subgrade', replaceable: false, materialId: 'soil' })
const preparation = () => ({
  id: 'p',
  start: 0,
  end: 100,
  depthM: 0.2,
  leftInsideM: 0,
  rightInsideM: 0,
  leftOutsideM: 0,
  rightOutsideM: 0,
  materialId: 'strip',
})
const site = () => ({
  id: 'pit',
  name: 'Known borrow',
  kind: 'borrow' as const,
  chainage: 0,
  accessDistanceM: 20,
  capacityM3: 1000,
  unitRate: 3,
  fixedCost: 100,
  materialId: 'soil',
})
const sidecast = () => ({ id: 'cast', start: 0, end: 100, capacityBankM3PerM: 1, unitRate: 2, materialIds: ['soil'] })

describe('library reference retention', () => {
  it('protects project-wide source material classes supplied by the caller during replacement', () => {
    const a = road()
    const before = structuredClone(a)
    expect(() =>
      importRoadLibrary(a, library(), 'replace', { retainedMaterialIds: ['soil', 'other-road-material'] }),
    ).toThrow('Reviewed project source quote still uses material soil')
    expect(() =>
      importRoadLibrary(a, library([{ ...a.engineering!.materials[0], quality: 10 }]), 'replace', {
        retainedMaterialIds: ['soil'],
      }),
    ).toThrow('No project inputs were changed')
    const unchangedClass = importRoadLibrary(a, library(a.engineering!.materials), 'replace', {
      retainedMaterialIds: ['soil'],
    })
    expect(unchangedClass.engineering!.materials).toEqual(a.engineering!.materials)
    expect(
      importRoadLibrary(a, library(), 'replace', { retainedMaterialIds: ['other-road-material'] }).engineering!
        .materials,
    ).toEqual([])
    expect(a).toEqual(before)
  })
  it('remaps imported component/layer materials across collisions without rebinding existing work', () => {
    const a = road()
    a.template = { ...a.template, layers: [layer()], components: [component()] }
    a.engineering!.sitePreparation = [preparation()]
    a.engineering!.fillRequirements = [requirement()]
    a.engineering!.sites = [site()]
    a.engineering!.haul.sidecastRanges = [sidecast()]
    a.engineering!.templates.push({
      id: 'library-1',
      name: 'Generated existing name',
      template: { ...DEFAULT_TEMPLATE },
    })
    const source = {
      schema: 'pgmaps-road-library-v1',
      materials: [{ ...a.engineering!.materials[0], name: 'Imported rock', cutRate: 90 }],
      templates: [
        {
          id: 'soil',
          name: 'Imported template',
          template: {
            ...DEFAULT_TEMPLATE,
            components: [{ ...component(), id: 'imported-key' }],
            layers: [{ ...layer(), id: 'imported-course' }],
          },
        },
      ],
    }
    const beforeRoad = structuredClone(a),
      beforeSource = structuredClone(source)
    const merged = importRoadLibrary(a, source, 'merge')
    const material = merged.engineering!.materials.find((m) => m.name === 'Imported rock')!
    const imported = merged.engineering!.templates.find((t) => t.name === 'Imported template')!
    expect(material.id).not.toBe('soil')
    expect(imported.id).not.toBe('soil')
    expect(imported.id).not.toBe(material.id)
    expect(imported.template.components![0].materialId).toBe(material.id)
    expect(imported.template.layers![0].materialId).toBe(material.id)
    expect(merged.template).toEqual(beforeRoad.template)
    for (const field of ['strata', 'assignments', 'sitePreparation', 'fillRequirements', 'sites', 'haul'] as const)
      expect(merged.engineering![field]).toEqual(beforeRoad.engineering![field])
    expect(a).toEqual(beforeRoad)
    expect(source).toEqual(beforeSource)
  })

  it.each([
    [
      'base surface course',
      (a: Alignment) => {
        a.template.layers = [layer()]
      },
    ],
    [
      'base keyed component',
      (a: Alignment) => {
        a.template.components = [component()]
      },
    ],
    [
      'site preparation',
      (a: Alignment) => {
        a.engineering!.sitePreparation = [preparation()]
      },
    ],
    [
      'fill requirement',
      (a: Alignment) => {
        a.engineering!.fillRequirements = [requirement()]
      },
    ],
    [
      'haul site',
      (a: Alignment) => {
        a.engineering!.sites = [site()]
      },
    ],
    [
      'sidecast restriction',
      (a: Alignment) => {
        a.engineering!.haul.sidecastRanges = [sidecast()]
      },
    ],
  ] as const)('rejects replacement that would erase the material identity used by %s', (_label, setReference) => {
    const a = road()
    setReference(a)
    const before = structuredClone(a)
    expect(() => importRoadLibrary(a, library(), 'replace')).toThrow('No project inputs were changed')
    expect(a).toEqual(before)
  })

  it('rejects a same-ID material rebind and a custom demand target lost with template assignments', () => {
    const a = road()
    a.template.layers = [layer()]
    expect(() => importRoadLibrary(a, library([{ ...a.engineering!.materials[0], cutRate: 999 }]), 'replace')).toThrow(
      'still uses material soil',
    )
    delete a.template.layers
    a.engineering!.templates[0].template.layers = [{ ...layer(), id: 'custom-course' }]
    a.engineering!.fillRequirements = [{ ...requirement(), layer: 'custom-course' }]
    expect(() => importRoadLibrary(a, library(a.engineering!.materials), 'replace')).toThrow(
      'targets named-template layer custom-course',
    )
  })

  it('retains compatible preparation, fill, supply, sidecast and base assembly when replacement is explicit', () => {
    const a = road()
    a.template = { ...a.template, components: [component()], layers: [layer()] }
    a.engineering!.sitePreparation = [preparation()]
    a.engineering!.fillRequirements = [requirement()]
    a.engineering!.sites = [site()]
    a.engineering!.haul.sidecastRanges = [sidecast()]
    const replaced = importRoadLibrary(a, library(a.engineering!.materials), 'replace')
    expect(replaced.engineering!.assignments).toEqual([])
    expect(replaced.engineering!.strata).toEqual([])
    expect(replaced.template).toEqual(a.template)
    for (const field of ['sitePreparation', 'fillRequirements', 'sites', 'haul'] as const)
      expect(replaced.engineering![field]).toEqual(a.engineering![field])
  })

  it('updates only the active independent profile library and preserves pending profile edits through project reopen', () => {
    let a = setVerticalAlternativeCostMode(road(), 'independent')
    a = addVerticalAlternative(a, 'v2', 'Independent profile')
    const inactive = structuredClone(a.verticalAlternatives!.find((v) => v.id === 'original-profile'))
    a = { ...a, vertical: a.vertical.map((p) => ({ ...p, elevation: p.elevation - 1 })) }
    const source = library([{ ...a.engineering!.materials[0], name: 'Imported material' }])
    const merged = importRoadLibrary(a, source, 'merge')
    const active = merged.verticalAlternatives!.find((v) => v.id === 'v2')!
    expect(active.vertical[0].elevation).toBe(799)
    expect(active.engineering!.materials).toEqual(merged.engineering!.materials)
    expect(merged.verticalAlternatives!.find((v) => v.id === 'original-profile')).toEqual(inactive)
    const project = {
      ...createDemoProject(),
      alignments: [merged],
      activeAlignmentId: merged.id,
      context: [],
      cables: [],
      profiles: [],
    }
    const loaded = parseProject(serializeProject(project)).alignments[0]
    expect(loaded.verticalAlternatives).toEqual(merged.verticalAlternatives)
    const replaced = importRoadLibrary(merged, library(merged.engineering!.materials), 'replace')
    expect(replaced.verticalAlternatives!.find((v) => v.id === 'original-profile')).toEqual(inactive)
    expect(replaced.verticalAlternatives!.find((v) => v.id === 'v2')!.engineering!.assignments).toEqual([])
  })

  it('requires imported templates to carry their own materials, even if the target has a matching ID', () => {
    const a = road()
    const source = {
      ...library(),
      templates: [{ id: 'missing', name: 'Incomplete template', template: { ...DEFAULT_TEMPLATE, layers: [layer()] } }],
    }
    expect(() => importRoadLibrary(a, source, 'merge')).toThrow('unknown material')
  })
})
