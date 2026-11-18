import { createElement, type ReactElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_POUR_POINT_SNAP_M, DEFAULT_WATERSHED_MIN_AREA_HA } from './drainageCatchments'
import { DEFAULT_DRAINAGE_SETTINGS } from './drainageRun'
import { DrainagePanel } from './DrainagePanel'
import { DrainageRoutingFields, PourPointFields, routingSummary, WatershedFields } from './DrainageFields'
import { DEFAULT_GROUND_DRAINAGE_SETTINGS, type GroundDrainageState } from './groundDrainage'
import { GroundDrainagePanel } from './GroundDrainagePanel'
import type { useGroundDrainage } from './useGroundDrainage'

vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children }: { children: ReactNode }) => createElement('aside', {}, children),
}))

let renderer: ReactTestRenderer | undefined
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
})
const text = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(text).join('')
async function draw(element: ReactElement) {
  await act(async () => {
    renderer = create(element)
  })
  return renderer!.root
}
/** The labels of every field drawn, in order: number fields by `label`, selects by `ariaLabel`. */
const fieldLabels = (root: ReactTestInstance) =>
  root
    .findAll((n) => typeof n.type !== 'string' && (typeof n.props.label === 'string' || 'onValueChange' in n.props))
    .map((n) => (typeof n.props.label === 'string' ? n.props.label : n.props.ariaLabel) as string)
    .filter((label, i, all) => all.indexOf(label) === i)
const buttonText = (root: ReactTestInstance) => root.findAll((n) => n.type === 'button').map(text)

const roadPanel = () =>
  createElement(DrainagePanel, {
    run: null,
    stale: false,
    settings: DEFAULT_DRAINAGE_SETTINGS,
    onSettings: vi.fn(),
    onRun: vi.fn(),
    busy: false,
    onStation: vi.fn(),
    onPickPourPoint: vi.fn(),
    onPourPointChange: vi.fn(),
    onWatershedMinAreaChange: vi.fn(),
  })
const groundHook = {
  result: null,
  current: false,
  stale: false,
  progress: null,
  error: null,
  outlet: null,
  outletError: null,
  run: vi.fn(),
  cancel: vi.fn(),
} as unknown as ReturnType<typeof useGroundDrainage>
const groundPanel = (state?: GroundDrainageState, onChange = vi.fn()) =>
  createElement(GroundDrainagePanel, {
    state,
    onChange,
    blocks: [],
    drawing: false,
    onDraw: vi.fn(),
    onImport: vi.fn(),
    importChoices: null,
    onChooseImport: vi.fn(),
    picking: false,
    onPickOutlet: vi.fn(),
    drainage: groundHook,
    sourceM: 1,
    onClose: vi.fn(),
  })

