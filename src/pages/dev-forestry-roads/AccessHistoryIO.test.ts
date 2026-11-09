import { describe, expect, it } from 'vitest'
import {
  accessHistoryBundle,
  accessHistoryReport,
  applyAccessHistoryBundle,
  parseAccessHistoryBundle,
} from './AccessHistoryIO'
import { createAccessHistoryState, MAX_HISTORY_IMPORT_BYTES } from './accessHistory'
import { parseProject } from './project'
import { createAccessHistoryTrainingProject } from './trainingAccessHistoryScenario'

describe('portable historical access review', () => {
  it('round-trips routes, dated evidence and identities without duplicating context', () => {
    const project = parseProject(createAccessHistoryTrainingProject())
    const parsed = parseAccessHistoryBundle(accessHistoryBundle(project.context, project.accessHistory!))
    const restored = applyAccessHistoryBundle(project, parsed)
    expect(restored.context).toEqual(project.context)
    expect(restored.accessHistory).toEqual(project.accessHistory)
    expect(parsed.context.some((feature) => feature.kind === 'stream')).toBe(false)
    expect(restored.context.some((feature) => feature.kind === 'stream')).toBe(true)
  })

  it('does not transfer a reuse opt-in from another project', () => {
    const source = parseProject(createAccessHistoryTrainingProject())
    source.context = source.context.map((feature) => ({
      ...feature,
      ...(feature.roadEvidence ? { roadEvidence: { ...feature.roadEvidence, reuseAllowed: true } } : {}),
    }))
    const bundle = parseAccessHistoryBundle(accessHistoryBundle(source.context, source.accessHistory!))
    const target = { ...source, context: [], accessHistory: createAccessHistoryState() }
    const restored = applyAccessHistoryBundle(target, bundle)
    expect(
      restored.context
        .filter((feature) => feature.roadEvidence)
        .every((feature) => !feature.roadEvidence!.reuseAllowed),
    ).toBe(true)
    expect(target.context).toEqual([])
    expect(bundle.context.some((feature) => feature.roadEvidence?.reuseAllowed)).toBe(true)
  })

  it('rejects conflicting feature identities atomically', () => {
    const project = parseProject(createAccessHistoryTrainingProject())
    const bundle = parseAccessHistoryBundle(accessHistoryBundle(project.context, project.accessHistory!))
    bundle.context[0] = { ...bundle.context[0], name: 'Different block with an existing ID' }
    const before = JSON.stringify(project)
    expect(() => applyAccessHistoryBundle(project, bundle)).toThrow('already exists with different data')
    expect(JSON.stringify(project)).toBe(before)
  })

  it('rejects missing source references and oversized payloads before import', () => {
    const project = createAccessHistoryTrainingProject()
    const bundle = JSON.parse(accessHistoryBundle(project.context, project.accessHistory!))
    bundle.accessHistory.events[0].sourceIds = ['missing-source']
    expect(() => parseAccessHistoryBundle(JSON.stringify(bundle))).toThrow('missing')
    expect(() => parseAccessHistoryBundle(' '.repeat(MAX_HISTORY_IMPORT_BYTES + 1))).toThrow('10 MB')
  })

  it('exports source reasoning, temporal evidence and unknowns without fabricated prices', () => {
    const project = createAccessHistoryTrainingProject()
    const report = accessHistoryReport(project.name, project.context, project.accessHistory!)
    expect(report).toContain('inferred-access')
    expect(report).toContain('Synthetic')
    expect(report).toContain('## Sources')
    expect(report).toContain('## Road events')
    expect(report).toContain('## Structures and reported restrictions')
    expect(report).toContain('unknown')
    expect(report).not.toContain('$')
  })
})
