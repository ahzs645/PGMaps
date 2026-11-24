/**
 * The name and type of every Save & export file, read by its Download and by **Save as…**, which
 * has to offer the name in the browser's save dialog before the file is built (the dialog needs the
 * click; `src/lib/saveFile.ts`). One table, so the two never offer different names. No DOM or
 * network access.
 */
import { seriesContainer, type SheetOutputSettings } from '@/lib/forestry/blockSheet/sheetSeries'
import type { ModelFormat } from '@/lib/model3d/model'
import { SHEET_FORMAT_INFO, withSheetExtension, type SheetFormat } from '@/lib/mapSheet/sheetFormats'
import { documentTitle, titleFileStem } from '@/lib/documentTitle'
import { EXPORT_ITEMS, STAMPED_EXPORTS, type RoadExport } from './exportCatalog'

export interface ExportFileType {
  /** The file name, extension included. */
  name: string
  /** The download's media type (with its charset for text). */
  mime: string
  /** The extension the save dialog filters on. */
  extension: string
}

export interface DesignModelFormat {
  value: ModelFormat
  /** The choice as Save & export shows it. */
  label: string
  /** The extension of the file saved: OBJ is saved zipped with its `.mtl`. */
  extension: string
  /** The saved file's media type; glTF and STL as `MODEL_FORMATS` (`writeModel.ts`) gives them. */
  mime: string
}

/** The 3D surface model's formats. Here, not beside the writers, so the page names a file without loading them. */
export const DESIGN_MODEL_FORMATS: readonly DesignModelFormat[] = [
  { value: 'glb', label: 'glTF (.glb)', extension: '.glb', mime: 'model/gltf-binary' },
  { value: 'obj', label: 'OBJ + MTL (.zip)', extension: '.zip', mime: 'application/zip' },
  { value: 'stl', label: 'STL (.stl)', extension: '.stl', mime: 'model/stl' },
]

export const designModelFormat = (format: ModelFormat) =>
  DESIGN_MODEL_FORMATS.find((entry) => entry.value === format) ?? DESIGN_MODEL_FORMATS[0]

/** The saved file's name: `<project>-design-surfaces.glb`, `.zip` for OBJ, `.stl`. */
export const designModelFileName = (basename: string, format: ModelFormat) =>
  `${basename}-design-surfaces${designModelFormat(format).extension}`

/** What a file's name depends on beyond the project: the block sheet's layout and output, the D-line, the model format. */
export interface ExportFileVariant {
  blockSheetKind?: string
  /** What the block sheet writes (`blockSheetWrites`); one PDF when absent. */
  blockSheet?: BlockSheetWrites
  dLineName?: string
  modelFormat?: ModelFormat
}

/** What the Block map sheet export writes: one sheet in its format, or a series as one PDF or a ZIP. */
export interface BlockSheetWrites {
  series: boolean
  file: SheetFormat | 'zip'
}

/**
 * What the block sheet's output settings write for a project with `blockCount` blocks. With fewer
 * than two blocks there is no series (the form offers none), so the setting is read as off.
 */
export function blockSheetWrites(
  output: Pick<SheetOutputSettings, 'format' | 'series' | 'bundle'>,
  blockCount: number,
): BlockSheetWrites {
  const series = output.series && blockCount > 1
  return { series, file: series ? seriesContainer(output) : output.format }
}

/**
 * The printed documents, the outputs that print the issue stamp: they carry the project's document title (`issue.title`, `src/lib/documentTitle.ts`) and are
 * named from it. Every other output holds the project's own data (a design, a surface, GIS layers, the project file) and
 * keeps the project's name, which a program reading it back takes as the project's.
 */
export const PRINTED_DOCUMENT_EXPORTS: ReadonlySet<RoadExport> = new Set(STAMPED_EXPORTS)

/** The name an output carries: the document title for a printed document, else the project's name. */
export const exportName = (kind: RoadExport, project: { name: string; issue?: { title?: string } }) =>
  PRINTED_DOCUMENT_EXPORTS.has(kind) ? documentTitle(project.issue?.title, project.name) : project.name

/** The stem every file is named from: the project name or, for a printed document, its title (`exportName`), non-alphanumerics to `-`, at most 70 characters. */
export const exportBasename = (projectName: string) => titleFileStem(projectName, 'forest-road')

/** A D-line sheet's name part: the line's name, non-alphanumerics to `-`, at most 40 characters. */
const dLineSlug = (name: string | undefined) =>
  ((name ?? 'd-line').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'd-line').slice(0, 40)

const CSV = 'text/csv;charset=utf-8',
  HTML = 'text/html;charset=utf-8',
  GEOJSON = 'application/geo+json',
  XML = 'application/xml',
  ZIP = 'application/zip',
  PDF = 'application/pdf',
  TEXT = 'text/plain'

const file = (name: string, mime: string): ExportFileType => ({
  name,
  mime,
  extension: name.slice(name.lastIndexOf('.')),
})