describe('the drainage fields both tools share', () => {
  it('draws the routing and pour-point fields with the same labels in the road check and the ground card', async () => {
    const road = fieldLabels(await draw(roadPanel()))
    const ground = fieldLabels(await draw(groundPanel()))
    const shared = [
      'Stream from (ha)',
      'Upslope buffer (m)',
      'Depression treatment',
      'Working grid',
      'Pour-point snap (m)',
      'Outlet snap policy',
    ]
    for (const label of shared) {
      expect(road).toContain(label)
      expect(ground).toContain(label)
    }
    // Only the road check chooses which surface a pour point is read on.
    expect(road).toContain('Catchment surface')
    expect(ground).not.toContain('Catchment surface')
  })

  it('reports routing changes as a patch, with explicit policies', async () => {
    const onChange = vi.fn()
    const root = await draw(
      createElement(DrainageRoutingFields, {
        value: { streamThresholdHa: 1, reachM: 250 },
        onChange,
        reach: { min: 20, max: 2000, hint: 'Buffer' },
        customCellM: 7,
      }),
    )
    const select = (label: string) =>
      root.find((n) => n.props.ariaLabel === label && typeof n.props.onValueChange === 'function')
    await act(async () => select('Depression treatment').props.onValueChange('depth-limited'))
    expect(onChange).toHaveBeenLastCalledWith({ depressionPolicy: { mode: 'depth-limited', maxDepthM: 0.5 } })
    await act(async () => select('Depression treatment').props.onValueChange('fill-all'))
    expect(onChange).toHaveBeenLastCalledWith({ depressionPolicy: { mode: 'fill-all' } })
    await act(async () => select('Working grid').props.onValueChange('custom'))
    expect(onChange).toHaveBeenLastCalledWith({ workingResolutionM: 7 })
    await act(async () => select('Working grid').props.onValueChange('automatic'))
    expect(onChange).toHaveBeenLastCalledWith({ workingResolutionM: undefined })
    const reach = root.find((n) => n.props.label === 'Upslope buffer (m)' && typeof n.type !== 'string')
    expect([reach.props.min, reach.props.max]).toEqual([20, 2000])
  })

  it('turns watersheds on at one smallest area in both tools', async () => {
    const onChange = vi.fn()
    const root = await draw(createElement(WatershedFields, { minAreaHa: undefined, onChange }))
    const box = root.find((n) => n.type === 'input' && n.props.type === 'checkbox')
    await act(async () => box.props.onChange({ target: { checked: true } }))
    expect(onChange).toHaveBeenCalledWith(DEFAULT_WATERSHED_MIN_AREA_HA)
  })

  it('says why a pour point cannot be picked yet, and names each picking state', async () => {
    const props = {
      options: { snapRadiusM: DEFAULT_POUR_POINT_SNAP_M },
      onOptions: vi.fn(),
      onPoint: vi.fn(),
      onPick: vi.fn(),
    }
    let root = await draw(
      createElement(PourPointFields, {
        ...props,
        point: undefined,
        picking: false,
        disabled: true,
        disabledReason: 'Route flow first.',
      }),
    )
    expect(buttonText(root)).toContain('Select pour point on plan')
    expect(text(root)).toContain('Route flow first.')
    root = await draw(createElement(PourPointFields, { ...props, point: [-122.8, 53.9], picking: false }))
    expect(buttonText(root)).toEqual(expect.arrayContaining(['Move pour point on plan', 'Remove pour point']))
    root = await draw(createElement(PourPointFields, { ...props, point: undefined, picking: true }))
    expect(buttonText(root)).toContain('Cancel point selection')
  })

  it('gives the ground card the depression and snap policies its settings already carried', async () => {
    const onChange = vi.fn()
    const root = await draw(groundPanel({ settings: DEFAULT_GROUND_DRAINAGE_SETTINGS }, onChange))
    const select = (label: string) =>
      root.find((n) => n.props.ariaLabel === label && typeof n.props.onValueChange === 'function')
    await act(async () => select('Depression treatment').props.onValueChange('preserve'))
    expect(onChange).toHaveBeenLastCalledWith({
      settings: { ...DEFAULT_GROUND_DRAINAGE_SETTINGS, depressionPolicy: { mode: 'preserve' } },
    })
    await act(async () => select('Outlet snap policy').props.onValueChange('lowest-elevation'))
    expect(onChange).toHaveBeenLastCalledWith({
      settings: { ...DEFAULT_GROUND_DRAINAGE_SETTINGS, snapPolicy: 'lowest-elevation' },
    })
    expect(DEFAULT_GROUND_DRAINAGE_SETTINGS.snapRadiusM).toBe(DEFAULT_POUR_POINT_SNAP_M)
  })

  it('summarises the routing choices for the folded inputs', () => {
    expect(routingSummary({ streamThresholdHa: 1, reachM: 250 })).toBe(
      'streams from 1 ha · 250 m upslope · depressions filled · source cells',
    )
    expect(
      routingSummary({
        streamThresholdHa: 0.5,
        reachM: 0,
        workingResolutionM: 5,
        depressionPolicy: { mode: 'depth-limited', maxDepthM: 0.25 },
      }),
    ).toBe('streams from 0.5 ha · 0 m upslope · basins filled to 0.25 m · 5 m cells')
  })
})
