import { describe, expect, it, vi } from 'vitest'
import {
  ClipboardImageError,
  clipboardImageSupported,
  clipboardImageUnsupportedReason,
  copyImageToClipboard,
  type ImageClipboardEnvironment,
} from './clipboardImage'

class FakeItem {
  constructor(readonly items: Record<string, Blob | Promise<Blob>>) {}
}

function environment(write: (items: FakeItem[]) => Promise<void>): ImageClipboardEnvironment {
  return {
    clipboard: { write: write as (items: unknown[]) => Promise<void> },
    ClipboardItem: FakeItem,
    isSecureContext: true,
  }
}

/** A clipboard that, like a real one, reads the promised PNG before it settles. */
const readingClipboard = (seen: Blob[] = []) =>
  vi.fn(async (items: FakeItem[]) => {
    seen.push(await items[0].items['image/png'])
  })

const png = () => new Blob(['png-bytes'], { type: 'image/png' })

describe('clipboard image', () => {
  it('names why a browser cannot copy images', () => {
    expect(clipboardImageUnsupportedReason({ clipboard: null, ClipboardItem: null, isSecureContext: true })).toMatch(
      /cannot copy images/,
    )
    expect(clipboardImageUnsupportedReason({ ...environment(async () => {}), isSecureContext: false })).toMatch(
      /secure/,
    )
    expect(clipboardImageSupported(environment(async () => {}))).toBe(true)
  })

  it('starts the write at once with the picture still rendering', async () => {
    const seen: Blob[] = []
    const write = readingClipboard(seen)
    let finish!: (blob: Blob) => void
    const rendering = new Promise<Blob>((resolve) => (finish = resolve))
    const copied = copyImageToClipboard(rendering, environment(write))
    // Called synchronously inside the click, before the picture exists.
    expect(write).toHaveBeenCalledTimes(1)
    finish(png())
    await copied
    expect(seen[0].type).toBe('image/png')
  })

  it('types an untyped blob as PNG', async () => {
    const seen: Blob[] = []
    await copyImageToClipboard(new Blob(['x']), environment(readingClipboard(seen)))
    expect(seen[0].type).toBe('image/png')
  })

  it('rejects as unsupported without touching the render', async () => {
    const failed = Promise.reject(new Error('render broke'))
    await expect(
      copyImageToClipboard(failed, { clipboard: null, ClipboardItem: null, isSecureContext: true }),
    ).rejects.toMatchObject({ reason: 'unsupported' })
  })

  it('reports a denied write in words', async () => {
    const write = vi.fn(async () => {
      throw new DOMException('Document is not focused.', 'NotAllowedError')
    })
    const error = await copyImageToClipboard(png(), environment(write)).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(ClipboardImageError)
    expect(error).toMatchObject({ reason: 'denied' })
    expect((error as Error).message).toMatch(/did not allow copying/)
  })

  it('reports the render’s own failure, not the browser’s', async () => {
    const write = vi.fn(async (items: FakeItem[]) => {
      await items[0].items['image/png']
    })
    const error = await copyImageToClipboard(Promise.reject(new Error('The map closed.')), environment(write)).catch(
      (reason: unknown) => reason,
    )
    expect(error).toMatchObject({ reason: 'render-failed', message: 'The picture could not be made. The map closed.' })
  })

  it('refuses a picture that is not a PNG, or empty', async () => {
    const write = readingClipboard()
    await expect(
      copyImageToClipboard(new Blob(['j'], { type: 'image/jpeg' }), environment(write)),
    ).rejects.toMatchObject({ reason: 'not-png' })
    await expect(copyImageToClipboard(new Blob([], { type: 'image/png' }), environment(write))).rejects.toMatchObject({
      reason: 'render-failed',
    })
  })

  it('reports any other failure with the browser’s detail', async () => {
    const write = vi.fn(async () => {
      throw new Error('Clipboard busy')
    })
    await expect(copyImageToClipboard(png(), environment(write))).rejects.toMatchObject({
      reason: 'failed',
      message: 'The picture could not be copied (Clipboard busy). Use Download instead.',
    })
  })
})
