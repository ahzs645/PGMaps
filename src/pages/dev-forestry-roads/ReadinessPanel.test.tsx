import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReadinessList } from './ReadinessPanel'
import type { ReadinessRow } from './readiness'

// The explanations sit behind an InfoTip, whose popover needs a browser window; render its text inline.
vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement('span', { 'aria-label': label }, children),
}))
let renderer: ReactTestRenderer | undefined
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
})

const row = (id: string, state: ReadinessRow['state'], patch: Partial<ReadinessRow> = {}): ReadinessRow => ({
  id,
  group: 'alignment',
  check: `Check ${id}`,
  state,
  result: `Result ${id}`,
  measured: `Measured ${id}`,
  judgedOn: `Limit ${id}`,
  ...patch,
})
const rows: ReadinessRow[] = [
  row('terrain', 'met', { group: 'terrain' }),
  row('standards', 'attention', { severity: 'todo', action: { label: 'Set standards', target: 'standards' } }),
  row('radius', 'attention', { severity: 'limit', action: { label: 'Go to 0+280.9', target: 'curves' } }),
  row('vehicle', 'not-assessed', { action: { label: 'Check a vehicle', target: 'vehicle' } }),
  row('drainage', 'not-assessed', { group: 'water', action: { label: 'Run check', target: 'drainage' } }),
  row('grade', 'met'),
]
const text = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : text(child))).join('')
const checks = (node: ReactTestInstance) =>
  node
    .findAll((item) => typeof item.type === 'string' && !!item.props['data-check'])
    .map((item) => item.props['data-check'])

describe('the Review readiness list', () => {
  it('leads with what needs attention and folds the rest behind their counts', async () => {
    const onAction = vi.fn()
    await act(async () => {
      renderer = create(<ReadinessList rows={rows} onAction={onAction} />)
    })
    const root = renderer!.root
    expect(text(root.findByProps({ 'data-testid': 'road-readiness-verdict' }))).toBe(
      'Not ready: 1 outside a limit, 1 to do',
    )
    // A broken limit before an input still to do; nothing else is in the leading section.
    expect(checks(root.findByProps({ 'data-testid': 'road-readiness-attention' }))).toEqual(['radius', 'standards'])
    const notAssessed = root.findByProps({ 'data-testid': 'road-readiness-not-assessed' })
    const met = root.findByProps({ 'data-testid': 'road-readiness-met' })
    expect(checks(notAssessed)).toEqual(['vehicle', 'drainage'])
    expect(checks(met)).toEqual(['terrain', 'grade'])
    // Each folded group starts closed, and its summary line gives the count.
    const toggles = [notAssessed, met].map((group, i) =>
      group.findByProps({ 'data-testid': `road-readiness-${i ? 'met' : 'not-assessed'}-toggle` }),
    )
    expect(toggles.map((toggle) => toggle.props['aria-expanded'])).toEqual([false, false])
    expect(text(toggles[0])).toContain('Not assessed')
    expect(text(toggles[0])).toContain('2 checks')
    expect(text(toggles[1])).toContain('2 checks')
    // Every row is in the list once, with its state, whether or not its group is open.
    expect(checks(root).sort()).toEqual(rows.map((item) => item.id).sort())
    // A folded row keeps its action: opening the group is all it takes to reach it.
    await act(async () => toggles[0].props.onClick())
    const run = notAssessed.findAll((item) => item.type === 'button' && text(item) === 'Run check')[0]
    await act(async () => run.props.onClick())
    expect(onAction).toHaveBeenCalledWith({ label: 'Run check', target: 'drainage' })
  })

  it('shows the check and what it was judged on when a row is opened', async () => {
    await act(async () => {
      renderer = create(<ReadinessList rows={rows} onAction={() => {}} />)
    })
    const item = renderer!.root.findByProps({ 'data-check': 'radius' })
    expect(text(item)).not.toContain('Judged on')
    await act(async () => item.findByProps({ 'aria-expanded': false }).props.onClick())
    expect(text(item)).toContain('Check: Check radius. Judged on: Limit radius')
  })

  it('says so when nothing needs attention, without reading clear over unmade checks', async () => {
    await act(async () => {
      renderer = create(<ReadinessList rows={rows.filter((item) => item.state !== 'attention')} onAction={() => {}} />)
    })
    const root = renderer!.root
    expect(text(root.findByProps({ 'data-testid': 'road-readiness-verdict' }))).toBe(
      'Nothing needs attention, but 2 checks were not made',
    )
    expect(checks(root.findByProps({ 'data-testid': 'road-readiness-attention' }))).toEqual([])
  })
})
