import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  defaultPlacement,
  describeFile,
  isDefaultPackage,
  isEmptyFile,
  omittedFor,
  orderedPackageParts,
  packagePlan,
  packageReportNotice,
  packagePreset,
  parseEstimateSettings,
  parseReportPackage,
  placementOf,
  presetSettings,
  slopeSheetMode,
  withPackageOrder,
  withSummary,
  withPlacement,
} from './reportPackage'
import { REPORT_ORDER } from './reportContents'
import { assemblePackageFile, pdfPageCount } from './reportPackagePdf'
import { createRoadReportSettings, parseRoadReportSettings } from './reportSettings'

describe('report package plan', () => {
  it('puts long schedules in appendices and the rest in the package by default', () => {
    const plan = packagePlan(undefined, 'Road')
    expect(plan.main.filename).toBe('Road-report-package.pdf')
    expect(plan.main.report).toContain('review')
    expect(plan.main.report).not.toContain('sections')
    expect(plan.main.report).not.toContain('station-schedule')
    expect(plan.main.plotbook).toEqual(['charts', 'plan-profile'])
    expect(plan.main.sheets).toEqual(['field-layout'])
    expect(plan.appendices.map((a) => a.key)).toEqual([
      'report:sections',
      'report:station-schedule',
      'report:clearing',
      'report:slope-stakes',
      'plotbook:sections',
    ])
    expect(plan.appendices[0].filename).toBe('Road-appendix-cross-sections.pdf')
    expect(plan.omitted.map((p) => p.id)).toContain('sheet:general-access')
  })

  it('moves a part to an appendix of its own or out of the package', () => {
    let settings = withPlacement(undefined, 'plotbook:plan-profile', 'appendix')
    settings = withPlacement(settings, 'report:streams', 'omit')
    const plan = packagePlan(settings, 'TPY')
    expect(plan.main.plotbook).toEqual(['charts'])
    expect(plan.main.report).not.toContain('streams')
    expect(plan.appendices.find((a) => a.key === 'plotbook:plan-profile')).toMatchObject({
      plotbook: ['plan-profile'],
      report: [],
      filename: 'TPY-appendix-plan-profile-sheets.pdf',
    })
    expect(plan.omitted.map((p) => p.id)).toContain('report:streams')
  })

  it('keeps only the choices that differ from the default', () => {
    const moved = withPlacement(undefined, 'report:streams', 'appendix')
    expect(moved.parts).toEqual({ 'report:streams': 'appendix' })
    expect(withPlacement(moved, 'report:streams', defaultPlacement('report:streams')).parts).toEqual({})
    expect(placementOf(moved, 'report:streams')).toBe('appendix')
    expect(placementOf(moved, 'report:review')).toBe('main')
  })

  it('reads saved choices, drops unknown parts and refuses unknown placements', () => {
    expect(
      parseReportPackage({ parts: { 'report:streams': 'omit', 'report:future': 'main', 'report:review': 'main' } }),
    ).toEqual({
      parts: { 'report:streams': 'omit' },
    })
    expect(() => parseReportPackage({ parts: { 'report:streams': 'maybe' } })).toThrow('must be one of')
    const settings = {
      ...createRoadReportSettings(),
      package: withPlacement(undefined, 'sheet:field-imagery', 'appendix'),
    }
    expect(parseRoadReportSettings(JSON.parse(JSON.stringify(settings))).package).toEqual(settings.package)
    expect(parseRoadReportSettings(createRoadReportSettings()).package).toBeUndefined()
  })

  it('tells a file what to leave out of its reports and says what it holds', () => {
    const plan = packagePlan(undefined, 'R')
    const sections = plan.appendices.find((a) => a.key === 'report:sections')!
    expect(omittedFor(sections)).not.toContain('sections')
    expect(omittedFor(sections)).toContain('review')
    expect(describeFile(sections)).toEqual(['Report, per road: Cross-sections'])
    expect(isEmptyFile({ ...sections, report: [] })).toBe(true)
  })
})

async function pdfOf(pages: number) {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([400, 300])
  return doc.save()
}

describe('report package PDF', () => {
  const cover = {
    eyebrow: 'PGMaps forest road design · report package',
    title: 'Demo − report package',
    subtitle: 'Road A · Revision A',
    stamp: ['Rev A · draft for review', 'Preliminary planning geometry · not for construction'],
    holds: ['Report, per road: Readiness checks'],
    appendices: [{ filename: 'Demo-appendix-cross-sections.pdf', title: 'Appendix: Cross-sections' }],
    omitted: ['Field Ops Imagery'],
  }

  it('puts the cover first and numbers each part from the page it starts on', async () => {
    const file = await assemblePackageFile(cover, [
      { label: 'Road A · report', pdf: await pdfOf(2) },
      { label: 'Road A · plot book', pdf: await pdfOf(3) },
    ])
    expect(file.pages).toBe(6)
    expect(file.starts).toEqual([
      { label: 'Road A · report', page: 2 },
      { label: 'Road A · plot book', page: 4 },
    ])
    expect(await pdfPageCount(file.bytes)).toBe(6)
  })

  it('moves every number on when a long contents list takes the cover to a second page', async () => {
    const entries = await Promise.all(
      Array.from({ length: 70 }, async (_, i) => ({ label: `Road ${i} · report`, pdf: await pdfOf(1) })),
    )
    const file = await assemblePackageFile(cover, entries)
    const coverPages = file.starts[0].page - 1
    expect(coverPages).toBeGreaterThan(1)
    expect(file.pages).toBe(coverPages + 70)
    expect(file.starts[69].page).toBe(coverPages + 70)
  })
})

