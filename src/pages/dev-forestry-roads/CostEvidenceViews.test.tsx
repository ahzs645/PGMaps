import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EvidenceBrowser } from './CostEvidenceViews'
import { AdoptRecord, RateAdoptionContext, type RateAdoptionTarget } from './RateAdoption'
import { createDemoProject } from './terrain'
import { createEngineeringDesign } from './engineeringTypes'
import { withCulvertCostDefault } from './culvertCostDefaults'
import { adoptionTargets } from './costEvidence/adoptionTargets'
import { assembleCostEvidence } from './costEvidence/loadCostEvidence'
import type { EvidenceFilter } from './costEvidence/costEvidence'
import local from './costEvidence/bcLocal.generated.json'
import projects from './costEvidence/bcProjects.generated.json'
import external from './costEvidence/external.generated.json'
import additions from './costEvidence/additions.generated.json'

// Only the popover and select need browser surfaces. The disclosure, form, validation, source
// observations and submission callback are the real components and rules.
vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement('span', { 'aria-label': label }, children),
}))
vi.mock('./Controls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./Controls')>()),
  RoadSelect: (await import('./roadSelectTestDouble')).RoadSelectTestDouble,
}))

const albertaId = 'alberta-upa-2026-4'
const labradorId = 'allnorth-labrador-2024-4'
const catalogue = assembleCostEvidence(local, projects, external, additions)
const culvertCatalogue = {
  ...catalogue,
  records: catalogue.records.filter((record) => [albertaId, labradorId].includes(record.id)),
}
const filter: EvidenceFilter = { place: 'all', kind: 'all', regionId: 'all', query: 'culvert' }
const text = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : text(child))).join('')
const byTestId = (root: ReactTestInstance, id: string) =>
  root.find((node) => typeof node.type === 'string' && node.props['data-testid'] === id)
const namedControl = (root: ReactTestInstance, tag: string, label: string) =>
  root.find((node) => node.type === tag && node.props['aria-label'] === label)
const sourceToggle = (root: ReactTestInstance, source: string) =>
  root.find(
    (node) => node.type === 'button' && node.props['aria-expanded'] !== undefined && text(node).includes(source),
  )

let renderer: ReactTestRenderer | undefined
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
})

function fixture() {
  const project = createDemoProject()
  const road = project.alignments.find((alignment) => alignment.id === project.activeAlignmentId)!
  road.engineering = createEngineeringDesign()
  road.engineering.culverts = ['one', 'two'].map((id, index) =>
    withCulvertCostDefault({
      id,
      name: `Cross-drain ${index + 1}`,
      kind: 'cross-drain',
      chainage: 50 + index * 100,
      skewDegrees: 0,
      lengthM: 12,
      diameterM: 0.6,
      inletInvertM: null,
      outletInvertM: null,
      minCoverM: 0.6,
      unitCost: 0,
      fixedCost: 0,
    }),
  )
  const onAdopt = vi.fn<RateAdoptionTarget['onAdopt']>()
  const keys = road.engineering.culverts.map((culvert) => `${road.id}/culvert:${culvert.id}.unitCost`)
  const view = (sequence: number, key = keys[0]) => (
    <RateAdoptionContext.Provider
      value={{
        project,
        currency: 'CAD',
        targets: adoptionTargets(project),
        scheduleItems: [],
        onAdopt,
        preferredTargetKey: key,
        openRecordId: albertaId,
        requestSequence: sequence,
      }}
    >
      <EvidenceBrowser
        catalogue={culvertCatalogue}
        filter={filter}
        onFilter={vi.fn()}
        focusRecordId={albertaId}
        focusSequence={sequence}
      />
    </RateAdoptionContext.Provider>
  )
  return { project, onAdopt, keys, view }
}

