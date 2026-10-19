import { downloadBlob } from '@/lib/download'
/** Rasterize our self-contained SVG; no remote images or fonts are involved. */
export async function downloadProfilePNG(svg: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(Error('Profile image could not render'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth * 2
    canvas.height = image.naturalHeight * 2
    const context = canvas.getContext('2d')
    if (!context) throw Error('PNG export unavailable')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(Error('PNG export failed'))), 'image/png'),
    )
    downloadBlob(blob, 'tree-side-profiles.png')
  } finally {
    URL.revokeObjectURL(url)
  }
}