/** Every output's file name and type. */
export function exportFileType(
  kind: RoadExport,
  basename: string,
  variant: ExportFileVariant = {},
  /** The project's own name: the RoadEng project zip is named from it, as RoadEng names its own. */
  projectName = basename,
): ExportFileType {
  const b = basename
  switch (kind) {
    case 'project':
      return { name: `${b}.road.json`, mime: 'application/json', extension: '.json' }
    case 'notes':
      return file(`${b}-notes.geojson`, GEOJSON)
    case 'streams-csv':
      return file(`${b}-streams.csv`, CSV)
    case 'culvert-schedule-csv':
      return file(`${b}-culverts.csv`, CSV)
    case 'provincial-evidence':
      return file(`${b}-provincial-stream-evidence.geojson`, GEOJSON)
    case 'geojson':
      return file(`${b}.geojson`, GEOJSON)
    case 'plotbook':
      return file(`${b}-plot-book.html`, HTML)
    case 'shapefile':
      return file(`${b}-shapefiles.zip`, ZIP)
    case 'geopackage':
      return file(`${b}.gpkg`, 'application/geopackage+sqlite3')
    case 'kmz':
      return file(`${b}.kmz`, 'application/vnd.google-earth.kmz')
    case 'design-model': {
      const format = variant.modelFormat ?? 'glb'
      return {
        name: designModelFileName(b, format),
        mime: designModelFormat(format).mime,
        extension: designModelFormat(format).extension,
      }
    }
    case 'qgis-project':
    case 'arcgis-pro':
    case 'web-map-style':
    case 'symbol-library':
      return file(`${b}-${kind}.zip`, ZIP)
    case 'dxf':
      return file(`${b}.dxf`, 'application/dxf')
    case 'roadeng':
      return file(`${b}.dsnx`, 'application/octet-stream')
    case 'roadeng-project':
      return file(`${projectName.trim() || 'PG Maps road'}.zip`, ZIP)
    case 'mass-haul-csv':
      return file(`${b}-mass-haul.csv`, CSV)
    case 'optimal-haul-csv':
      return file(`${b}-optimal-haul.csv`, CSV)
    case 'optimal-areas-csv':
      return file(`${b}-optimal-areas.csv`, CSV)
    case 'optimal-inputs':
      return file(`${b}-optimal-inputs.zip`, ZIP)
    case 'softree-location-ascii':
      return file(`${b}-location.txt`, TEXT)
    case 'softree-terrain-ascii':
      return file(`${b}-terrain.txt`, TEXT)
    case 'landxml':
      return file(`${b}.xml`, XML)
    case 'stakeout':
      return file(`${b}-stakeout.csv`, CSV)
    case 'subgrade-landxml':
      return file(`${b}-subgrade-surface.xml`, XML)
    case 'finished-surface-landxml':
      return file(`${b}-finished-surface.xml`, XML)
    case 'terrain-landxml':
      return file(`${b}-terrain.xml`, XML)
    case 'terrain-ascii':
      return file(`${b}-terrain.asc`, TEXT)
    case 'csv':
      return file(`${b}-stations.csv`, CSV)
    case 'report':
      return file(`${b}-report.html`, HTML)
    case 'report-pdf':
      return file(`${b}-report.pdf`, PDF)
    case 'plotbook-pdf':
      return file(`${b}-plot-book.pdf`, PDF)
    case 'estimate-pdf':
      return file(`${b}-preliminary-estimate.pdf`, PDF)
    case 'map-pdf':
      return file(`${b}-map.pdf`, PDF)
    case 'block-sheet-pdf': {
      // `<project>-<sheet>.pdf` as always; `.svg`/`.png` for one sheet, `-series.pdf`/`.zip` for a series.
      const writes = variant.blockSheet ?? { series: false, file: 'pdf' }
      const stem = `${b}-${variant.blockSheetKind ?? 'block-sheet'}${writes.series ? '-series' : ''}`
      return file(
        withSheetExtension(stem, writes.file),
        writes.file === 'zip' ? ZIP : SHEET_FORMAT_INFO[writes.file].mime,
      )
    }
    case 'dline-sheet-pdf':
      return file(`${b}-${dLineSlug(variant.dLineName)}-sheet.pdf`, PDF)
    case 'report-package':
      // One PDF, or a zip when parts go in appendix files: known once the package is planned.
      return file(`${b}-report-package.pdf`, PDF)
  }
}

/**
 * Outputs offered on Download only, with why: Save as must name the file before it is built, and
 * these cannot be built apart from their download without restructuring.
 */
export const DOWNLOAD_ONLY_EXPORTS: Partial<Record<RoadExport, string>> = {
  'report-package': 'It is one PDF or a zip of several, which is known only once its parts are planned.',
}

export const saveAsOffered = (kind: RoadExport) => !(kind in DOWNLOAD_ONLY_EXPORTS)

/** The save dialog's file type: the media type without parameters, which the dialog refuses. */
export function saveAsFileType(kind: RoadExport, type: ExportFileType) {
  return {
    mime: type.mime.split(';')[0].trim(),
    extension: type.extension,
    description: EXPORT_ITEMS.find((item) => item.kind === kind)?.label ?? 'Export',
  }
}

/** A download's notice reworded for a file saved where the person chose. */
export function savedNotice(notice: string, outcome: 'saved' | 'downloaded', fileName: string): string {
  if (outcome === 'downloaded') return notice
  return /\bdownloaded\b/.test(notice)
    ? notice.replace(/\bdownloaded\b/, `saved as ${fileName}`)
    : `Saved as ${fileName}. ${notice}`
}
