/**
 * Batch identical-width hatch strokes for browser previews. Each subpath keeps
 * its exact coordinates and round caps. Canonical SVG exports retain one path
 * per stroke so illustration editors can select them individually.
 */
export function buildPreviewSvg(svg: string): string {
  return svg.replace(
    /(<g data-generator="contour-hatch-v3"[^>]*>)([\s\S]*?)(<\/g>)/g,
    (whole, opening: string, body: string, closing: string) => {
      const strokes = /<path d="([^"]*)" stroke-width="([^"]*)"\/>/g
      // Unknown per-stroke styles may affect compositing or ordering. Leave
      // those groups intact rather than changing their rendering semantics.
      if (body.replace(strokes, '').trim()) return whole
      const widths = new Map<string, string[]>()
      for (const match of body.matchAll(strokes)) {
        const paths = widths.get(match[2]) ?? []
        paths.push(match[1])
        widths.set(match[2], paths)
      }
      return (
        opening +
        [...widths].map(([width, paths]) => `<path d="${paths.join(' ')}" stroke-width="${width}"/>`).join('') +
        closing
      )
    },
  )
}
