import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'exifr'
import { importFieldImage } from './toolImports'
vi.mock('exifr', () => ({ parse: vi.fn() }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
describe('field image camera suggestions', () => {
  it('reads the parser’s 35 mm format tag and true heading, retaining manual review', async () => {
    vi.mocked(parse).mockResolvedValue({
      longitude: -122.6,
      latitude: 53.9,
      DateTimeOriginal: new Date(2026, 8, 30),
      FocalLengthIn35mmFormat: 50,
      GPSImgDirectionRef: 'T',
      GPSImgDirection: 90,
      GPSAltitude: 12,
      GPSAltitudeRef: 1,
    })
    const close = vi.fn(),
      canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }),
        toDataURL: () => 'data:image/jpeg;base64,AAAA',
      }
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 3000, height: 2000, close })),
    )
    vi.stubGlobal('document', { createElement: () => canvas })
    const f = await importFieldImage(new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg' }), 'photo', null)
    expect(f).toMatchObject({
      lng: -122.6,
      lat: 53.9,
      bearing: 90,
      altitude: -12,
      captured: '2026-09-30',
      focal35Mm: 50,
      alignmentChecked: false,
      width: 1600,
    })
    expect(f.hfov).toBeCloseTo(39.6, 0)
    expect(close).toHaveBeenCalledOnce()
    vi.mocked(parse).mockResolvedValue({ GPSImgDirectionRef: 'M', GPSImgDirection: 90 })
    expect((await importFieldImage(new File(['jpeg'], 'magnetic.jpg'), 'photo', null)).bearing).toBeNull()
  })
})
