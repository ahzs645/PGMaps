import type { ImageFile, ImageVariant, RasterRecord } from './catalogue'

/** Legacy sheet dimensions may be unknown; never invent a native pixel frame for them. */
export type SourceImageChoice = Omit<ImageVariant, 'image'> & {
  image: Omit<ImageFile, 'width' | 'height'> & { width?: number; height?: number }
  legacy?: boolean
}

export function sourceImageRoleLabel(role: ImageVariant['role']): string {
  switch (role) {
    case 'original-scan':
      return 'Original scan'
    case 'edit-source':
      return 'Edit source'
    case 'reading-preview':
      return 'Reading preview'
  }
}

/**
 * One map can reference several source pages or crops. Preserve their declared identities;
 * a thumbnail, shared title or partial asset match does not establish a source relationship.
 */
export function sourceImageChoices(record: RasterRecord): SourceImageChoice[] {
  const result: SourceImageChoice[] = [...(record.imageVariants || [])]
  const represented = new Set(result.flatMap((variant) => [variant.image.url, variant.preview?.url]))
  const ids = new Set(result.map((variant) => variant.id))
  record.fullSheets.forEach((sheet, index) => {
    if (represented.has(sheet.image)) return
    let id = `legacy-sheet-${index + 1}`
    while (ids.has(id)) id = `legacy-${id}`
    ids.add(id)
    represented.add(sheet.image)
    result.push({
      id,
      label: sheet.label,
      role: 'reading-preview',
      image: {
        url: sheet.image,
        width: sheet.width,
        height: sheet.height,
        sha256: sheet.sha256,
        bytes: sheet.bytes,
      },
      note: sheet.sourceNote || 'Existing reading image; original scan resolution has not been established.',
      legacy: true,
    })
  })
  return result
}
