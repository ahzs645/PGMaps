/**
 * What Save & export shows for the project file: what it will reopen, counted from the project as it
 * stands. The file itself is JSON for the designer to read back, so its text is never shown, and the
 * project is not serialized for the preview: on a large terrain that took seconds on every change.
 * DOM-free.
 */
import type { RoadProject } from './types'
import { screenColour } from '@/lib/screenPage'

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const STYLE = `<style>
body{font:13px/1.45 system-ui,sans-serif;margin:16px;color:${screenColour('fg')};background:${screenColour('bg')}}
h2{font-size:15px;margin:0 0 4px}p{margin:0 0 10px}.muted{color:${screenColour('muted')}}
table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:5px 8px;border-top:1px solid ${screenColour('line')}}
th{font-weight:600;white-space:nowrap;width:1%}td{font-variant-numeric:tabular-nums}
</style>`

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-CA')} ${n === 1 ? one : many}`

/** One row a part the project holds; a part it does not hold is left out. */
export function projectFileRows(project: RoadProject): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = []
  const roads = project.alignments.filter((road) => road.id !== project.designPlaceholderId)
  rows.push({
    label: 'Roads',
    value: roads.length ? `${count(roads.length, 'road')}: ${roads.map((road) => road.name).join(', ')}` : 'None yet',
  })
  const terrain = project.terrain
  const grid = terrain.raster
  rows.push({
    label: 'Terrain',
    value: [
      terrain.name,
      Number.isFinite(terrain.resolutionM) && terrain.resolutionM > 0 ? `${terrain.resolutionM} m cells` : '',
      grid
        ? `grid of ${grid.width.toLocaleString('en-CA')} × ${grid.height.toLocaleString('en-CA')} cells stored in the file`
        : 'source and settings only',
    ]
      .filter(Boolean)
      .join(' · '),
  })
  const optional: [string, number, string, string?][] = [
    ['Reference surfaces', terrain.referenceSurfaces?.length ?? 0, 'surface'],
    ['Map context', project.context.length, 'feature'],
    ['Reference layers', project.reference?.length ?? 0, 'feature'],
    ['Map notes', project.notes?.length ?? 0, 'note'],
    ['D-lines', project.cables.length, 'line'],
    ['Field profiles', project.profiles?.length ?? 0, 'profile'],
    ['Survey books', project.surveyBooks?.length ?? 0, 'book'],
    ['Design vehicles', project.vehicleLibrary?.length ?? 0, 'vehicle'],
    ['Rate build-ups', project.rateBuildUps?.length ?? 0, 'build-up'],
  ]
  for (const [label, n, one, many] of optional) if (n > 0) rows.push({ label, value: count(n, one, many) })
  return rows
}

export function projectFilePreviewHtml(project: RoadProject, fileName: string): string {
  const rows = projectFileRows(project)
    .map((row) => `<tr><th>${escape(row.label)}</th><td>${escape(row.value)}</td></tr>`)
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8">${STYLE}</head><body>
<h2>${escape(fileName)}</h2>
<p class="muted">Everything needed to reopen this design in the road designer with Open. The file is written when you save it.</p>
<table><tbody>${rows}</tbody></table>
</body></html>`
}
