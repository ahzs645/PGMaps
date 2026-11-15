import { describe, expect, it } from 'vitest'

import {
  estimateRender,
  formatRemaining,
  HISTORY_KEEP,
  parseRenderHistory,
  queueRemainingMs,
  recordRender,
  remainingMs,
  type RenderTiming,
  type RenderWork,
} from './renderEstimate'

const work: RenderWork = { frames: 3, width: 800, height: 700, samples: 8 }

const timing = (render: number, over: Partial<RenderTiming> = {}): RenderTiming => ({
  engine: 'worldgen',
  at: '2026-11-14T00:00:00Z',
  work,
  ms: { start: 0, scene: 20_000, render, compose: 2_000 },
  ...over,
})

describe('render estimates', () => {
  it('start from the library runs, in the range they measured, and count the cold start once', () => {
    const cold = estimateRender('worldgen', work, [], true)
    const warm = estimateRender('worldgen', work, [], false)
    expect(cold.basis).toBe('library')
    // The library's medians were 70-82 s a viewpoint at 8 samples.
    expect(cold.totalMs).toBeGreaterThan(50_000)
    expect(cold.totalMs).toBeLessThan(120_000)
    expect(cold.totalMs - warm.totalMs).toBe(cold.phases.start)
  })

  it('scale the render phase with samples and pixels', () => {
    const eight = estimateRender('nanite', work, [], false)
    const twentyFour = estimateRender('nanite', { ...work, samples: 24 }, [], false)
    // (4 + 24) / (4 + 8) warm-up and sample renders a frame, less the fixed per-frame cost.
    expect(twentyFour.phases.render).toBeGreaterThan(1.8 * eight.phases.render)
    expect(twentyFour.phases.scene).toBe(eight.phases.scene)
  })

  it('learn this machine’s pace from its own renders, newest first', () => {
    const slow = [timing(120_000), timing(120_000)]
    const measured = estimateRender('worldgen', work, slow, false)
    expect(measured.basis).toBe('measured')
    expect(measured.runs).toBe(2)
    expect(measured.phases.render).toBeGreaterThan(100_000)
    expect(measured.phases.scene).toBe(20_000)
    // Another engine's renders do not count.
    expect(estimateRender('nanite', work, slow, false).basis).toBe('library')
  })

  it('count down with the engine’s own steps, and never below what is left of a phase running over', () => {
    const estimate = estimateRender('worldgen', work, [timing(60_000)], false)
    const atStart = remainingMs(estimate, { phase: 'scene', elapsedMs: 0, phaseElapsedMs: 0 })
    expect(atStart).toBeCloseTo(estimate.totalMs, -2)
    // Half the steps done in 20 s: about 20 s more of rendering, plus composing.
    const half = remainingMs(estimate, {
      phase: 'render',
      elapsedMs: 40_000,
      phaseElapsedMs: 20_000,
      steps: { done: 18, total: 36 },
    })
    const modelOnly = remainingMs(estimate, { phase: 'render', elapsedMs: 40_000, phaseElapsedMs: 20_000 })
    expect(half).toBeLessThan(modelOnly)
    expect(half).toBeGreaterThan(estimate.phases.compose)
    // Steps that run fast after the engine's preparation: their own pace (1 s for half of them), not the phase's clock.
    const late = remainingMs(estimate, {
      phase: 'render',
      elapsedMs: 30_000,
      phaseElapsedMs: 10_000,
      steps: { done: 42, total: 84, sinceFirstMs: 1_000 },
    })
    expect(late).toBeLessThan(
      0.6 * remainingMs(estimate, { phase: 'render', elapsedMs: 30_000, phaseElapsedMs: 10_000 }),
    )
    // One step says nothing yet.
    const first = { phase: 'render' as const, elapsedMs: 40_000, phaseElapsedMs: 20_000 }
    expect(remainingMs(estimate, { ...first, steps: { done: 1, total: 90, sinceFirstMs: 0 } })).toBe(
      remainingMs(estimate, first),
    )
    const over = remainingMs(estimate, { phase: 'scene', elapsedMs: 90_000, phaseElapsedMs: 90_000 })
    expect(over).toBeGreaterThan(estimate.phases.render)
  })

  it('add a queue’s waiting renders to the running one', () => {
    const estimate = estimateRender('worldgen', work, [], false)
    expect(queueRemainingMs(10_000, [estimate, estimate])).toBe(10_000 + 2 * estimate.totalMs)
  })

  it('word the time left as people say it', () => {
    expect(formatRemaining(4_000)).toBe('under 10 s')
    expect(formatRemaining(38_000)).toBe('about 40 s')
    expect(formatRemaining(150_000)).toBe('about 3 min')
    expect(formatRemaining(23 * 60_000)).toBe('about 25 min')
  })

  it('keep the newest renders per engine, and only well-formed stored ones', () => {
    let history: RenderTiming[] = []
    for (let i = 0; i < HISTORY_KEEP + 3; i++) history = recordRender(history, timing(i))
    history = recordRender(history, timing(1, { engine: 'nanite' }))
    expect(history.filter((entry) => entry.engine === 'worldgen')).toHaveLength(HISTORY_KEEP)
    expect(history.at(-1)?.engine).toBe('nanite')
    expect(parseRenderHistory([...history, { engine: 'other' }, { engine: 'nanite', work: {}, ms: {} }])).toHaveLength(
      HISTORY_KEEP + 1,
    )
    expect(parseRenderHistory('nope')).toEqual([])
  })
})
