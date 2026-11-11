import type { ComponentProps, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DevGeoreference from '../DevGeoreference'
import { SourceImagePane } from './SourceImagePane'
import { ReferencePane } from './ReferencePane'
import { draftKey, LEGACY_DRAFT_KEY, listLocalDrafts, readLocalDraft } from './drafts'
import type { LoadedSource } from './sources'
import type { GeoreferenceProject } from './model'
import type { RasterCatalogue, RasterRecord } from '../dev-view/catalogue'

const io = vi.hoisted(() => ({
  catalogue: vi.fn(),
  source: vi.fn(),
  published: vi.fn(),
}))
vi.mock('../dev-view/catalogue', async (original) => ({
  ...(await original<typeof import('../dev-view/catalogue')>()),
  loadCatalogue: io.catalogue,
}))
vi.mock('./sources', () => ({
  loadRemoteSource: io.source,
  loadLocalSource: vi.fn(),
  fileSha256: vi.fn(),
  originalSourceFile: vi.fn(),
}))
vi.mock('./publishedProject', () => ({ loadPublishedProject: io.published }))
vi.mock('./preview', () => ({ renderWarpedPreview: vi.fn(async () => null), canvasBlob: vi.fn(), WKT_3857: '' }))
vi.mock('./SourceImagePane', () => ({ SourceImagePane: () => <div data-testid="image-pane" /> }))
vi.mock('./ReferencePane', () => ({ ReferencePane: () => <div data-testid="reference-pane" /> }))
vi.mock('react-router-dom', () => ({ Link: ({ children }: { children: ReactNode }) => <a>{children}</a> }))
vi.mock('@/components/ui/tool-page-header', () => ({ ToolPageHeader: () => <h1>Georeference a map</h1> }))
vi.mock('@/components/ui/file-drop-field', () => ({ FileDropField: () => <div /> }))
vi.mock('@/components/ui/form-field', () => ({
  StyledSelect: (props: SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} />,
}))
vi.mock('@/components/ui/map-panels', () => ({
  SearchInput: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  InlineAlert: ({ title, children }: { title?: string; children: ReactNode }) => (
    <div>
      {title}
      {children}
    </div>
  ),
}))

function localStorageFixture() {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    key: (index: number) => [...entries.keys()][index] || null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value)
    },
    removeItem: (key: string) => {
      entries.delete(key)
    },
  }
}

const host = 'https://editor.example.test'
function map(id: string, title: string, hash: string): RasterRecord {
  return {
    id,
    title,
    bounds: [-126, 54, -125, 55],
    assets: [{ bounds: [-126, 54, -125, 55], minZoom: 0, maxZoom: 16, tiles: [`${host}/tiles/{z}/{x}/{y}.png`] }],
    downloads: [{ url: `${host}/${id}.png`, sha256: hash.repeat(64) }],
    sources: [],
    fullSheets: [],
  }
}
const alpha = map('alpha', 'Kitimat source', 'a')
const beta = map('beta', 'Nautley source', 'b')
const catalogue: RasterCatalogue = {
  title: 'Synthetic collection',
  items: [alpha, beta],
  featured: [],
  representationCount: 2,
  unplacedSources: [],
  facets: { subjects: [], regions: [], eras: [] },
}
function loaded(record: RasterRecord): LoadedSource {
  return {
    descriptor: {
      id: record.id,
      url: record.downloads[0].url,
      sha256: record.downloads[0].sha256!,
      width: record.id === 'alpha' ? 800 : 900,
      height: 600,
      frame: { kind: 'original-image', description: 'Exact synthetic source pixels.' },
    },
    title: record.title,
    canvas: {} as HTMLCanvasElement,
    imageUrl: 'data:image/png;base64,',
    record,
  }
}
function recoveredProject(): GeoreferenceProject {
  return {
    schema: 'pgmaps-georeference-v2',
    fitCrs: 'EPSG:3857',
    pixelConvention: 'pixel-centres-x-right-y-down',
    title: 'Recovered Kitimat source',
    source: {
      ...loaded(alpha).descriptor,
      url: `${host}/original.png`,
      sha256: 'c'.repeat(64),
      width: 640,
      height: 480,
      frame: { kind: 'derived-image', description: 'Archived original pixel crop.' },
    },
    transform: 'similarity',
    points: [
      {
        id: 'first',
        pixel: [20, 20],
        coordinate: [-126, 54],
        enabled: true,
        role: 'control',
        provenance: { kind: 'archived-control', description: 'Archived test evidence.' },
      },
      { id: 'second', pixel: [600, 400], coordinate: [-125.95, 53.97], enabled: true, role: 'control' },
      { id: 'check', pixel: [300, 200], coordinate: [-125.98, 53.98], enabled: true, role: 'check' },
    ],
    recoveredPlacement: {
      crs: 'EPSG:3005',
      matrix: [
        [10, 0, 1000000],
        [0, -10, 1000000],
      ],
      active: true,
      method: 'Recorded affine',
      summary: 'Exact synthetic recorded matrix.',
      recoveredAt: '2026-11-08',
      evidence: [],
    },
    notes: 'Original recovered notes.',
  }
}
function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : text(child))).join('')
}

