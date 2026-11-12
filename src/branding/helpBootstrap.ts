import { applyHelpBrand, readHelpSnapshot, snapshotHelpBrand } from './helpDocument'
import { getBrandingState, initializeBranding } from './store'
import type { ExportBrand } from './model'

async function start() {
  let selected: ExportBrand | null = readHelpSnapshot(document) ?? null
  if (!document.getElementById('pgmaps-brand-snapshot')) {
    await initializeBranding()
    const { brands, settings } = getBrandingState()
    const brand = settings.help && brands.find((brand) => brand.key === settings.selected)
    selected = brand ? { brand, typography: settings.typography, pdfFonts: false } : null
  }
  applyHelpBrand(document, selected)
  // Portable players already inline all their assets. Freeze the brand in the downloaded copy too.
  if (document.getElementById('tourkit-capture-data') && document.querySelector('.tour-nav')) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = 'Download offline lesson'
    button.style.cssText =
      'font:inherit;color:inherit;background:transparent;border:1px solid currentColor;padding:.4rem .6rem;border-radius:var(--radius);cursor:pointer'
    button.addEventListener('click', () => {
      const copy = document.cloneNode(true) as Document
      snapshotHelpBrand(copy, selected)
      copy.querySelector('[data-offline-download]')?.remove()
      const blob = new Blob(['<!doctype html>\n' + copy.documentElement.outerHTML], { type: 'text/html' })
      const url = URL.createObjectURL(blob),
        link = document.createElement('a')
      link.href = url
      link.download = (document.querySelector('.tour-nav')?.getAttribute('data-lesson') ?? 'lesson') + '.html'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    })
    button.dataset.offlineDownload = ''
    document.querySelector('.tour-nav')!.append(button)
  }
}
void start().catch((error: unknown) => {
  const message = document.createElement('p')
  message.setAttribute('role', 'status')
  message.textContent = `Branding could not be loaded. ${error instanceof Error ? error.message : ''}`
  document.body.append(message)
})
