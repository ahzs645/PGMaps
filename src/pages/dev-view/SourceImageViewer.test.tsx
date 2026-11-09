import { useState, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OriginalImagePanel, SourceImageViewer } from './SourceImageViewer'
import type { ImagePyramid, ImageVariant, RasterRecord } from './catalogue'
import type { ImageTile, ImageTileReader } from './imagePyramid'

const io = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('./imagePyramid', async (original) => ({
  ...(await original<typeof import('./imagePyramid')>()),
  createImageTileReader: io.create,
}))
vi.mock('@/components/ui/map-panels', () => ({
  InlineAlert: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const original: ImageVariant = {
  id: 'original',
  label: 'Original document page',
  role: 'original-scan',
  image: {
    url: 'https://images.example.test/original.tif',
    width: 12095,
    height: 6712,
    sha256: 'a'.repeat(64),
    mimeType: 'image/tiff',
  },
  preview: { url: 'https://images.example.test/original-preview.webp', width: 1600, height: 888 },
  pyramid: {
    format: 'pmtiles-image-v1',
    url: 'https://images.example.test/original.pmtiles',
    width: 12095,
    height: 6712,
    tileSize: 512,
    maxZoom: 5,
  },
}
const crop: ImageVariant = {
  id: 'crop',
  label: 'Recovered edit source',
  role: 'edit-source',
  image: { url: 'https://images.example.test/crop.png', width: 4096, height: 3072, sha256: 'b'.repeat(64) },
  preview: { url: 'https://images.example.test/crop-preview.webp', width: 1600, height: 1200 },
  pyramid: {
    format: 'pmtiles-image-v1',
    url: 'https://images.example.test/crop.pmtiles',
    width: 4096,
    height: 3072,
    tileSize: 512,
    maxZoom: 3,
  },
}
const record: RasterRecord = {
  id: 'map',
  title: 'Synthetic map',
  bounds: [-126, 53, -124, 55],
  assets: [],
  downloads: [],
  sources: [],
  fullSheets: [],
  imageVariants: [original, crop],
}
function content(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : content(child))).join('')
}
function SourcePanel({ item }: { item: RasterRecord }) {
  const [choiceId, setChoiceId] = useState('')
  return <OriginalImagePanel item={item} choiceId={choiceId} onChoiceChange={setChoiceId} />
}
let renderer: ReactTestRenderer | undefined
const button = (label: string) =>
  renderer!.root.findAll(
    (node) => node.type === 'button' && (node.props['aria-label'] === label || content(node) === label),
  )[0]
const images = () => renderer!.root.findAllByType('img').map((node) => node.props.src)
const viewport = () => renderer!.root.findByProps({ 'data-image-viewport': 'true' })

beforeEach(() => {
  io.create
    .mockReset()
    .mockImplementation(
      (): ImageTileReader => ({ read: vi.fn(async (tile) => `blob:${tile.key}`), retain: vi.fn(), dispose: vi.fn() }),
    )
})
afterEach(() => {
  if (renderer) act(() => renderer!.unmount())
  renderer = undefined
  vi.restoreAllMocks()
})

describe('Source-image selection and detail viewing', () => {
  it('cancels the old source, resets its native view and ignores late tiles after choosing another image', async () => {
    const pending: { signal: AbortSignal; finish: (url: string) => void }[] = []
    const first: ImageTileReader = {
      read: vi.fn(
        (_tile: ImageTile, signal: AbortSignal) => new Promise<string>((finish) => pending.push({ signal, finish })),
      ),
      retain: vi.fn(),
      dispose: vi.fn(),
    }
    const second: ImageTileReader = {
      read: vi.fn(async (tile) => `blob:crop-${tile.key}`),
      retain: vi.fn(),
      dispose: vi.fn(),
    }
    io.create.mockImplementation((pyramid: ImagePyramid) => (pyramid.url === original.pyramid!.url ? first : second))
    await act(async () => {
      renderer = create(<SourcePanel item={{ ...record, imageVariants: [crop, original] }} />)
    })
    await act(async () => button('View source image at 100 percent').props.onClick())
    expect(first.read).toHaveBeenCalledWith(expect.objectContaining({ z: 5 }), expect.any(AbortSignal))
    await act(async () => renderer!.root.findByType('select').props.onChange({ target: { value: 'crop' } }))
    expect(first.dispose).toHaveBeenCalledOnce()
    expect(pending.every((request) => request.signal.aborted)).toBe(true)
    await act(async () => pending.forEach((request) => request.finish('blob:old-source')))
    expect(images()).toContain(crop.preview!.url)
    expect(images()).not.toContain(original.preview!.url)
    expect(images()).not.toContain('blob:old-source')
    expect(images().some((url) => url.startsWith('blob:crop-'))).toBe(true)
    // The new crop starts fitted; it does not inherit the original's 100% frame.
    expect(second.read).toHaveBeenCalledWith(expect.objectContaining({ z: 1 }), expect.any(AbortSignal))
    expect(content(renderer!.root)).toContain('4,096 × 3,072 px')
    expect(
      renderer!.root
        .findAllByType('a')
        .some((link) => link.props.href === crop.image.url && content(link).includes('Download edit source')),
    ).toBe(true)
  })

  it('offers fit and native zoom on a narrow viewport and preserves pinch gestures in source pixels', async () => {
    const element = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 360 }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      focus: vi.fn(),
      setPointerCapture: vi.fn(),
    }
    await act(async () => {
      renderer = create(<SourceImageViewer variant={original} />, {
        createNodeMock: (node) => (node.props['data-image-viewport'] ? element : null),
      })
    })
    expect(button('Zoom in source image')).toBeDefined()
    expect(button('Zoom out source image')).toBeDefined()
    expect(button('Fit sheet')).toBeDefined()
    await act(async () => button('View source image at 100 percent').props.onClick())
    const imageWidth = () =>
      viewport().findAll((node) => node.type === 'div' && node.props.className?.includes('pointer-events-none'))[0]
        .props.style.width
    expect(imageWidth()).toBe(original.image.width)
    const event = (id: number, x: number) => ({
      pointerId: id,
      pointerType: 'touch',
      clientX: x,
      clientY: 180,
      currentTarget: element,
    })
    await act(async () => {
      viewport().props.onPointerDown(event(1, 100))
      viewport().props.onPointerDown(event(2, 200))
      viewport().props.onPointerMove(event(2, 250))
    })
    expect(imageWidth()).toBe(original.image.width * 1.5)
    await act(async () => {
      viewport().props.onPointerUp(event(1, 100))
      viewport().props.onPointerUp(event(2, 250))
      button('Fit sheet').props.onClick()
    })
    expect(imageWidth()).toBe(360)
    expect(images()).not.toContain(original.image.url)
    expect(element.setPointerCapture).toHaveBeenCalledTimes(2)
    expect(element.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false })
  })

  it('shows a browser preview for an original TIFF and preserves its original download when no preview exists', async () => {
    const tiff = { ...original, pyramid: undefined }
    await act(async () => {
      renderer = create(<SourceImageViewer variant={tiff} />)
    })
    expect(images()).toEqual([original.preview!.url])
    expect(
      renderer!.root
        .findAllByType('a')
        .some((link) => link.props.href === original.image.url && content(link).includes('Download original scan')),
    ).toBe(true)
    await act(async () => renderer!.update(<SourceImageViewer variant={{ ...tiff, preview: undefined }} />))
    expect(images()).toEqual([])
    expect(content(renderer!.root)).toContain('Use the source download to inspect this image.')
    expect(content(renderer!.root)).not.toContain('Load full source image')
    expect(renderer!.root.findAllByType('a').map((link) => link.props.href)).toContain(original.image.url)
    expect(io.create).not.toHaveBeenCalled()
  })

  it('does not automatically decode a huge original when a pyramid or smaller preview is absent', async () => {
    const jpeg = {
      ...original,
      image: { ...original.image, url: 'https://images.example.test/large.jpg', mimeType: 'image/jpeg' },
      preview: undefined,
      pyramid: undefined,
    }
    await act(async () => {
      renderer = create(<SourceImageViewer variant={jpeg} />)
    })
    expect(images()).toEqual([])
    await act(async () => button('Load full source image').props.onClick())
    expect(images()).toEqual([jpeg.image.url])
  })

  it('keeps document links accessible when a map has no linked image representation', async () => {
    await act(async () => {
      renderer = create(
        <SourcePanel
          item={{
            ...record,
            imageVariants: [],
            sources: [{ title: 'Source PDF', url: 'https://images.example.test/document.pdf' }],
          }}
        />,
      )
    })
    expect(renderer!.root.findAllByType('a').map((link) => link.props.href)).toEqual([
      'https://images.example.test/document.pdf',
    ])
    expect(images()).toEqual([])
    expect(content(renderer!.root)).toContain('A source-image preview is not linked for this map.')
  })
})