let renderer: ReactTestRenderer | undefined
let storage: ReturnType<typeof localStorageFixture>
let browser: EventTarget & { location: { hash: string; origin: string } }
const control = (label: string) =>
  renderer!.root.findAll((node) => typeof node.type === 'string' && node.props['aria-label'] === label)[0]
const button = (label: string) =>
  renderer!.root.findAll((node) => node.type === 'button' && text(node).trim() === label)[0]
const sourcePane = () => renderer!.root.findByType(SourceImagePane).props as ComponentProps<typeof SourceImagePane>
const referencePane = () => renderer!.root.findByType(ReferencePane).props as ComponentProps<typeof ReferencePane>
async function mount(id = 'alpha') {
  browser.location.hash = `#catalog=${encodeURIComponent(`${host}/catalog.json`)}&map=${id}`
  await act(async () => {
    renderer = create(<DevGeoreference />)
  })
}
async function click(label: string) {
  await act(async () => {
    button(label).props.onClick()
  })
}
async function change(label: string, value: string) {
  await act(async () => {
    control(label).props.onChange({ target: { value } })
  })
}
async function switchTo(title: string) {
  await change('Find a map in the collection', title)
  await click('Load selected map')
}
async function saveNotes(value: string) {
  await change('Georeferencing notes', value)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  storage = localStorageFixture()
  browser = Object.assign(new EventTarget(), {
    location: { hash: '', origin: 'https://app.example.test' },
    setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  })
  vi.stubGlobal('window', browser)
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('document', { head: { append: vi.fn() }, createElement: () => ({ remove: vi.fn(), click: vi.fn() }) })
  io.catalogue.mockResolvedValue(catalogue)
  io.published.mockResolvedValue(null)
  io.source.mockImplementation(async (url: string) => loaded(url.includes('beta') ? beta : alpha))
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('editor source selection and recovery integration', () => {
  it('preserves the selected native map ID when another map shares the same image bytes', async () => {
    const alias = { ...beta, downloads: [{ ...beta.downloads[0], sha256: alpha.downloads[0].sha256 }] }
    io.catalogue.mockResolvedValue({ ...catalogue, items: [alpha, alias] })
    io.source.mockImplementation(async (url: string, options: { id: string; title: string; record: RasterRecord }) => ({
      ...loaded(alpha),
      descriptor: { ...loaded(alpha).descriptor, id: options.id, url },
      title: options.title,
      record: options.record,
    }))
    await mount('beta')
    expect(io.source).toHaveBeenLastCalledWith(
      alias.downloads[0].url,
      expect.objectContaining({ id: 'beta', record: alias }),
      expect.any(AbortSignal),
    )
    expect(sourcePane().source?.descriptor.id).toBe('beta')
    expect(control('Map to edit').props.value).toBe('beta')
  })

  it('loads the visible filtered map, disables zero matches and keeps both source drafts after reopening', async () => {
    await mount()
    await saveNotes('Keep the Kitimat draft.')
    await change('Find a map in the collection', 'Nautley')
    expect(control('Map to edit').props.value).toBe('beta')
    await click('Load selected map')
    expect(sourcePane().source?.descriptor.id).toBe('beta')
    expect(io.source).toHaveBeenLastCalledWith(
      beta.downloads[0].url,
      expect.objectContaining({ id: 'beta' }),
      expect.any(AbortSignal),
    )
    await saveNotes('Keep the Nautley draft.')
    expect(listLocalDrafts(storage).drafts).toHaveLength(2)

    await change('Local draft to resume', draftKey(loaded(alpha).descriptor))
    await click('Resume local draft')
    expect(sourcePane().source?.descriptor.id).toBe('alpha')
    expect(control('Georeferencing notes').props.value).toBe('Keep the Kitimat draft.')
    await change('Find a map in the collection', 'nothing matches this')
    expect(control('Map to edit').props.value).toBe('')
    expect(control('Map to edit').props.disabled).toBe(true)
    expect(button('Load selected map').props.disabled).toBe(true)

    act(() => renderer!.unmount())
    renderer = undefined
    await mount()
    expect(control('Georeferencing notes').props.value).toBe('')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(readLocalDraft(storage, draftKey(loaded(alpha).descriptor))?.project.notes).toBe('Keep the Kitimat draft.')
    await click('Resume local draft')
    expect(control('Georeferencing notes').props.value).toBe('Keep the Kitimat draft.')
  })

  it('ignores a late response from a superseded source even when the loader does not obey its abort signal', async () => {
    let release!: (source: LoadedSource) => void
    io.source.mockImplementation((url: string) =>
      url.includes('alpha')
        ? new Promise<LoadedSource>((resolve) => {
            release = resolve
          })
        : Promise.resolve(loaded(beta)),
    )
    await mount()
    const oldSignal = io.source.mock.calls[0][2] as AbortSignal
    await act(async () => {
      browser.location.hash = `#catalog=${encodeURIComponent(`${host}/catalog.json`)}&map=beta`
      browser.dispatchEvent(new Event('hashchange'))
    })
    expect(oldSignal.aborted).toBe(true)
    expect(sourcePane().source?.descriptor.id).toBe('beta')
    await act(async () => {
      release(loaded(alpha))
    })
    expect(sourcePane().source?.descriptor.id).toBe('beta')
    expect(control('Map to edit').props.value).toBe('beta')
  })

  it('reopens the recorded original frame and frozen model, then explicitly resumes a newer editable draft', async () => {
    const recovered = recoveredProject()
    io.published.mockImplementation(async (record: RasterRecord) => (record.id === 'alpha' ? recovered : null))
    io.source.mockImplementation(async (url: string, options: { record: RasterRecord }) =>
      url.endsWith('/original.png')
        ? { ...loaded(alpha), descriptor: recovered.source, title: recovered.title!, record: options.record }
        : loaded(beta),
    )
    await mount()
    expect(io.source).toHaveBeenCalledWith(
      recovered.source.url,
      expect.objectContaining({ sha256: recovered.source.sha256, record: alpha }),
      expect.any(AbortSignal),
    )
    expect(sourcePane().source?.descriptor).toEqual(recovered.source)
    expect(referencePane().source?.record).toBe(alpha)
    expect(sourcePane().readOnly).toBe(true)
    expect(referencePane().readOnly).toBe(true)
    expect(referencePane().fit?.recovered).toBe(true)
    await act(async () => {
      sourcePane().onMove('first', [35, 20])
    })
    expect(sourcePane().points[0].pixel[0]).toBe(20)
    expect(listLocalDrafts(storage).drafts).toHaveLength(0)

    await click('Start a new fit from controls')
    expect(sourcePane().readOnly).toBe(false)
    await act(async () => {
      sourcePane().onMove('first', [35, 20])
    })
    await saveNotes('New local controls need another review.')
    const revised = readLocalDraft(storage, draftKey(recovered.source))!.project
    expect(revised.recoveredPlacement).toEqual({ ...recovered.recoveredPlacement, active: false })
    expect(revised.points[0].provenance?.kind).toBe('manual')
    await switchTo('Nautley')
    await switchTo('Kitimat')
    expect(sourcePane().readOnly).toBe(true)
    expect(control('Georeferencing notes').props.value).toBe(recovered.notes)
    await click('Resume local draft')
    expect(sourcePane().readOnly).toBe(false)
    expect(sourcePane().points[0].pixel[0]).toBe(35)
    expect(control('Georeferencing notes').props.value).toBe(revised.notes)
  })

  it('keeps the loaded map when published recovery fails and requires an explicit fresh start', async () => {
    const broken = {
      ...alpha,
      georeferenceProject: {
        url: `${host}/alpha.json`,
        sha256: 'd'.repeat(64),
        nativeSha256: 'a'.repeat(64),
        sourceSha256: 'c'.repeat(64),
      },
    }
    io.catalogue.mockResolvedValue({ ...catalogue, items: [broken, beta] })
    io.published.mockImplementation(async (record: RasterRecord) => {
      if (record.id === 'alpha') throw Error('The saved alignment project checksum does not match.')
      return null
    })
    storage.setItem('pgmaps-georeference-draft-v2:broken', '{bad')
    await mount('beta')
    await switchTo('Kitimat')
    expect(text(renderer!.root)).toContain('Saved project could not be restored')
    expect(text(renderer!.root)).toContain('Some saved drafts could not be read')
    expect(sourcePane().source?.descriptor.id).toBe('beta')
    await click('Start fresh from current raster')
    expect(sourcePane().source?.descriptor.id).toBe('alpha')
    expect(sourcePane().points).toEqual([])
    expect(referencePane().fit).toBeNull()
  })

  it('migrates a previous global draft and handles storage failure without losing the active edits', async () => {
    const legacy = {
      ...recoveredProject(),
      recoveredPlacement: { ...recoveredProject().recoveredPlacement!, active: false },
    }
    storage.setItem(LEGACY_DRAFT_KEY, JSON.stringify(legacy))
    await mount('beta')
    expect(storage.getItem(LEGACY_DRAFT_KEY)).toBeNull()
    expect(listLocalDrafts(storage).drafts[0].project.source).toEqual(legacy.source)
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw Error('Storage quota exceeded.')
    })
    await saveNotes('Edits that must remain on screen.')
    expect(text(renderer!.root)).toContain('Storage quota exceeded')
    await switchTo('Kitimat')
    expect(sourcePane().source?.descriptor.id).toBe('beta')
    expect(control('Georeferencing notes').props.value).toBe('Edits that must remain on screen.')
  })
})
