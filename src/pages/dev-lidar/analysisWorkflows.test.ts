import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import {
  ANALYSIS_MODES,
  INITIAL_ANALYSIS,
  analysisPresentation,
  featureCentre,
  readReviewLedger,
  sortedWorkflowFeatures,
  type ModelData,
  type WorkflowData,
} from './analysisWorkflows'
import { initialLidarStyle, LABEL_ANCHOR } from './basemaps'
import { applyWorkflowLayers, installWorkflowLayers, WORKFLOW_LAYERS } from './workflowMapLayers'
import { isForestMode, type ForestData } from './forestry'
import { meshVertices } from './buildingMesh'

const forestry = JSON.parse(readFileSync(new URL('./forestry.generated.json', import.meta.url), 'utf8')) as ForestData
const workflows = JSON.parse(
  readFileSync(new URL('./workflows.generated.json', import.meta.url), 'utf8'),
) as WorkflowData
const models = JSON.parse(readFileSync(new URL('./models.generated.json', import.meta.url), 'utf8')) as ModelData

describe('actual processed workflow data and selections', () => {
  it('changes gap thresholds/area and retains boundary evidence without silently calling it forest', () => {
    expect(workflows.gaps['2'].features).toHaveLength(442)
    const options = { ...INITIAL_ANALYSIS, mode: 'gaps' as const }
    expect(sortedWorkflowFeatures(workflows, options)).toHaveLength(377)
    expect(sortedWorkflowFeatures(workflows, { ...options, threshold: 5 })).toHaveLength(696)
    const all = sortedWorkflowFeatures(workflows, { ...options, enclosed: false })
    expect(all).toHaveLength(442)
    expect(all.some((f) => f.properties.boundary_clipped)).toBe(true)
    const large = sortedWorkflowFeatures(workflows, { ...options, minGap: 500 })
    expect(large.every((f) => f.properties.area_m2! >= 500)).toBe(true)
    expect(large.length).toBeLessThan(377)
    expect(featureCentre(all[0]).every(Number.isFinite)).toBe(true)
  })
  it('changes plot scale/coverage with explicit denominators and ranks P95', () => {
    const options = { ...INITIAL_ANALYSIS, mode: 'plots' as const, support: 0 }
    expect(sortedWorkflowFeatures(workflows, options)).toHaveLength(924)
    expect(sortedWorkflowFeatures(workflows, { ...options, plotSize: 25 })).toHaveLength(3693)
    const complete = sortedWorkflowFeatures(workflows, { ...options, support: 100 })
    expect(complete.length).toBeGreaterThan(0)
    expect(complete.length).toBeLessThan(924)
    expect(complete.every((f) => f.properties.sampled_m2 === 2500 && f.properties.support_percent === 100)).toBe(true)
    expect(complete[0].properties.p95_m!).toBeGreaterThanOrEqual(complete[1].properties.p95_m!)
  })
  it('filters proximity by finite distance and distinguishes thresholds and missing matches', () => {
    const options = { ...INITIAL_ANALYSIS, mode: 'clearance' as const, clearance: 30 }
    const near = sortedWorkflowFeatures(workflows, { ...options, clearance: 5 })
    expect(near.length).toBeGreaterThan(0)
    expect(near.length).toBeLessThanOrEqual(sortedWorkflowFeatures(workflows, options).length)
    expect(near.every((f) => f.properties.distance_m !== null && f.properties.distance_m! <= 5)).toBe(true)
    for (const threshold of [2, 5]) {
      expect(workflows.clearance[String(threshold)].features).toHaveLength(178)
      for (const { properties: p } of workflows.clearance[String(threshold)].features) {
        if (p.distance_m !== null) {
          expect(p.cell_distance_min_m!).toBeLessThanOrEqual(p.distance_m!)
          expect(p.cell_distance_max_m!).toBeGreaterThanOrEqual(p.distance_m!)
        }
      }
    }
  })
  it('uses actual Roofer results and creates finite local-origin triangle buffers for every patch', () => {
    expect(models.engine.version).toMatch(/^roofer 1\.0\.0 /)
    expect(models.records).toHaveLength(178)
    expect(models.records.reduce((n, m) => n + m.facets.length, 0)).toBe(392)
    for (const model of models.records) {
      expect(model.success).toBe(true)
      expect(model.closed_edge_incidence).toBe(true)
      const { vertices } = meshVertices(model, model.ground_m)
      expect(vertices.length).toBe(model.triangles.length * 18)
      expect(Array.from(vertices).every(Number.isFinite)).toBe(true)
      expect(model.triangles.length).toBeGreaterThan(0)
    }
  })
  it('imports only source-matched review decisions with known IDs', () => {
    const ids = new Set(models.records.map((m) => m.id)),
      id = models.records[0].id
    const ledger = {
      schema_version: 1,
      source_sha256: models.source_sha256,
      records: { [id]: { decision: 'retain', note: 'Inspect edge against imagery' } },
    }
    expect(readReviewLedger(JSON.stringify(ledger), models.source_sha256, ids)[id].decision).toBe('retain')
    expect(() => readReviewLedger(JSON.stringify(ledger), 'other', ids)).toThrow()
    expect(() =>
      readReviewLedger(
        JSON.stringify({ ...ledger, records: { unknown: { decision: 'retain', note: '' } } }),
        models.source_sha256,
        ids,
      ),
    ).toThrow()
    expect(() =>
      readReviewLedger(
        JSON.stringify({ ...ledger, records: { [id]: { decision: 'verified', note: '' } } }),
        models.source_sha256,
        ids,
      ),
    ).toThrow()
  })
})

