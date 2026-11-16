import proj4 from 'proj4'
import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FileDropField } from '@/components/ui/file-drop-field'
import { crsDefinition } from '@/lib/geo/projectedCrs'

import { DEFAULT_PRESCRIPTION, applyPrescription, type StandPrescription } from './prescription'
import { StandPrescriptionDialog, adoptedFigures } from './StandPrescriptionDialog'
import { buildStand, type Stand } from './standTrees'
import type { ImportedTree } from './treeListImport'

vi.mock('@/components/ui/dialog-shell', () => ({
  PanelDialog: ({
    title,
    summary,
    headerExtra,
    children,
    footer,
    open,
  }: {
    title: string
    summary?: ReactNode
    headerExtra?: ReactNode
    children: ReactNode
    footer?: ReactNode
    open?: boolean
  }) =>
    open === false
      ? null
      : createElement('div', { role: 'dialog', 'aria-label': title }, summary, headerExtra, children, footer),
}))
// The (i) reads `window.matchMedia`; this renderer has no DOM, and the tip is not under test.
vi.mock('@/components/ui/info-tip', () => ({ InfoTip: () => null }))
vi.mock('@/components/ui/styled-select', async (actual) => ({
  ...(await actual<typeof import('@/components/ui/styled-select')>()),
  StyledSelect: (await import('@/components/ui/styledSelectTestDouble')).StyledSelectTestDouble,
}))

const ANCHOR = 53.9
// About 200 m × 100 m at 53.9° N.
const BLOCK: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-122.8, 53.9],
      [-122.797, 53.9],
      [-122.797, 53.9009],
      [-122.8, 53.9009],
      [-122.8, 53.9],
    ],
  ],
}

function stand(): Stand {
  const built = buildStand({ geometry: BLOCK, stands: [], clearings: [], inventory: [], anchorLatitude: ANCHOR })
  if (!built.stand) throw new Error(built.error)
  return built.stand
}

let renderer: ReactTestRenderer | undefined
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
})

const text = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(text).join('')
const button = (root: ReactTestInstance, label: string) =>
  root.find((node) => node.type === 'button' && (node.props['aria-label'] ?? text(node).trim()).startsWith(label))

function render(patch: Partial<Parameters<typeof StandPrescriptionDialog>[0]> = {}) {
  const s = stand()
  const prescription: StandPrescription = { ...DEFAULT_PRESCRIPTION, target: { kind: 'basalAreaShare', value: 60 } }
  const result = applyPrescription(s, prescription, { harvestSystem: 'partial', volumeRemovedPercent: 40 })
  const props = {
    open: true,
    onClose: vi.fn(),
    blockName: 'Block 7',
    harvestSystem: 'partial' as const,
    block: { volumeRemovedPercent: 40, residualHeightMeters: 18 },
    prescription,
    onChange: vi.fn(),
    onRemove: vi.fn(),
    stand: s,
    result,
    error: null,
    onAdopt: vi.fn(),
    onClearProtected: vi.fn(),
    ...patch,
  }
  act(() => {
    renderer = create(createElement(StandPrescriptionDialog, props))
  })
  return { root: renderer!.root, props, result }
}

