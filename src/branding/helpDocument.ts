import css from './branding.css?inline'
import { logoDataUrl, parseBrandRecord, type ExportBrand } from './model'
import { brandVariables, fontCss } from './presentation'

const variables = [
  '--brand-body-weight',
  '--brand-heading-weight',
  '--brand-label-weight',
  '--muted-foreground',
  '--ink',
  '--paper',
  '--muted',
  '--rule',
  '--link',
  '--brand-line',
  '--primary',
  '--primary-foreground',
  '--ring',
  '--brand-ui-primary',
  '--brand-ui-foreground',
  '--ddc-midnight',
  '--ddc-paper',
  '--ddc-graphite',
  '--ddc-ice',
  '--access-blue',
  '--access-text',
  '--access-on-dark',
  '--brand-body',
  '--brand-display',
  '--brand-label',
  '--brand-ink',
  '--brand-paper',
  '--brand-primary',
]

export function applyHelpBrand(document: Document, selected: ExportBrand | null) {
  document.getElementById('pgmaps-active-brand')?.remove()
  document.querySelector('[data-brand-provenance]')?.remove()
  for (const name of variables) document.documentElement.style.removeProperty(name)
  const brand = selected?.brand
  document.documentElement.dataset.brandId = brand?.profile.id ?? ''
  if (brand && selected?.typography) document.documentElement.dataset.brandTypography = 'true'
  else delete document.documentElement.dataset.brandTypography
  if (!brand) return
  for (const [key, value] of Object.entries(brandVariables(brand, selected.typography, true)))
    document.documentElement.style.setProperty(key, value)
  const style = document.createElement('style')
  style.id = 'pgmaps-active-brand'
  style.textContent = css + '\n' + (selected.typography ? fontCss(brand) : '')
  document.head.append(style)
  for (const element of document.querySelectorAll<HTMLElement>('.access-lockup,.brand-logo')) {
    element.className = 'brand-logo'
    element.replaceChildren()
    for (const [variant, name] of [
      ['primary', 'brand-logo-light'],
      ['reverse', 'brand-logo-dark'],
    ] as const) {
      const image = document.createElement('img')
      image.className = name
      image.src = logoDataUrl(brand.profile.logos[variant])
      image.alt = brand.profile.name
      element.append(image)
    }
    element.removeAttribute('role')
    element.removeAttribute('aria-label')
  }
  for (const home of document.querySelectorAll('.tour-home'))
    home.setAttribute('aria-label', brand.profile.name + ' Help')
  for (const name of document.querySelectorAll('[data-brand-name]')) name.textContent = brand.profile.name
  for (const icon of document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'))
    icon.href = logoDataUrl(brand.profile.logos.primary)
  document.title = document.title.replace('DDC Access Help', brand.profile.name + ' Help')
  const notice = document.createElement('p')
  notice.dataset.brandProvenance = ''
  notice.style.cssText = 'margin:1rem;font-size:.75rem;color:var(--brand-ink)'
  notice.textContent = brand.profile.provenance.status
  document.body.append(notice)
}

export function snapshotHelpBrand(document: Document, selected: ExportBrand | null) {
  document.getElementById('pgmaps-brand-snapshot')?.remove()
  applyHelpBrand(document, selected)
  const snapshot = document.createElement('script')
  snapshot.type = 'application/json'
  snapshot.id = 'pgmaps-brand-snapshot'
  snapshot.textContent = JSON.stringify(selected).replace(/</g, '\\u003c')
  document.head.append(snapshot)
  if (selected) document.head.append(document.createComment(selected.brand.notices.join('\n').replace(/--/g, '—')))
}

export function readHelpSnapshot(document: Document): ExportBrand | null | undefined {
  const snapshot = document.getElementById('pgmaps-brand-snapshot')
  if (!snapshot) return undefined
  const value = JSON.parse(snapshot.textContent ?? 'null')
  if (value === null) return null
  return { brand: parseBrandRecord(value.brand), typography: value.typography === true, pdfFonts: false }
}
