import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseCatalogue, type RasterRecord } from '../dev-view/catalogue'
import { loadPublishedProject, MAX_PUBLISHED_PROJECT_BYTES } from './publishedProject'

const catalogueURL = 'https://maps.example.test/collection/catalog.json'
const projectURL = 'https://maps.example.test/collection/reviews/project.json'
const sourceSHA = 'a'.repeat(64)
const nativeSHA = 'b'.repeat(64)
const checksum = (text: string) => createHash('sha256').update(text).digest('hex')
const signal = () => new AbortController().signal

function fixture() {
  return {
    schema: 'pgmaps-georeference-v1',
    pixelConvention: 'pixel-centres-x-right-y-down',
    fitCrs: 'EPSG:3857',
    source: {
      id: 'sheet-one',
      url: 'https://maps.example.test/collection/raw/original.png',
      sha256: sourceSHA,
      width: 1000,
      height: 800,
      frame: { kind: 'original-image', description: 'Original source pixels, before rectification.' },
    },
    transform: 'similarity',
    points: [
      { id: 'control', pixel: [20, 20], coordinate: [-125, 54], enabled: true, role: 'control' },
      { id: 'check', pixel: [700, 600], coordinate: [-124.8, 53.9], enabled: true, role: 'check' },
    ],
  }
}

function mapRecord(body = JSON.stringify(fixture())): RasterRecord {
  return parseCatalogue(
    {
      schema: 'raster-catalog-v1',
      items: [
        {
          id: 'sheet-one',
          title: 'Test sheet',
          bounds: [-126, 53, -124, 55],
          assets: [{ url: 'tiles/current.pmtiles', bounds: [-126, 53, -124, 55] }],
          download: { url: 'raw/current.tif', sha256: nativeSHA },
          georeferenceProject: {
            url: projectURL,
            sha256: checksum(body),
            sourceSha256: sourceSHA,
            nativeSha256: nativeSHA,
          },
        },
      ],
    },
    catalogueURL,
  ).items[0]
}

function response(body: BodyInit | null, init?: ResponseInit, url = projectURL): Response {
  const value = new Response(body, init)
  Object.defineProperty(value, 'url', { value: url })
  return value
}

function mockDownload(body = JSON.stringify(fixture())) {
  const fetch = vi.fn().mockResolvedValue(response(body))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => vi.unstubAllGlobals())

describe('Published alignment project recovery', () => {
  it('leaves a legacy record without project metadata alone', async () => {
    const record = mapRecord()
    delete record.georeferenceProject
    const fetch = mockDownload()
    expect(await loadPublishedProject(record, signal())).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('recovers the original frame and check roles without fetching or substituting the current native raster', async () => {
    const body = JSON.stringify(fixture())
    const fetch = mockDownload(body)
    const abortSignal = signal()
    const project = await loadPublishedProject(mapRecord(body), abortSignal)
    expect(project).toEqual(fixture())
    expect(project?.source.sha256).toBe(sourceSHA)
    expect(project?.source.sha256).not.toBe(nativeSHA)
    expect(project?.points[1].role).toBe('check')
    expect(fetch).toHaveBeenCalledExactlyOnceWith(projectURL, {
      signal: abortSignal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
  })

  it('preserves an owner-published v2 native matrix and archived control provenance without refitting', async () => {
    const recovered = {
      ...fixture(),
      schema: 'pgmaps-georeference-v2',
      recoveredPlacement: {
        crs: 'EPSG:3005',
        matrix: [
          [2, 0, 900000],
          [0, -2, 1100000],
        ],
        active: true,
        method: 'Archived affine model',
        summary: 'Preserve the reviewed native model while reopening its controls.',
        recoveredAt: '2026-11-08',
        evidence: [
          {
            label: 'Archived control table',
            url: 'https://maps.example.test/reviews/controls.csv',
            sha256: 'c'.repeat(64),
          },
        ],
      },
      points: fixture().points.map((point) => ({
        ...point,
        provenance: { kind: 'archived-control', description: 'Recovered from the original control table.' },
      })),
    }
    const body = JSON.stringify(recovered)
    const fetch = mockDownload(body)
    expect(await loadPublishedProject(mapRecord(body), signal())).toEqual(recovered)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects a stale map revision before fetching the project or any source image', async () => {
    const record = mapRecord()
    record.downloads[0].sha256 = 'c'.repeat(64)
    const fetch = mockDownload()
    await expect(loadPublishedProject(record, signal())).rejects.toThrow(/different native map revision/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('checks actual project bytes before parsing their schema', async () => {
    const fetch = mockDownload('{"schema":"wrong"}')
    await expect(loadPublishedProject(mapRecord(), signal())).rejects.toThrow(/checksum/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    { id: 'another-sheet', message: /different map/ },
    { sha256: 'c'.repeat(64), message: /source checksum/ },
    { sha256: null, message: /source checksum/ },
  ])('rejects a different original source identity before source loading', async ({ message, ...update }) => {
    const body = JSON.stringify({ ...fixture(), source: { ...fixture().source, ...update } })
    const fetch = mockDownload(body)
    await expect(loadPublishedProject(mapRecord(body), signal())).rejects.toThrow(message)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    null,
    'http://maps.example.test/original.png',
    'https://localhost/original.png',
    'https://user:secret@maps.example.test/original.png',
  ])('refuses a published project whose source is local or unsafe: %s', async (url) => {
    const body = JSON.stringify({ ...fixture(), source: { ...fixture().source, url } })
    const fetch = mockDownload(body)
    await expect(loadPublishedProject(mapRecord(body), signal())).rejects.toThrow(/HTTPS|credentials/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('checks the final download URL after a redirect', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(response(JSON.stringify(fixture()), undefined, 'https://localhost/project.json'))
    vi.stubGlobal('fetch', fetch)
    await expect(loadPublishedProject(mapRecord(), signal())).rejects.toThrow(/response must use a public HTTPS/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects an oversized declared file before reading its stream', async () => {
    const cancel = vi.fn()
    const getReader = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        url: projectURL,
        headers: new Headers({ 'Content-Length': String(MAX_PUBLISHED_PROJECT_BYTES + 1) }),
        body: { cancel, getReader },
      }),
    )
    await expect(loadPublishedProject(mapRecord(), signal())).rejects.toThrow(/1 MB/)
    expect(getReader).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('bounds streamed bytes even if Content-Length is absent or understated', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_PUBLISHED_PROJECT_BYTES + 1))
      },
      cancel,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(stream, { headers: { 'Content-Length': '10' } })))
    await expect(loadPublishedProject(mapRecord(), signal())).rejects.toThrow(/1 MB/)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('reports invalid JSON only after verifying its checksum', async () => {
    const body = '{broken'
    mockDownload(body)
    await expect(loadPublishedProject(mapRecord(body), signal())).rejects.toThrow(/invalid.*JSON/)
  })

  it('does not include a private download URL in network failure messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Error(`Request failed for ${projectURL}`)))
    await expect(loadPublishedProject(mapRecord(), signal())).rejects.toThrow('could not be downloaded')
    await expect(loadPublishedProject(mapRecord(), signal())).rejects.not.toThrow(projectURL)
  })

  it('preserves cancellation without starting a download', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetch = mockDownload()
    await expect(loadPublishedProject(mapRecord(), controller.signal)).rejects.toHaveProperty('name', 'AbortError')
    expect(fetch).not.toHaveBeenCalled()
  })
})