describe('the slope sheet option', () => {
  it('defaults to the check, keeps only a change from it, and survives a preset', () => {
    expect(slopeSheetMode(undefined)).toBe('check')
    expect(withSummary(undefined, { slopeSheet: 'check' })).toEqual({ parts: {} })
    const range = withSummary(presetSettings('simplified'), { slopeSheet: 'range' })
    expect(range.slopeSheet).toBe('range')
    expect(packagePreset(range)).toBe('simplified')
    expect(presetSettings('full', true, 'off').slopeSheet).toBe('off')
    expect(parseReportPackage({ slopeSheet: 'range' }).slopeSheet).toBe('range')
    expect(() => parseReportPackage({ slopeSheet: 'maybe' })).toThrow(/slope sheet/)
  })
})

describe('the estimate range option', () => {
  it('is off until asked for and survives a preset', () => {
    expect(withSummary(undefined, {}).range).toBeUndefined()
    const on = withSummary(presetSettings('simplified'), { range: true })
    expect(on.range).toBe(true)
    expect(packagePreset(on)).toBe('simplified')
    expect(withSummary(on, { range: false }).range).toBeUndefined()
    expect(parseReportPackage({ range: true }).range).toBe(true)
    expect(() => parseReportPackage({ range: { crossDrainSpacingM: 100 } })).toThrow(/on or off/)
  })
  it('reads the estimate allowances, keeping blanks blank and refusing nonsense', () => {
    expect(parseEstimateSettings({ crossDrainCost: 4000, endHaulRate: null, contingency: true })).toEqual({
      crossDrainCost: 4000,
    })
    expect(parseEstimateSettings({ contingency: false })).toEqual({ contingency: false })
    expect(() => parseEstimateSettings({ crossDrainSpacingM: 1 })).toThrow(/crossDrainSpacingM/)
    const settings = parseRoadReportSettings({ ...createRoadReportSettings(), estimate: { crossDrainSpacingM: 150 } })
    expect(settings.estimate).toEqual({ crossDrainSpacingM: 150 })
    expect(parseRoadReportSettings({ ...createRoadReportSettings(), estimate: {} }).estimate).toBeUndefined()
  })
})

describe('the package order', () => {
  it('follows the report section order and its own order for chapters and sheets, kept only when moved', () => {
    const sectionOrder = ['station-schedule' as const, ...REPORT_ORDER.filter((id) => id !== 'station-schedule')]
    const plan = packagePlan(undefined, 'R', sectionOrder)
    const appendices = plan.appendices.map((file) => file.key)
    // The four long schedules are appendices; the station schedule now comes first.
    expect(appendices[0]).toBe('report:station-schedule')
    expect(plan.main.report[0]).toBe('review')
    // Moving the clearing schedule chapter ahead of the charts changes the main file's plot book.
    const parts = orderedPackageParts(undefined).filter((part) => part.group !== 'report')
    const chapters = parts.map((part) => part.id)
    const moved = withPackageOrder(undefined, [
      'plotbook:plan-profile',
      ...chapters.filter((id) => id !== 'plotbook:plan-profile'),
    ])
    expect(moved.order?.[0]).toBe('plotbook:plan-profile')
    expect(packagePlan(moved, 'R').main.plotbook).toEqual(['plan-profile', 'charts'])
    expect(packagePlan(undefined, 'R').main.plotbook).toEqual(['charts', 'plan-profile'])
    // The usual order is not kept, a saved order drops unknown parts, and presets keep the order.
    expect(isDefaultPackage(withPackageOrder(undefined, chapters))).toBe(true)
    expect(parseReportPackage({ parts: {}, order: ['sheet:nonsense', ...moved.order!] }).order).toEqual(moved.order)
    expect(packagePreset(moved)).toBe('full')
    expect(presetSettings('simplified', true, 'check', undefined, moved.order).order).toEqual(moved.order)
    expect(() => parseReportPackage({ parts: {}, order: 'charts' })).toThrow(/order/)
  })

  it('words the cover contents and the left-out list in package order', () => {
    const sectionOrder = ['profile' as const, ...REPORT_ORDER.filter((id) => id !== 'profile')]
    const plan = packagePlan(withPlacement(undefined, 'report:review', 'omit'), 'R', sectionOrder)
    expect(describeFile(plan.main)[1]).toMatch(/^Report, per road: Longitudinal profile, Complete access cost/)
    expect(packageReportNotice(plan, plan.main)).toContain('Left out of the package: Readiness checks')
  })
})
