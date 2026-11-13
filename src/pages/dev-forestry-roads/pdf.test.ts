import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportReportPdf } from './pdf'

const captured = vi.hoisted(() => ({
  download: vi.fn(),
  pdf: {
    addPage: vi.fn(),
    setFont: vi.fn(),
    setFontSize: vi.fn(),
    setTextColor: vi.fn(),
    splitTextToSize: vi.fn((value: string) => [value]),
    text: vi.fn(),
    addImage: vi.fn(),
    getNumberOfPages: vi.fn(() => 1),
    setPage: vi.fn(),
    output: vi.fn(() => new Blob(['%PDF-test'])),
  },
}))
vi.mock('@/lib/download', () => ({ downloadBlob: captured.download }))
vi.mock('jspdf', () => ({
  jsPDF: class {
    constructor() {
      return captured.pdf
    }
  },
}))

function fixture() {
  const decode = vi.fn().mockResolvedValue(undefined)
  const image = { decode, src: '' }
  vi.stubGlobal(
    'Image',
    class {
      constructor() {
        return image
      }
    },
  )
  const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toDataURL: vi.fn(() => 'data:image/png;base64,report-pixels'),
  }
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })
  const attributes = new Map([['viewBox', '0 0 450 175']])
  const clone = {
    getAttribute: (key: string) => attributes.get(key),
    setAttribute: (key: string, value: string) => attributes.set(key, value),
  }
  const svg = { tagName: 'svg', cloneNode: () => clone }
  const paragraph = (value: string) => ({ tagName: 'p', childNodes: [{ textContent: value }] })
  vi.stubGlobal(
    'DOMParser',
    class {
      parseFromString() {
        return { body: { children: [paragraph('Before the drawing'), svg, paragraph('After the drawing')] } }
      }
    },
  )
  vi.stubGlobal(
    'XMLSerializer',
    class {
      serializeToString() {
        return '<svg />'
      }
    },
  )
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:report-svg')
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  return { decode, image, context, canvas, attributes, createUrl, revokeUrl }
}

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('report PDF drawing rasterization', () => {
  it('reads a CPU-backed canvas at the original double resolution and retains surrounding report text', async () => {
    const f = fixture()
    await exportReportPdf('<report fixture>', 'report.pdf')
    expect(f.canvas.getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true })
    expect(f.attributes.get('width')).toBe('900')
    expect(f.attributes.get('height')).toBe('350')
    expect(f.canvas).toMatchObject({ width: 900, height: 350 })
    expect(f.context.fillStyle).toBe('white')
    expect(f.context.fillRect).toHaveBeenCalledWith(0, 0, 900, 350)
    expect(f.context.drawImage).toHaveBeenCalledWith(f.image, 0, 0)
    expect(captured.pdf.addImage).toHaveBeenCalledWith(
      'data:image/png;base64,report-pixels',
      'PNG',
      14,
      expect.any(Number),
      182,
      expect.any(Number),
    )
    expect(captured.pdf.addImage.mock.calls[0][5]).toBeCloseTo((182 * 175) / 450, 10)
    expect(captured.pdf.text.mock.calls.flat()).toContain('Before the drawing')
    expect(captured.pdf.text.mock.calls.flat()).toContain('After the drawing')
    expect(captured.download).toHaveBeenCalledWith(expect.any(Blob), 'report.pdf')
    expect(f.revokeUrl).toHaveBeenCalledWith('blob:report-svg')
  })

  it('never prints a style block as text, and gives a rasterized chart a sans-serif face', async () => {
    const f = fixture()
    const css = '.stream-register{table-layout:fixed;font-size:10px}'
    const style = { tagName: 'STYLE', textContent: css, childNodes: [{ textContent: css }], children: [] }
    const paragraph = { tagName: 'P', textContent: 'Register', childNodes: [{ textContent: 'Register' }], children: [] }
    const svg = {
      tagName: 'svg',
      cloneNode: () => ({
        getAttribute: (k: string) => f.attributes.get(k),
        setAttribute: (k: string, v: string) => f.attributes.set(k, v),
      }),
    }
    vi.stubGlobal(
      'DOMParser',
      class {
        parseFromString() {
          return { body: { children: [style, paragraph, svg] } }
        }
      },
    )
    await exportReportPdf('<report fixture>', 'report.pdf')
    const printed = captured.pdf.text.mock.calls.flat().join(' ')
    expect(printed).toContain('Register')
    expect(printed).not.toContain('stream-register')
    expect(f.attributes.get('font-family')).toMatch(/sans-serif/)
  })

  it('prints each list item on its own, numbering an ordered list', async () => {
    fixture()
    const li = (value: string) => ({
      tagName: 'LI',
      textContent: value,
      childNodes: [{ textContent: value }],
      children: [],
    })
    const list = (tagName: string, items: string[]) => ({
      tagName,
      textContent: items.join(''),
      childNodes: items.map((value) => ({ textContent: value })),
      children: items.map(li),
    })
    vi.stubGlobal(
      'DOMParser',
      class {
        parseFromString() {
          return { body: { children: [list('OL', ['Inverts', 'Span']), list('UL', ['Flag'])] } }
        }
      },
    )
    await exportReportPdf('<report fixture>', 'report.pdf')
    const printed = captured.pdf.text.mock.calls.map((call) => call[0])
    expect(printed).toEqual(expect.arrayContaining(['1. Inverts', '2. Span', '- Flag']))
  })

  it('releases the SVG resource and does not download an incomplete PDF if image decoding fails', async () => {
    const f = fixture()
    f.decode.mockRejectedValueOnce(Error('Invalid SVG drawing'))
    await expect(exportReportPdf('<report fixture>', 'report.pdf')).rejects.toThrow('Invalid SVG drawing')
    expect(f.context.drawImage).not.toHaveBeenCalled()
    expect(captured.download).not.toHaveBeenCalled()
    expect(f.revokeUrl).toHaveBeenCalledWith('blob:report-svg')
  })
})
