import { describe, expect, it, vi } from 'vitest'
import {
  SaveFileError,
  normalizeExtension,
  saveFileAs,
  saveFileName,
  saveFilePickerSupported,
  type SaveFileEnvironment,
} from './saveFile'

const pdf = { mime: 'application/pdf', extension: 'pdf', description: 'PDF document' }

function picker(options: { name?: string; written?: Blob[]; fail?: unknown; writeFails?: unknown } = {}) {
  const order: string[] = []
  const aborted: unknown[] = []
  const showSaveFilePicker = vi.fn(async (_options: unknown) => {
    order.push('dialog')
    if (options.fail) throw options.fail
    return {
      name: options.name ?? 'chosen.pdf',
      createWritable: async () => ({
        write: async (blob: Blob) => {
          if (options.writeFails) throw options.writeFails
          options.written?.push(blob)
        },
        close: async () => {
          order.push('closed')
        },
        abort: async (reason?: unknown) => {
          aborted.push(reason)
        },
      }),
    }
  })
  const download = vi.fn()
  const environment: SaveFileEnvironment = { showSaveFilePicker, download }
  return { environment, showSaveFilePicker, download, order, aborted }
}

describe('save file names', () => {
  it('normalizes extensions and refuses malformed ones', () => {
    expect(normalizeExtension('PDF')).toBe('.pdf')
    expect(normalizeExtension('.geojson')).toBe('.geojson')
    expect(normalizeExtension('tar.gz')).toBe('.tar.gz')
    expect(normalizeExtension('')).toBeNull()
    expect(normalizeExtension('p d f')).toBeNull()
    expect(normalizeExtension('x'.repeat(20))).toBeNull()
  })

  it('cleans a name and adds a missing extension', () => {
    expect(saveFileName('Block 12/road: A', 'pdf')).toBe('Block 12-road- A.pdf')
    expect(saveFileName('sheet.PDF', 'pdf')).toBe('sheet.PDF')
    expect(saveFileName('  ', 'mp4')).toBe('download.mp4')
    expect(saveFileName('..hidden', 'txt')).toBe('hidden.txt')
  })
})

describe('save file as', () => {
  it('knows whether the browser has a save dialog', () => {
    expect(saveFilePickerSupported({ showSaveFilePicker: null })).toBe(false)
    expect(saveFilePickerSupported(picker().environment)).toBe(true)
  })

  it('opens the dialog before building, then writes what was built', async () => {
    const written: Blob[] = []
    const { environment, showSaveFilePicker, download, order } = picker({ written, name: 'my sheet.pdf' })
    const content = vi.fn(async () => {
      order.push('built')
      return new Blob(['%PDF'], { type: 'application/pdf' })
    })
    const saving = saveFileAs({
      suggestedName: 'Block sheet',
      type: pdf,
      content,
      rememberFolderAs: 'pgmaps sheets!',
      environment,
    })
    // The dialog is asked for synchronously, inside the click.
    expect(showSaveFilePicker).toHaveBeenCalledTimes(1)
    expect(content).not.toHaveBeenCalled()
    await expect(saving).resolves.toEqual({ outcome: 'saved', fileName: 'my sheet.pdf' })
    expect(order).toEqual(['dialog', 'built', 'closed'])
    expect(showSaveFilePicker.mock.calls[0][0]).toEqual({
      suggestedName: 'Block sheet.pdf',
      types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }],
      excludeAcceptAllOption: false,
      id: 'pgmapssheets',
    })
    expect(await written[0].text()).toBe('%PDF')
    expect(download).not.toHaveBeenCalled()
  })

  it('builds nothing when the dialog is cancelled', async () => {
    const { environment, download } = picker({ fail: new DOMException('The user aborted a request.', 'AbortError') })
    const content = vi.fn(() => 'never')
    await expect(saveFileAs({ suggestedName: 'a', type: pdf, content, environment })).resolves.toEqual({
      outcome: 'cancelled',
    })
    expect(content).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
  })

  it('downloads where there is no dialog, typing text content', async () => {
    const download = vi.fn()
    const result = await saveFileAs({
      suggestedName: 'roads',
      type: { mime: 'application/geo+json', extension: '.geojson', description: 'GeoJSON' },
      content: () => '{"type":"FeatureCollection","features":[]}',
      environment: { showSaveFilePicker: null, download },
    })
    expect(result).toEqual({ outcome: 'downloaded', fileName: 'roads.geojson' })
    const [blob, name] = download.mock.calls[0] as [Blob, string]
    expect(name).toBe('roads.geojson')
    expect(blob.type).toBe('application/geo+json')
  })

  it('downloads when the dialog cannot open', async () => {
    const { environment, download } = picker({
      fail: new DOMException('Must be handling a user gesture.', 'SecurityError'),
    })
    const result = await saveFileAs({ suggestedName: 'a', type: pdf, content: () => new Blob(['x']), environment })
    expect(result).toEqual({ outcome: 'downloaded', fileName: 'a.pdf' })
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('offers no type filter for a malformed type rather than failing the dialog', async () => {
    const { environment, showSaveFilePicker } = picker()
    await saveFileAs({
      suggestedName: 'a',
      type: { mime: 'not a mime', extension: 'bin', description: 'Data' },
      content: () => 'x',
      environment,
    })
    expect(showSaveFilePicker.mock.calls[0][0]).toMatchObject({ suggestedName: 'a.bin', types: undefined })
  })

  it('reports a build that fails after the place was chosen', async () => {
    const { environment } = picker()
    const error = await saveFileAs({
      suggestedName: 'a',
      type: pdf,
      content: async () => {
        throw new Error('The map closed.')
      },
      environment,
    }).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(SaveFileError)
    expect(error).toMatchObject({ reason: 'build-failed', message: 'The file could not be made. The map closed.' })
  })

  it('reports and aborts a write that fails', async () => {
    const { environment, aborted } = picker({ writeFails: new DOMException('Disk full', 'QuotaExceededError') })
    await expect(saveFileAs({ suggestedName: 'a', type: pdf, content: () => 'x', environment })).rejects.toMatchObject({
      reason: 'write-failed',
      message: 'The file could not be written there (Disk full). Choose another place, or use Download.',
    })
    expect(aborted).toHaveLength(1)
  })
})
