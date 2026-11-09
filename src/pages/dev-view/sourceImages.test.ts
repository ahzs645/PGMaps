import { describe, expect, it } from 'vitest'
import type { ImageVariant, RasterRecord } from './catalogue'
import { sourceImageChoices, sourceImageRoleLabel } from './sourceImages'

const original: ImageVariant = {
  id: 'original',
  label: 'Full scan',
  role: 'original-scan',
  image: { url: 'https://example.test/original.jpg', width: 10000, height: 7000 },
  preview: { url: 'https://example.test/reading.jpg', width: 1800, height: 1260 },
}
const record: RasterRecord = {
  id: 'map',
  title: 'Same title',
  bounds: [-126, 53, -124, 55],
  assets: [],
  sources: [],
  downloads: [],
  fullSheets: [],
  thumbnail: 'https://example.test/card.webp',
}

describe('Source image choices', () => {
  it('does not promote a library thumbnail or rectified download into an original scan', () => {
    expect(sourceImageChoices({ ...record, downloads: [{ url: 'https://example.test/rectified.tif' }] })).toEqual([])
  })
  it('labels legacy sheets as reading previews and preserves unknown pixel dimensions', () => {
    const choices = sourceImageChoices({
      ...record,
      fullSheets: [{ image: 'https://example.test/reading.jpg', label: 'Original-resolution full sheet' }],
    })
    expect(choices).toHaveLength(1)
    expect(choices[0].role).toBe('reading-preview')
    expect(choices[0].legacy).toBe(true)
    expect(choices[0].image.width).toBeUndefined()
    expect(sourceImageRoleLabel(choices[0].role)).toBe('Reading preview')
  })
  it('keeps explicit original and edit-source frames distinct, even when they share a title', () => {
    const edit: ImageVariant = {
      ...original,
      id: 'crop',
      role: 'edit-source',
      image: { url: 'https://example.test/crop.png', width: 3000, height: 2000 },
      preview: undefined,
    }
    const choices = sourceImageChoices({ ...record, imageVariants: [original, edit] })
    expect(choices.map((choice) => [choice.id, choice.role, choice.image.width])).toEqual([
      ['original', 'original-scan', 10000],
      ['crop', 'edit-source', 3000],
    ])
    expect(sourceImageRoleLabel(edit.role)).toBe('Edit source')
  })
  it('deduplicates a legacy sheet already present as an explicit preview, retaining other pages', () => {
    const choices = sourceImageChoices({
      ...record,
      imageVariants: [original],
      fullSheets: [
        { image: original.preview!.url, label: 'First page' },
        { image: 'https://example.test/page2.jpg', label: 'Second page', width: 1800, height: 1200 },
      ],
    })
    expect(choices).toHaveLength(2)
    expect(choices[0].id).toBe('original')
    expect(choices[1]).toMatchObject({ role: 'reading-preview', image: { width: 1800, height: 1200 } })
  })
  it('avoids an explicit/legacy id collision without replacing the explicit source', () => {
    const choices = sourceImageChoices({
      ...record,
      imageVariants: [{ ...original, id: 'legacy-sheet-1' }],
      fullSheets: [{ image: 'https://example.test/other.jpg', label: 'Other page' }],
    })
    expect(new Set(choices.map((choice) => choice.id)).size).toBe(2)
    expect(choices[0].image.url).toBe(original.image.url)
  })
})
