import { useState } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { createDefaultWeights } from '@/maps/scorebuilder/constants/weights'
import { WalkabilityBuilderControls } from './WalkabilityBuilderControls'
import { ScoreBuilderWalkabilitySurfacePanel } from '@/maps/scorebuilder/components/ScoreBuilderWalkabilitySurfacePanel'
import {
  HEATMAP_DEFAULT_FACTOR_WEIGHTS,
  HEATMAP_EMPTY_OPTIONS,
  HEATMAP_OPTIONS,
  HEATMAP_REPORT_FIDELITY_OPTIONS,
  WALKABILITY_REPORT_FACTOR_REFS,
  type HeatmapFactorWeightState,
  type HeatmapOptionState,
} from '@/maps/pgdata/walkabilityFactors'
import {
  buildSourceGridFactorWeights,
  createDefaultWalkabilitySurfaceTuning,
  createReportFidelityWalkabilitySurfaceTuning,
  type WalkabilitySurfaceTuning,
} from '@/maps/scorebuilder/lib/walkabilitySurface'

function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : text(child))).join('')
}

function button(renderer: ReactTestRenderer, label: string) {
  return renderer.root.findAllByType('button').find((node) => text(node).trim() === label)!
}

const factorInput = (renderer: ReactTestRenderer, ref: string) =>
  renderer.root
    .findAllByType('input')
    .find((node) => node.props.type === 'range' && node.props['aria-label'].startsWith(`${ref} `))!

describe('shared walkability controls in MISC and Index Lab', () => {
  it('keeps MISC presets, factor values and hidden dropped terms intact', () => {
    const initialOptions: HeatmapOptionState = { ...HEATMAP_EMPTY_OPTIONS }
    const initialWeights: HeatmapFactorWeightState = { ...HEATMAP_DEFAULT_FACTOR_WEIGHTS, F0: 1.75 }
    function MiscBuilder() {
      const [currentOptions, setOptions] = useState(initialOptions)
      const [currentWeights, setWeights] = useState(initialWeights)
      return (
        <WalkabilityBuilderControls
          walkability={{
            heatmapOptionState: currentOptions,
            heatmapFactorWeights: currentWeights,
            setHeatmapOptions: setOptions,
            setHeatmapOption: (key, enabled) => setOptions((value) => ({ ...value, [key]: enabled })),
            setHeatmapFactorWeight: (ref, value) => setWeights((current) => ({ ...current, [ref]: value })),
          }}
        />
      )
    }
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(<MiscBuilder />)
    })
    const options = () =>
      renderer.root.findByType(WalkabilityBuilderControls).props.walkability.heatmapOptionState as HeatmapOptionState
    const weights = () =>
      renderer.root.findByType(WalkabilityBuilderControls).props.walkability
        .heatmapFactorWeights as HeatmapFactorWeightState
    try {
      expect(renderer.root.findAllByProps({ type: 'range' })).toHaveLength(0)
      act(() => button(renderer, 'Factor Weights44 active terms; open to tune A0-G5.').props.onClick())
      expect(renderer.root.findAllByProps({ type: 'range' })).toHaveLength(WALKABILITY_REPORT_FACTOR_REFS.length)
      const input = factorInput(renderer, 'F0')
      expect(input.props).toMatchObject({ min: 0, max: 2, step: 0.25, value: 1.75, disabled: false })
      act(() => input.props.onChange({ target: { value: '0.5' } }))
      expect(weights().F0).toBe(0.5)

      act(() => button(renderer, 'Source Rules0 active; open to change included logic.').props.onClick())
      act(() => button(renderer, 'Drop crosswalks').props.onClick())
      expect(options().dropF0).toBe(true)
      expect(factorInput(renderer, 'F0')).toBeUndefined()
      act(() => button(renderer, 'Show off').props.onClick())
      expect(factorInput(renderer, 'F0').props).toMatchObject({ disabled: true, value: 0.5, 'aria-valuetext': 'off' })
      act(() => button(renderer, 'Drop crosswalks').props.onClick())
      expect(factorInput(renderer, 'F0').props).toMatchObject({ disabled: false, value: 0.5 })

      act(() => button(renderer, 'Network emphasis').props.onClick())
      expect(weights().G1).toBe(1.6)
      expect(weights().A0).toBe(0.45)
      act(() => button(renderer, 'Reset').props.onClick())
      expect(options()).toEqual(HEATMAP_REPORT_FIDELITY_OPTIONS)
      expect(weights()).toEqual(HEATMAP_DEFAULT_FACTOR_WEIGHTS)
    } finally {
      act(() => renderer.unmount())
    }
  })

  it('keeps Index Lab direct-control seeding, option toggles and report reset intact', () => {
    const metricWeights = { ...createDefaultWeights(), sidewalkDensity: 20, childcareDensity: 5 }
    function IndexSurface() {
      const [current, setCurrent] = useState<WalkabilitySurfaceTuning>(createDefaultWalkabilitySurfaceTuning)
      return (
        <ScoreBuilderWalkabilitySurfacePanel
          tuning={current}
          onChange={setCurrent}
          metricWeights={metricWeights}
          isDesktop
        />
      )
    }
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(<IndexSurface />)
    })
    const tuning = () =>
      renderer.root.findByType(ScoreBuilderWalkabilitySurfacePanel).props.tuning as WalkabilitySurfaceTuning
    try {
      act(() =>
        renderer.root
          .findAllByType('button')
          .find((node) => node.props['aria-expanded'] === false)!
          .props.onClick(),
      )
      expect(renderer.root.findAllByProps({ type: 'range' })).toHaveLength(0)
      act(() => renderer.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }))
      expect(tuning().enabled).toBe(true)
      expect(tuning().factorWeights).toEqual(buildSourceGridFactorWeights(metricWeights))
      expect(renderer.root.findAllByProps({ type: 'range' })).toHaveLength(WALKABILITY_REPORT_FACTOR_REFS.length)
      expect(renderer.root.findAllByProps({ type: 'checkbox' })).toHaveLength(HEATMAP_OPTIONS.length + 1)
      act(() => factorInput(renderer, 'F0').props.onChange({ target: { value: '1.25' } }))
      expect(tuning().factorWeights.F0).toBe(1.25)
      const crosswalkOption = () =>
        renderer.root
          .findAllByType('label')
          .find((node) => text(node).includes('Drop crosswalks'))!
          .findByType('input')
      act(() => crosswalkOption().props.onChange({ target: { checked: true } }))
      expect(factorInput(renderer, 'F0').props.disabled).toBe(true)
      act(() => crosswalkOption().props.onChange({ target: { checked: false } }))
      expect(factorInput(renderer, 'F0').props).toMatchObject({ value: 1.25, disabled: false })
      act(() => button(renderer, 'Report defaults').props.onClick())
      expect(tuning()).toEqual(createReportFidelityWalkabilitySurfaceTuning())
      const directControl = renderer.root.findAllByProps({ type: 'checkbox' })[0]
      act(() => directControl.props.onChange({ target: { checked: false } }))
      expect(tuning().enabled).toBe(false)
      expect(renderer.root.findAllByProps({ type: 'range' })).toHaveLength(0)
    } finally {
      act(() => renderer.unmount())
    }
  })
})
