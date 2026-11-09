import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MapImagePreview } from './MapImagePreview'
import type { ImageVariant, RasterRecord } from './catalogue'

const io = vi.hoisted(() => ({ raster: vi.fn() }))
vi.mock('./rasterPreview', () => ({ rasterPreview: io.raster }))
vi.mock('@/components/ui/dialog', () => {
  const Container = ({ children }: { children: ReactNode }) => <div>{children}</div>
  return {
    Dialog: Container,
    DialogContent: Container,
    DialogDescription: Container,
    DialogHeader: Container,
    DialogTitle: Container,
  }
})
vi.mock('@/components/ui/map-panels', () => ({
  InlineAlert: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CollapsibleSection: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
const record: RasterRecord = {
  id: 'map',
  title: 'Synthetic map',
  bounds: [-126, 53, -124, 55],
  assets: [],
  sources: [],
  fullSheets: [],
  downloads: [{ url: 'https://maps.example.test/rectified.tif', width: 800, height: 600, crs: 'EPSG:3857' }],
  imageVariants: [
    {
      id: 'original',
      role: 'original-scan',
      label: 'Original scan',
      image: { url: 'https://maps.example.test/original.tif', width: 12095, height: 6712, mimeType: 'image/tiff' },
      preview: { url: 'https://maps.example.test/source-preview.webp', width: 1600, height: 888 },
    },
  ],
}
const callbacks = { onClose: vi.fn(), onMap: vi.fn(), onSheet: vi.fn(), onDetails: vi.fn() }
let renderer: ReactTestRenderer | undefined
function content(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : content(child))).join('')
}
const button = (label: string) => renderer!.root.findAll((node) => node.type === 'button' && content(node) === label)[0]
const images = () => renderer!.root.findAllByType('img').map((node) => node.props.src)
async function mount(item = record) {
  await act(async () => {
    renderer = create(<MapImagePreview item={item} {...callbacks} />)
  })
}
async function click(label: string) {
  await act(async () => button(label).props.onClick())
}

beforeEach(() => {
  io.raster.mockReset().mockResolvedValue(new Blob(['preview']))
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rectified')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})
afterEach(() => {
  if (renderer) act(() => renderer!.unmount())
  renderer = undefined
  vi.restoreAllMocks()
})

describe('Original and rectified representations', () => {
  it.each([
    { id: 'edit-crop', label: 'Recovered edit crop', role: 'edit-source', modeLabel: 'Edit source' },
    { id: 'second-page', label: 'Second original page', role: 'original-scan', modeLabel: 'Original scan' },
  ] as const)('keeps the selected $label through comparison and map-only view changes', async (alternate) => {
    const variant: ImageVariant = {
      ...alternate,
      image: { url: `https://maps.example.test/${alternate.id}.png`, width: 600, height: 400 },
    }
    await mount({ ...record, imageVariants: [...record.imageVariants!, variant] })
    await act(async () => renderer!.root.findByType('select').props.onChange({ target: { value: alternate.id } }))
    expect(images()).toEqual([variant.image.url])
    await click('Compare')
    expect(renderer!.root.findByType('select').props.value).toBe(alternate.id)
    expect(images()).toContain(variant.image.url)
    expect(images()).not.toContain(record.imageVariants![0].preview!.url)
    await click('Map overlay')
    await click(alternate.modeLabel)
    expect(renderer!.root.findByType('select').props.value).toBe(alternate.id)
    expect(images()).toEqual([variant.image.url])
    // A selection made within Compare must also survive returning to the source view.
    await click('Compare')
    await act(async () => renderer!.root.findByType('select').props.onChange({ target: { value: 'original' } }))
    await click('Original scan')
    expect(renderer!.root.findByType('select').props.value).toBe('original')
    expect(images()).toEqual([record.imageVariants![0].preview!.url])
    expect(io.raster).toHaveBeenCalledOnce()
  })

  it('loads the original reading preview first and requests the rectified view only when needed', async () => {
    await mount()
    expect(io.raster).not.toHaveBeenCalled()
    expect(images()).toEqual([record.imageVariants![0].preview!.url])
    await click('Compare')
    expect(io.raster).toHaveBeenCalledOnce()
    expect(images()).toContain('blob:rectified')
    const links = renderer!.root.findAllByType('a')
    expect(
      links.some(
        (link) =>
          link.props.href === record.imageVariants![0].image.url && content(link).includes('Download original scan'),
      ),
    ).toBe(true)
    expect(
      links.some(
        (link) => link.props.href === record.downloads[0].url && content(link).includes('Download rectified GeoTIFF'),
      ),
    ).toBe(true)
    expect(content(renderer!.root)).toContain('12,095 × 6,712 px')
    expect(content(renderer!.root)).toContain('800 × 600 px')
    await click('Map overlay')
    await click('Original scan')
    await click('Compare')
    expect(io.raster).toHaveBeenCalledOnce()
    expect(content(renderer!.root)).toContain('separate views')
  })

  it('does not render a late rectified response after the record changes, even with the same map id', async () => {
    let finish!: (blob: Blob) => void
    io.raster.mockImplementation(
      () =>
        new Promise<Blob>((resolve) => {
          finish = resolve
        }),
    )
    await mount()
    await click('Map overlay')
    const signal = io.raster.mock.calls[0][1] as AbortSignal
    const updated: RasterRecord = {
      ...record,
      imageVariants: [
        {
          ...record.imageVariants![0],
          preview: { url: 'https://maps.example.test/revised-preview.webp', width: 1600, height: 888 },
          image: { ...record.imageVariants![0].image, url: 'https://maps.example.test/revised-original.tif' },
        },
      ],
    }
    await act(async () => renderer!.update(<MapImagePreview item={updated} {...callbacks} />))
    expect(signal.aborted).toBe(true)
    expect(button('Original scan').props['aria-pressed']).toBe(true)
    await act(async () => finish(new Blob(['old preview'])))
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(images()).toEqual(['https://maps.example.test/revised-preview.webp'])
  })

  it('keeps legacy source sheets working without claiming they are original scans', async () => {
    await mount({
      ...record,
      imageVariants: undefined,
      fullSheets: [{ label: 'Existing sheet', image: 'https://maps.example.test/legacy.png' }],
    })
    expect(button('Source sheet').props['aria-pressed']).toBe(true)
    expect(images()).toEqual(['https://maps.example.test/legacy.png'])
    expect(content(renderer!.root)).toContain('Reading preview')
    expect(content(renderer!.root)).not.toContain('Download original scan')
    expect(io.raster).not.toHaveBeenCalled()
    await click('Map overlay')
    expect(io.raster).toHaveBeenCalledOnce()
  })

  it('opens existing map-only records and exposes document links when no source preview is linked', async () => {
    await mount({
      ...record,
      imageVariants: undefined,
      sources: [{ title: 'Original document', url: 'https://maps.example.test/document.pdf' }],
    })
    expect(button('Map overlay').props['aria-pressed']).toBe(true)
    expect(button('Compare').props.disabled).toBe(true)
    expect(io.raster).toHaveBeenCalledOnce()
    await click('Source sheet')
    expect(renderer!.root.findAllByType('a').map((link) => link.props.href)).toContain(
      'https://maps.example.test/document.pdf',
    )
    expect(images()).toEqual([])
  })
})
