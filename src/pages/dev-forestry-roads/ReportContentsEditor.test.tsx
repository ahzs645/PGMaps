import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReportContentsEditor } from './ReportContentsEditor'
import { REPORT_SECTIONS } from './reportContents'
import { createRoadReportSettings, type RoadReportSettings } from './reportSettings'

vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement('aside', { 'aria-label': label }, children),
}))

let renderer: ReactTestRenderer | undefined
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
})

describe('report contents checkboxes', () => {
  it('turns a section off and on, and All and None set every section', () => {
    let value: RoadReportSettings = createRoadReportSettings()
    const render = () =>
      act(() => {
        const element = <ReportContentsEditor value={value} onChange={(next) => (value = next)} />
        if (renderer) renderer.update(element)
        else renderer = create(element)
      })
    render()
    const boxes = () => renderer!.root.findAll((node) => node.type === 'input' && node.props.type === 'checkbox')
    expect(boxes()).toHaveLength(REPORT_SECTIONS.length)
    expect(boxes().every((box) => box.props.checked)).toBe(true)
    const schedule = REPORT_SECTIONS.findIndex((section) => section.id === 'station-schedule')
    act(() => boxes()[schedule].props.onChange({ target: { checked: false } }))
    expect(value.omittedSections).toEqual(['station-schedule'])
    render()
    expect(boxes()[schedule].props.checked).toBe(false)
    const none = renderer!.root.find((node) => node.type === 'button' && node.children.includes('None'))
    act(() => none.props.onClick())
    expect(value.omittedSections).toHaveLength(REPORT_SECTIONS.length)
    render()
    const all = renderer!.root.find((node) => node.type === 'button' && node.children.includes('All'))
    act(() => all.props.onClick())
    expect(value).not.toHaveProperty('omittedSections')
  })
})