describe('workflow map integration', () => {
  it('installs once, validates style and clears every previous overlay during repeated transitions', () => {
    const style = initialLidarStyle('vector')
    const visibility: Record<string, unknown> = {}
    const sources = new Map<string, { setData: (data: unknown) => void }>()
    const datasets = new Map<string, unknown>()
    const map = {
      getSource: (id: string) => sources.get(id),
      addSource: (id: string, value: unknown) => {
        if (sources.has(id)) throw Error('Duplicate source')
        style.sources[id] = value as never
        sources.set(id, { setData: (data) => datasets.set(id, data) })
      },
      getLayer: (id: string) => style.layers.find((l) => l.id === id),
      addLayer: (layer: (typeof style.layers)[number], before?: string) => {
        if (style.layers.some((l) => l.id === layer.id)) throw Error('Duplicate layer')
        if (before)
          style.layers.splice(
            style.layers.findIndex((l) => l.id === before),
            0,
            layer,
          )
        else style.layers.push(layer)
      },
      setPaintProperty: () => {},
      setLayoutProperty: (id: string, _key: string, value: unknown) => {
        visibility[id] = value
      },
    }
    installWorkflowLayers(map as never)
    installWorkflowLayers(map as never)
    expect(validateStyleMin(style)).toEqual([])
    expect(style.layers.findIndex((l) => l.id === 'workflow-forest')).toBeLessThan(
      style.layers.findIndex((l) => l.id === LABEL_ANCHOR),
    )
    for (const mode of [...ANALYSIS_MODES, ...ANALYSIS_MODES]) {
      const state = analysisPresentation(mode.id)
      expect(state.cloud).toBe(false)
      expect(state.surfaceVisible).toBe(false)
      expect(state.reference).toBe(false)
      expect(state.buildings).toBe(mode.id === 'clearance')
      expect(state.basemap).toBe(mode.basemap)
      const options = { ...INITIAL_ANALYSIS, mode: mode.id }
      const rows = sortedWorkflowFeatures(workflows, options, forestry)
      for (const id of WORKFLOW_LAYERS) visibility[id] = 'visible'
      applyWorkflowLayers(map as never, options, rows, rows[0]?.properties.id ?? null)
      const active = Object.entries(visibility)
        .filter(([, v]) => v === 'visible')
        .map(([k]) => k)
      expect(active).toEqual(
        isForestMode(mode.id)
          ? ['workflow-forest', 'workflow-forest-lines', 'workflow-selected']
          : mode.id === 'gaps'
            ? ['workflow-gaps', 'workflow-selected']
            : mode.id === 'plots'
              ? ['workflow-plots', 'workflow-plot-lines', 'workflow-selected']
              : mode.id === 'clearance'
                ? ['workflow-clearance', 'workflow-selected']
                : [],
      )
    }
    applyWorkflowLayers(map as never, INITIAL_ANALYSIS, [], null)
    expect(Object.values(visibility).every((value) => value === 'none')).toBe(true)
    expect(datasets.get('workflow-features')).toEqual({ type: 'FeatureCollection', features: [] })
  })
})