describe('StandPrescriptionDialog', () => {
  it('shows the outcome and headline figures above the tabs', () => {
    const { root, result } = render()
    const all = text(root)
    expect(all).toContain('Basal area left')
    expect(all).toContain('Stems left')
    expect(all).toContain(result.reached ? 'Target reached' : 'Target not reached')
    expect(root.findAll((node) => node.props.role === 'tab').map((tab) => text(tab))).toEqual([
      'Prescription',
      'Stand table',
      'Graphs',
    ])
  })

  it('switches the pattern to grouped through onChange', () => {
    const { root, props } = render()
    act(() => button(root, 'Grouped').props.onClick())
    expect(props.onChange).toHaveBeenCalledTimes(1)
    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ pattern: 'grouped', target: props.prescription.target }),
    )
  })

  it("copies a partial cut's figures into the block's inputs: basal area removed and the kept trees' mean height", () => {
    const { root, props, result } = render()
    act(() => button(root, 'Use for Table 5/6').props.onClick())
    const expected = {
      volumeRemovedPercent: Math.round(result.removedBasalAreaPercent),
      residualHeightMeters: Math.round(result.summaries.retained.heightMeters.mean * 10) / 10,
    }
    expect(props.onAdopt).toHaveBeenCalledWith(expected)
    expect(expected.volumeRemovedPercent).toBeGreaterThan(30)
    expect(expected.volumeRemovedPercent).toBeLessThan(50)
    expect(adoptedFigures('retention', result)).toEqual({
      retentionPercent: Math.round(100 - result.removedBasalAreaPercent),
    })
  })

  it('renders the stand table and the graphs from the result', () => {
    const { root } = render()
    act(() => button(root, 'Stand table').props.onClick())
    const table = root.find((node) => node.type === 'table' && node.props['aria-label'] === 'Stand table')
    expect(text(table)).toContain('Basal area, m²/ha')
    expect(text(root)).toContain('Diameters from a height–diameter curve')
    act(() => button(root, 'Graphs').props.onClick())
    const charts = root.findAll((node) => node.type === 'svg' && node.props.role === 'img')
    expect(charts).toHaveLength(5)
  })

  it('says why when the block cannot be read, and offers nothing to copy', () => {
    const { root, props } = render({ stand: null, result: null, error: 'No standing stems grow in the block.' })
    expect(text(root)).toContain('No standing stems grow in the block.')
    expect(button(root, 'Use for Table 5/6').props.disabled).toBe(true)
    expect(button(root, 'Stand table').props.disabled).toBe(true)
    act(() => button(root, 'Remove prescription').props.onClick())
    expect(props.onRemove).toHaveBeenCalled()
  })

  it('offers no import when the page does not take one', () => {
    const { root } = render()
    expect(root.findAll((node) => node.type === FileDropField)).toHaveLength(0)
    expect(text(root)).not.toContain('Trees from')
  })

  it('reads a tree list, preselects its columns, leaves the system unset until chosen, and hands over converted trees', async () => {
    const onImportTrees = vi.fn()
    const { root } = render({ onImportTrees, onClearImport: vi.fn() })
    expect(text(root)).toContain('In use: the road view')
    act(() => button(root, 'Imported tree list').props.onClick())

    const [x, y] = proj4('EPSG:4326', crsDefinition(26910)!, [-122.75, 53.91]) as [number, number]
    const csv = [
      'Index,X,Y,Elevation,Height Above Ground,Max Crown Diameter',
      `1,${x},${y},712.4,24.6,5.2`,
      `2,${x + 6},${y + 3},713.0,18.2,3.9`,
      `3,${x + 12},${y - 2},713.8,1.1,0.8`,
    ].join('\n')
    const file = { name: 'maxima.csv', text: async () => csv }
    const drop = root.find((node) => node.type === FileDropField)
    await act(async () => {
      await drop.props.onFiles([{ file, path: file.name }])
    })

    const select = (label: string) => root.find((node) => node.type === 'select' && node.props['aria-label'] === label)
    expect(select('Easting or longitude column').props.value).toBe('X')
    expect(select('Northing or latitude column').props.value).toBe('Y')
    expect(select('Height column').props.value).toBe('Height Above Ground')
    expect(select('Crown size column').props.value).toBe('Max Crown Diameter')
    expect(select('Tree ID column').props.value).toBe('Index')
    // The file states neither its system nor its units: nothing is chosen for the reviewer.
    expect(select('Coordinate system').props.value).toBe('')
    expect(select('Height unit').props.value).toBe('')
    expect(select('Diameter unit').props.disabled).toBe(true)
    expect(text(root)).toContain('Choose the coordinate system, the height unit.')
    expect(button(root, 'Use these trees').props.disabled).toBe(true)

    act(() => select('Coordinate system').props.onChange({ target: { value: '26910' } }))
    act(() => select('Height unit').props.onChange({ target: { value: 'm' } }))
    expect(text(root)).toContain('2 trees to use; dropped 1 not taller than breast height (1.3 m).')
    expect(button(root, 'Use these trees').props.disabled).toBe(false)
    act(() => button(root, 'Use these trees').props.onClick())

    expect(onImportTrees).toHaveBeenCalledTimes(1)
    const [trees, source] = onImportTrees.mock.calls[0] as [ImportedTree[], unknown]
    expect(source).toEqual({
      fileName: 'maxima.csv',
      crs: 'UTM zone 10 N, NAD83 (EPSG:26910)',
      count: 2,
      dropped: 1,
    })
    expect(trees.map((tree) => [tree.id, tree.heightMeters, tree.crownWidthMeters])).toEqual([
      ['1', 24.6, 5.2],
      ['2', 18.2, 3.9],
    ])
    expect(trees[0].lng).toBeCloseTo(-122.75, 6)
    expect(trees[0].lat).toBeCloseTo(53.91, 6)
  })

  it('preselects the system only where the file states it, and says why', async () => {
    const { root } = render({ onImportTrees: vi.fn() })
    act(() => button(root, 'Imported tree list').props.onClick())
    const file = { name: 'stems.csv', text: async () => 'id,lon,lat,height_m\n1,-122.7,53.9,20' }
    await act(async () => {
      await root.find((node) => node.type === FileDropField).props.onFiles([{ file, path: file.name }])
    })
    const select = (label: string) => root.find((node) => node.type === 'select' && node.props['aria-label'] === label)
    expect(select('Coordinate system').props.value).toBe('4326')
    expect(select('Height unit').props.value).toBe('m')
    expect(text(root)).toContain('Stated by the file: columns named lon and lat.')
  })

  it('shows the imported list in use and goes back to the drawn stand on request', () => {
    const onClearImport = vi.fn()
    const { root } = render({
      onImportTrees: vi.fn(),
      onClearImport,
      importedSource: { fileName: 'crowns.geojson', crs: 'Longitude/latitude (WGS 84)', count: 1234, dropped: 5 },
    })
    expect(text(root)).toContain(
      'In use: 1,234 trees from crowns.geojson (Longitude/latitude (WGS 84)), 5 rows dropped.',
    )
    // Opens on the imported list it uses.
    expect(root.findAll((node) => node.type === FileDropField)).toHaveLength(1)
    act(() => button(root, 'Drawn stand').props.onClick())
    act(() => button(root, 'Use the drawn stand').props.onClick())
    expect(onClearImport).toHaveBeenCalledTimes(1)
  })
})
