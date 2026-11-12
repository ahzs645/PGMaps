import { logoDataUrl, type BrandFace, type BrandRecord, type ExportBrand } from './model'

export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const quoted = (value: string) =>
  '"' + value.replace(/[<>"\\\n\r\f]/g, (c) => '\\' + c.charCodeAt(0).toString(16) + ' ') + '"'
function fontFamily(face: BrandFace) {
  const generic = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'])
  const fallback = face.fallback
    .split(',')
    .slice(0, 8)
    .map((name) => name.trim().replace(/^(["'])(.*)\1$/, '$2'))
    .filter(Boolean)
    .map((name) => (generic.has(name) ? name : quoted(name)))
  return [quoted(face.family), ...fallback, 'sans-serif'].join(', ')
}
export function fontCss(brand: BrandRecord) {
  return brand.fonts
    .map(
      (f) =>
        `@font-face{font-family:${quoted(f.family)};font-weight:${f.weight};font-style:${f.style};font-display:swap;src:url("${f.dataUrl}")}`,
    )
    .join('\n')
}
function channels(hex: string) {
  const values = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = values,
    hi = Math.max(...values),
    lo = Math.min(...values),
    delta = hi - lo,
    light = (hi + lo) / 2
  const hue =
    delta === 0
      ? 0
      : hi === r
        ? ((g - b) / delta + (g < b ? 6 : 0)) * 60
        : hi === g
          ? ((b - r) / delta + 2) * 60
          : ((r - g) / delta + 4) * 60
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1))
  return `${hue.toFixed(2)} ${(saturation * 100).toFixed(2)}% ${(light * 100).toFixed(2)}%`
}
export function brandVariables(brand: BrandRecord, typography: boolean, help = false): Record<string, string> {
  const c = brand.profile.colours
  const result: Record<string, string> = {
    '--ink': c.ink,
    '--paper': c.paper,
    '--muted': help ? c.muted : channels(c.light),
    '--muted-foreground': channels(c.muted),
    '--rule': c.line,
    '--link': c.primary,
    '--brand-line': c.line,
    '--ddc-midnight': channels(c.ink),
    '--ddc-paper': channels(c.paper),
    '--ddc-graphite': channels(c.muted),
    '--ddc-ice': channels(c.light),
    '--access-blue': channels(c.primary),
    '--access-text': channels(c.primary),
    '--access-on-dark': channels(c.reverse),
    '--brand-ink': c.ink,
    '--brand-paper': c.paper,
    '--brand-primary': c.primary,
  }
  const rgb = [1, 3, 5]
    .map((i) => parseInt(c.primary.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
  result['--brand-ui-primary'] = channels(c.primary)
  result['--brand-ui-foreground'] = luminance > 0.179 ? '0 0% 0%' : '0 0% 100%'
  result['--primary'] = result['--brand-ui-primary']
  result['--primary-foreground'] = result['--brand-ui-foreground']
  result['--ring'] = result['--brand-ui-primary']
  if (typography)
    for (const [token, role] of [
      ['--brand-body', 'body'],
      ['--brand-display', 'heading'],
      ['--brand-label', 'label'],
    ] as const)
      result[token] = fontFamily(brand.profile.typography[role])
  if (typography)
    for (const role of ['body', 'heading', 'label'] as const)
      result[`--brand-${role}-weight`] = String(brand.profile.typography[role].weight)
  return result
}

export function brandHeader(brand: BrandRecord) {
  const profile = brand.profile,
    logo = profile.logos.primary
  const minimum = Math.max(profile.identity?.minimumLogoWidthMm ?? 0, 32)
  const clear = profile.identity?.logo?.clearSpaceRatio ?? 0
  return `<header data-brand-header style="margin-bottom:1rem;padding:${Math.max(2, minimum * clear)}mm"><img alt="${escapeHtml(profile.name)}" src="${logoDataUrl(logo)}" style="display:block;width:${minimum}mm;max-width:100%;height:auto;object-fit:contain"><p>${escapeHtml(profile.name)} · ${escapeHtml(profile.version)}</p></header>`
}

export function brandLogoSvg(
  brand: BrandRecord,
  x: number,
  y: number,
  width: number,
  height: number,
  unitsPerMm = 96 / 25.4,
) {
  const logo = brand.profile.logos.primary
  const ratio = logo.viewBox[2] / logo.viewBox[3],
    space = brand.profile.identity?.logo?.clearSpaceRatio ?? 0
  const actual = Math.min(width / (1 + 2 * space), height / (1 / ratio + 2 * space))
  if (actual < (brand.profile.identity?.minimumLogoWidthMm ?? 0) * unitsPerMm)
    throw Error('This logo does not fit its minimum print size. Choose a larger sheet or turn export branding off.')
  return logo.svg.replace(/<svg\b[^>]*>/, (root) =>
    root
      .replace(/\s(?:x|y|width|height|viewBox|preserveAspectRatio)\s*=\s*(["'])[^"']*\1/g, '')
      .replace(
        />$/,
        ` data-brand-logo x="${x + actual * space}" y="${y + actual * space}" width="${actual}" height="${actual / ratio}" viewBox="${logo.viewBox.join(' ')}" preserveAspectRatio="xMidYMid meet">`,
      ),
  )
}

/** Snapshot the chosen brand in each downloaded HTML file; later preference changes cannot restyle it. */
export function brandedHtml(html: string, selected?: ExportBrand) {
  if (!selected) return html
  if (html.includes('id="pgmaps-export-brand"')) return html
  const { brand, typography } = selected,
    p = brand.profile
  const css = `${typography ? fontCss(brand) : ''}\n:root{${Object.entries(brandVariables(brand, typography))
    .map(([k, v]) => `${k}:${v}`)
    .join(
      ';',
    )}}body{color:${p.colours.ink};background:${p.colours.paper};${typography ? `font-family:${fontFamily(p.typography.body)};font-weight:${p.typography.body.weight};font-style:${p.typography.body.style}` : ''}}h1,h2,h3{${typography ? `font-family:${fontFamily(p.typography.heading)};font-weight:${p.typography.heading.weight};font-style:${p.typography.heading.style}` : ''}}.eyebrow{color:${p.colours.primary}}[data-brand-notice]{font-size:11px;color:${p.colours.muted}}`
  const snapshot = JSON.stringify(selected).replace(/</g, '\\u003c')
  const sheets = html.includes('<section class="sheet">')
  return html
    .replace(
      /(<meta[^>]+http-equiv="Content-Security-Policy"[^>]+content=")([^"]*)"/,
      (_match, prefix, csp: string) =>
        prefix +
        csp +
        (csp.includes('font-src') ? '' : '; font-src data:') +
        (csp.includes('img-src') ? '' : '; img-src data:') +
        '"',
    )
    .replace(
      '</head>',
      `<style id="pgmaps-export-brand">${css}</style><script id="pgmaps-brand-snapshot" type="application/json">${snapshot}</script></head>`,
    )
    .replace('<body>', '<body>' + (sheets ? '' : brandHeader(brand)))
    .replace(/(<(?:div|p)[^>]*class="eyebrow"[^>]*>)DDC Access/g, (_match, prefix) => prefix + escapeHtml(p.name))
    .replace(
      /(<text\b[^>]*data-brand-name[^>]*>)DDC Access(<\/text>)/g,
      (_match, prefix, suffix) => prefix + escapeHtml(p.name) + suffix,
    )
    .replace(
      '</body>',
      `${sheets ? '' : `<footer data-brand-notice>${escapeHtml(p.provenance.status)}</footer>`}<!-- ${brand.notices.map((n) => n.replace(/--/g, '—')).join('\n')} --></body>`,
    )
}
