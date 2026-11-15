/**
 * A QGIS project (`.qgz`: a zip holding the `.qgs`) that opens the exported data styled: each layer
 * reads `./data/<id>.shp` through OGR with a path relative to the project, in EPSG:4326, with its
 * renderer and labels embedded; the layer tree lists the document's layers top first (QGIS draws
 * the top of the tree last); the project CRS is BC Albers for data in BC (see `projectCrs.ts`); and
 * any layouts become print layouts. `qgisLayoutTemplate` writes one layout as a `.qpt` template.
 * No DOM or network access.
 */
import { zipSync, strToU8 } from 'fflate'
import type { ExchangeDiagnostic, LayoutDocument, StyleDocument, WriteResult } from '../model'
import { documentProblems, safeFileStem } from '../model'
import { el, num, textEl, writeXml, XML_DECLARATION, type XmlNodeSpec } from '../xml'
import { layoutXml } from './layoutXml'
import { projectCrsFor, projectExtent, spatialRefSys, type ProjectCrsId } from './projectCrs'
import { layerStyleNodes } from './qml'
import { QGIS_WRITER_VERSION } from './qgisXml'

const GEOMETRY = { point: 'Point', line: 'Line', polygon: 'Polygon' } as const

export interface QgisProjectOptions {
  layouts?: LayoutDocument[]
  /** Where each layer's data sits relative to the project; `./data/<id>.shp` by default. */
  dataPath?: (layerId: string) => string
}

const extentNode = (name: string, box: [number, number, number, number], children: XmlNodeSpec[] = []) =>
  el(name, { xmin: num(box[0], 3), ymin: num(box[1], 3), xmax: num(box[2], 3), ymax: num(box[3], 3) }, ...children)

/** The `.qgs` XML of the document. */
export function qgisProjectXml(
  doc: StyleDocument,
  options: QgisProjectOptions = {},
): { xml: string; crs: ProjectCrsId } {
  const crs = projectCrsFor(doc.extent)
  const dataPath = options.dataPath ?? ((id: string) => `./data/${id}.shp`)
  const box = doc.extent ? projectExtent(crs, doc.extent) : null
  const treeOrder = [...doc.layers].reverse()
  const tree = el(
    'layer-tree-group',
    undefined,
    el('customproperties'),
    ...treeOrder.map((layer) =>
      el('layer-tree-layer', {
        id: layer.id,
        name: layer.name,
        source: dataPath(layer.id),
        providerKey: 'ogr',
        checked: layer.hidden ? 'Qt::Unchecked' : 'Qt::Checked',
        expanded: 1,
      }),
    ),
    el('custom-order', { enabled: 0 }, ...doc.layers.map((layer) => textEl('item', layer.id))),
  )
  const mapLayers = doc.layers.map((layer) =>
    el(
      'maplayer',
      {
        type: 'vector',
        geometry: GEOMETRY[layer.geometry],
        labelsEnabled: layer.label ? 1 : 0,
        hasScaleBasedVisibilityFlag: 0,
        minScale: 100000000,
        maxScale: 0,
        styleCategories: 'AllStyleCategories',
      },
      textEl('id', layer.id),
      textEl('datasource', dataPath(layer.id)),
      textEl('layername', layer.name),
      el('srs', undefined, spatialRefSys('EPSG:4326')),
      textEl('provider', 'ogr', { encoding: 'UTF-8' }),
      ...layerStyleNodes(layer),
    ),
  )
  const root = el(
    'qgis',
    { projectname: doc.name, version: QGIS_WRITER_VERSION },
    el('homePath', { path: '' }),
    textEl('title', doc.name),
    el('projectCrs', undefined, spatialRefSys(crs)),
    tree,
    box &&
      el(
        'mapcanvas',
        { name: 'theMapCanvas', annotationsVisible: 1 },
        textEl('units', 'meters'),
        el(
          'extent',
          undefined,
          textEl('xmin', num(box[0], 3)),
          textEl('ymin', num(box[1], 3)),
          textEl('xmax', num(box[2], 3)),
          textEl('ymax', num(box[3], 3)),
        ),
        textEl('rotation', 0),
        el('destinationsrs', undefined, spatialRefSys(crs)),
      ),
    el('projectlayers', undefined, ...mapLayers),
    el('layerorder', undefined, ...doc.layers.map((layer) => el('layer', { id: layer.id }))),
    el(
      'properties',
      undefined,
      el('Paths', undefined, textEl('Absolute', 'false', { type: 'bool' })),
      // Without this, QGIS opens the project with no CRS ("projections off").
      el('SpatialRefSys', undefined, textEl('ProjectionsEnabled', 1, { type: 'int' })),
      el(
        'Measurement',
        undefined,
        textEl('DistanceUnits', 'meters', { type: 'QString' }),
        textEl('AreaUnits', 'm2', { type: 'QString' }),
      ),
    ),
    box &&
      el(
        'ProjectViewSettings',
        { UseProjectScales: 0, rotation: 0 },
        extentNode('DefaultViewExtent', box, [spatialRefSys(crs)]),
      ),
    options.layouts?.length
      ? el('Layouts', undefined, ...options.layouts.map((layout) => layoutXml(layout, crs, doc.extent)))
      : null,
  )
  return {
    xml: `${XML_DECLARATION}\n<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>\n${writeXml(root)}\n`,
    crs,
  }
}

/** The project as `<name>.qgz`, a zip holding the `.qgs`. */
export function qgisProject(doc: StyleDocument, options: QgisProjectOptions = {}): WriteResult {
  const diagnostics: ExchangeDiagnostic[] = documentProblems(doc).map((message) => ({
    severity: 'error',
    format: 'qgs',
    message,
  }))
  const stem = safeFileStem(doc.name)
  const { xml, crs } = qgisProjectXml(doc, options)
  diagnostics.push({
    severity: 'info',
    format: 'qgs',
    message: `The project is drawn in ${crs === 'EPSG:3005' ? 'NAD83 / BC Albers (EPSG:3005)' : 'Web Mercator (EPSG:3857)'}; the data stays in longitude and latitude (EPSG:4326).`,
  })
  if (!doc.extent)
    diagnostics.push({
      severity: 'info',
      format: 'qgs',
      message: 'The document has no extent, so QGIS opens at its default view.',
    })
  // A fixed date keeps the zip byte-identical for the same project.
  const zip = zipSync({ [`${stem}.qgs`]: [strToU8(xml), { mtime: new Date('2026-01-01T00:00:00Z') }] }, { level: 6 })
  return { files: [{ path: `${stem}.qgz`, content: zip, mime: 'application/zip' }], diagnostics }
}

/** One layout as a QGIS print-layout template (`<name>.qpt`), its map in the document's project CRS. */
export function qgisLayoutTemplate(layout: LayoutDocument, doc: StyleDocument): WriteResult {
  const crs = projectCrsFor(layout.extent ?? doc.extent)
  const diagnostics: ExchangeDiagnostic[] = []
  if (!layout.extent && !doc.extent)
    diagnostics.push({
      severity: 'warning',
      format: 'qpt',
      subject: layout.name,
      message: 'No extent was given, so the map frame shows all of BC.',
    })
  return {
    files: [
      {
        path: `${safeFileStem(layout.name)}.qpt`,
        content: `${writeXml(layoutXml(layout, crs, doc.extent))}\n`,
        mime: 'application/xml',
      },
    ],
    diagnostics,
  }
}