describe('reviewing a provisional culvert price in its evidence browser', () => {
  it('opens the requested source and culvert without writing, and a new request reopens a folded source', async () => {
    const { project, onAdopt, keys, view } = fixture()
    const before = structuredClone(project)
    await act(async () => {
      renderer = create(view(1))
    })
    const root = renderer!.root
    const sourceNames = root
      .findAll((node) => node.type === 'button' && node.props['aria-expanded'] !== undefined)
      .map(text)
    expect(sourceNames[0]).toContain('Alberta tender averages')
    expect(sourceToggle(root, 'Alberta tender averages').props['aria-expanded']).toBe(true)
    expect(sourceToggle(root, 'Allnorth').props['aria-expanded']).toBe(false)
    let form = byTestId(root, 'road-rate-adopt-form')
    expect(namedControl(form, 'select', 'Project rate to inform').props.value).toBe(keys[0])
    expect(namedControl(form, 'input', 'Adopted rate (CAD/m)').props.value).toBe('372.67')
    expect(byTestId(form, 'road-rate-adopt-save').props.disabled).toBe(true)
    expect(text(form)).toContain("'2026 UPA '!B39:H39")
    expect(onAdopt).not.toHaveBeenCalled()
    expect(project).toEqual(before)

    await act(async () => sourceToggle(root, 'Alberta tender averages').props.onClick())
    expect(root.findAllByProps({ 'data-testid': 'road-rate-adopt-form' })).toHaveLength(0)
    await act(async () => renderer!.update(view(1)))
    expect(sourceToggle(root, 'Alberta tender averages').props['aria-expanded']).toBe(false)
    // Repeated CTA requests are events, even when the requested source and query are unchanged.
    await act(async () => renderer!.update(view(2, keys[1])))
    expect(sourceToggle(root, 'Alberta tender averages').props['aria-expanded']).toBe(true)
    form = byTestId(root, 'road-rate-adopt-form')
    expect(namedControl(form, 'select', 'Project rate to inform').props.value).toBe(keys[1])
    expect(namedControl(form, 'input', 'Adopted rate (CAD/m)').props.value).toBe('372.67')
    expect(byTestId(form, 'road-rate-adopt-save').props.disabled).toBe(true)
    expect(onAdopt).not.toHaveBeenCalled()
    expect(project).toEqual(before)
  })

  it('carries the requested culvert into another record opened by hand, with that record’s own price', async () => {
    const { project, onAdopt, keys, view } = fixture()
    const before = structuredClone(project)
    await act(async () => {
      renderer = create(view(1, keys[1]))
    })
    const root = renderer!.root
    await act(async () => sourceToggle(root, 'Allnorth').props.onClick())
    const other = root.findAllByType(AdoptRecord).find((node) => node.props.record.id === labradorId)!
    expect(other.findAllByProps({ 'data-testid': 'road-rate-adopt-form' })).toHaveLength(0)
    await act(async () => byTestId(other, 'road-rate-adopt-open').props.onClick())
    const form = byTestId(other, 'road-rate-adopt-form')
    expect(namedControl(form, 'select', 'Project rate to inform').props.value).toBe(keys[1])
    expect(namedControl(form, 'input', 'Adopted rate (CAD/m)').props.value).toBe('1000')
    expect(text(form)).toContain('2023')
    expect(byTestId(form, 'road-rate-adopt-save').props.disabled).toBe(true)
    expect(onAdopt).not.toHaveBeenCalled()
    expect(project).toEqual(before)
  })

  it('writes only on a confirmed Save, carrying the entered rate, reason and exact source observation together', async () => {
    const { project, onAdopt, keys, view } = fixture()
    const before = structuredClone(project)
    await act(async () => {
      renderer = create(view(1))
    })
    const root = renderer!.root
    const form = byTestId(root, 'road-rate-adopt-form')
    await act(async () =>
      namedControl(form, 'input', 'Adopted rate (CAD/m)').props.onChange({ target: { value: '425' } }),
    )
    expect(byTestId(form, 'road-rate-adopt-save').props.disabled).toBe(true)
    const confirmation = form.find((node) => node.type === 'label' && text(node) === 'The specification matches')
    await act(async () => confirmation.findByType('input').props.onChange({ target: { checked: true } }))
    expect(byTestId(form, 'road-rate-adopt-save').props.disabled).toBe(true)
    expect(text(byTestId(form, 'road-rate-adopt-problem'))).toContain('Say why the adopted rate differs')
    const reason = 'Synthetic local installed quote, including delivery to the site.'
    await act(async () =>
      namedControl(form, 'textarea', 'Reason for any adjustment').props.onChange({ target: { value: reason } }),
    )
    expect(byTestId(form, 'road-rate-adopt-save').props.disabled).toBe(false)
    expect(onAdopt).not.toHaveBeenCalled()
    expect(project).toEqual(before)

    await act(async () => byTestId(form, 'road-rate-adopt-save').props.onClick())
    expect(onAdopt).toHaveBeenCalledTimes(1)
    expect(onAdopt).toHaveBeenCalledWith(
      keys[0],
      expect.objectContaining({
        rate: 425,
        reason,
        specificationConfirmed: true,
        currency: 'CAD',
        includes: ['supply', 'installation'],
        adoptedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        observation: expect.objectContaining({
          recordId: albertaId,
          currency: 'CAD',
          costYear: 2026,
          unit: '/m',
          amounts: { value: 372.67 },
          locator: "'2026 UPA '!B39:H39",
        }),
      }),
      'Cross-drain 1 installed cost',
    )
    expect(text(byTestId(root, 'road-rate-adopt-saved'))).toContain('Cross-drain 1 installed cost set to $425.00/m')
    expect(project).toEqual(before)
    await act(async () => renderer!.update(view(2)))
    expect(byTestId(root, 'road-rate-adopt-save').props.disabled).toBe(true)
    expect(onAdopt).toHaveBeenCalledTimes(1)
  })
})
