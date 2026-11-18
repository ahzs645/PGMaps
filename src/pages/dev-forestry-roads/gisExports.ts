/**
 * The GeoPackage and KMZ exports: the layers the QGIS project carries (`roadShapefileLayers` and
 * `contextShapefileLayers`, so no format has a feature builder of its own), styled from the style
 * document `exportStyles.ts` builds, written by the shared GIS writers (`src/lib/gis`).
 *
 * - **GeoPackage:** one table per layer, each with its QGIS style (`.qml`) as the layer's default in
 *   `layer_styles`, and its SLD beside it, so it opens in QGIS looking as it does here.
 * - **KMZ:** one folder per layer and symbol, because a KML folder carries one style: the roads split
 *   by road (each its own colour) and the context by sheet symbol (streams, roads, constraints…).
 *   Each placemark is named (the road, the station label in the road's own stationing, the culvert)
 *   and keeps its attributes. The symbols are reduced to what KML draws (`kmlStyleForSymbol`), and
 *   every loss is reported.
 *
 * Both add a `STATION` column, the station label in the active road's own stationing, to the
 * stations and culverts: `STATION_M` is chainage. No DOM or network access; sql.js and the PNG
 * encoder are passed in.
 */
import type { SqlJsStatic } from 'sql.js'
import { writeGeoPackage, type GeoPackageLayerStyle } from '@/lib/gis/geoPackage'
import type { KmlLayerStyle } from '@/lib/gis/kml'
import { writeKmz } from '@/lib/gis/kmz'
import {
  featurePositions,
  gisLayerFromShapeLayer,
  type GisFeature,
  type GisLayer,
  type GisLineFeature,
  type GisPointFeature,
  type GisPolygonFeature,
} from '@/lib/gis/layers'
import { kmlDotIconRgba, kmlStyleForSymbol, KML_ICON_PX } from '@/lib/styleExchange/kml/kmlStyle'
import { ruleFor, type ExchangeDiagnostic, type StyleDocument } from '@/lib/styleExchange/model'
import { qgisLayerStyles } from '@/lib/styleExchange/qgis/qml'
import { sldLayerStyles } from '@/lib/styleExchange/web/sld'
import { roadShapefileLayers } from './designExports'
import type { ExportPreview, GeometryLayer } from './exportCatalog'
import {
  contextShapefileLayers,
  exportedRoadStyles,
  roadExportStyleDocument,
  type StyleOverrides,
} from './exportStyles'
import { refuseInvalidResults } from './inputErrors'
import { formatStationLabel } from './roadStationing'
import type { ShapeLayer } from './shapefile'
import type { Alignment, ContextFeature, RoadAnalysis } from './types'

export interface RoadGisInput {
  /** The project's name: the KML document's name. */
  name: string
  /** The roads written (`exportRoads`), in project order. */
  roads: readonly Alignment[]
  analyses: ReadonlyMap<string, RoadAnalysis>
  /** The road on screen: its stations and culverts are the ones written. */
  activeId: string
  context: readonly ContextFeature[]
  /** Symbols from this browser's style library that replace PGMaps' own. */
  overrides?: StyleOverrides
}

export interface RoadGisLayers {
  /** The shapefile layers, as the QGIS project writes them. */
  shapeLayers: ShapeLayer[]
  /** The same layers for the GIS writers, titled, with `STATION` labels added. */
  layers: GisLayer[]
  document: StyleDocument
}

/** The column holding a station label in the road's own stationing. */
export const STATION_LABEL_FIELD = 'STATION'

function withStationLabels(layer: GisLayer, labels: readonly string[]): GisLayer {
  if (labels.length !== layer.features.length)
    throw Error(`${layer.name}: ${labels.length} station labels for ${layer.features.length} features.`)
  const fields = [{ name: STATION_LABEL_FIELD, type: 'text' as const, title: 'Station', width: 24 }, ...layer.fields]
  const label = (feature: GisFeature, index: number) => ({
    ...feature,
    attributes: { [STATION_LABEL_FIELD]: labels[index], ...feature.attributes },
  })
  if (layer.geometry === 'point')
    return { ...layer, fields, features: layer.features.map((f, i) => label(f, i) as GisPointFeature) }
  if (layer.geometry === 'line')
    return { ...layer, fields, features: layer.features.map((f, i) => label(f, i) as GisLineFeature) }
  return { ...layer, fields, features: layer.features.map((f, i) => label(f, i) as GisPolygonFeature) }
}

/**
 * The layers both files write: the context, then the roads, as the QGIS project orders them. Refuses
 * when any road written, or the road on screen whose stations go in, leaves out an invalid input;
 * `label` names the file in the refusal.
 */
export function roadGisLayers(input: RoadGisInput, label = 'GIS file'): RoadGisLayers {
  const roads = [...input.roads]
  const analyses = input.analyses as Map<string, RoadAnalysis>
  refuseInvalidResults(label, ...roads.map((road) => analyses.get(road.id)), analyses.get(input.activeId))
  const shapeLayers = [
    ...contextShapefileLayers(input.context),
    ...roadShapefileLayers(roads, analyses, input.activeId),
  ]
  const document = roadExportStyleDocument(
    input.name,
    shapeLayers,
    exportedRoadStyles({ alignments: roads }),
    input.overrides ?? {},
  )
  const active = roads.find((road) => road.id === input.activeId)
  const analysis = analyses.get(input.activeId)
  // The road's own stationing names its stations, whatever the screen shows.
  const stationLabel = (chainage: number) => formatStationLabel(chainage, active?.stationing)
  const layers = shapeLayers.map((shape) => {
    const layer: GisLayer = {
      ...gisLayerFromShapeLayer(shape),
      title: document.layers.find((styled) => styled.id === shape.name)?.name ?? shape.name,
    }
    if (shape.name === 'road_stations')
      return withStationLabels(
        layer,
        (analysis?.stations ?? []).map((station) => stationLabel(station.chainage)),
      )
    if (shape.name === 'road_culverts')
      return withStationLabels(
        layer,
        (analysis?.engineering?.culverts ?? []).map((culvert) => stationLabel(culvert.chainage)),
      )
    return layer
  })
  return { shapeLayers, layers, document }
}

export interface RoadGisFile {
  bytes: Uint8Array
  /** What a value, name or geometry could not be written as given. */
  warnings: string[]
  /** What each style could not carry exactly. */
  diagnostics: ExchangeDiagnostic[]
  /** The layers as written: for the KMZ, one per folder. */
  layers: GisLayer[]
  /** Each written layer's colour, for the preview. */
  colours: Record<string, string>
  /** The style library's symbols used in place of PGMaps' own, by label. */
  replaced: string[]
}

/** A layer's colour for the preview: its first rule's main colour. */
function previewColour(document: StyleDocument, layerId: string): string | undefined {
  const symbol = document.layers.find((layer) => layer.id === layerId)?.rules[0]?.symbol
  if (!symbol) return undefined
  if (symbol.kind === 'line') return [...symbol.layers].sort((a, b) => b.width - a.width)[0]?.color
  if (symbol.kind === 'area') return symbol.fill ?? symbol.hatches?.[0]?.stroke.color ?? symbol.outline[0]?.color
  return symbol.color
}

const replacedLabels = (overrides: StyleOverrides | undefined) =>
  Object.values(overrides ?? {}).map((symbol) => symbol.label)

/**
 * The GeoPackage: every layer in EPSG:4326, each with its `.qml` as QGIS's default style and its
 * `.sld` beside it in `layer_styles`.
 */
export function roadGeoPackage(
  SQL: SqlJsStatic,
  input: RoadGisInput,
  options: { lastChange?: Date } = {},
): RoadGisFile {
  const { layers, document } = roadGisLayers(input, 'GeoPackage')
  const qml = qgisLayerStyles(document)
  const sld = sldLayerStyles(document)
  const styles: Record<string, GeoPackageLayerStyle> = {}
  for (const layer of document.layers) {
    const qmlFile = qml.files.find((file) => file.path === `${layer.id}.qml`)
    const sldFile = sld.files.find((file) => file.path === `${layer.id}.sld`)
    styles[layer.id] = {
      ...(qmlFile ? { qml: String(qmlFile.content) } : {}),
      ...(sldFile ? { sld: String(sldFile.content) } : {}),
      styleName: layer.name,
      description: 'PGMaps forest road design: the plan’s symbols',
    }
  }
  const written = writeGeoPackage(SQL, layers, { styles, lastChange: options.lastChange })
  return {
    bytes: written.bytes,
    warnings: written.warnings,
    diagnostics: [...qml.diagnostics, ...sld.diagnostics],
    layers,
    colours: Object.fromEntries(
      layers.flatMap((layer) => {
        const colour = previewColour(document, layer.name)
        return colour ? [[layer.name, colour]] : []
      }),
    ),
    replaced: replacedLabels(input.overrides),
  }
}

/** The icon every KMZ point is drawn with, a path inside the archive. */
export const KMZ_DOT_ICON = 'icons/dot.png'

/** The PNG of {@link KMZ_DOT_ICON}. */
export function kmzDotIcon(encodePng: (rgba: Uint8ClampedArray, width: number, height: number) => Promise<Uint8Array>) {
  return encodePng(kmlDotIconRgba(KML_ICON_PX), KML_ICON_PX, KML_ICON_PX)
}

/** The field each KML layer's placemarks are named from: the road, the station label, the culvert. */
const KML_NAME_FIELD: Record<string, string> = {
  road_centrelines: 'NAME',
  road_stations: STATION_LABEL_FIELD,
  road_culverts: 'NAME',
  context_lines: 'NAME',
  context_areas: 'NAME',
}

/**
 * Splits each layer by the rule that draws each feature (`ruleFor`), one KML layer per rule used,
 * so every folder carries one style. A layer drawn by one rule keeps its name and title.
 */
function splitByRule(layers: readonly GisLayer[], document: StyleDocument) {
  const split: { layer: GisLayer; source: string; rule: StyleDocument['layers'][number]['rules'][number] }[] = []
  for (const layer of layers) {
    const styled = document.layers.find((entry) => entry.id === layer.name)
    if (!styled) continue
    const groups = new Map<number, GisFeature[]>()
    for (const feature of layer.features) {
      const index = styled.rules.indexOf(ruleFor(styled, feature.attributes)!)
      if (index < 0) continue
      groups.set(index, [...(groups.get(index) ?? []), feature])
    }
    const used = [...groups.keys()].sort((a, b) => a - b)
    for (const index of used) {
      const rule = styled.rules[index]
      const one = used.length === 1
      split.push({
        source: layer.name,
        rule,
        layer: {
          ...layer,
          name: one ? layer.name : `${layer.name}_${index + 1}`,
          title: one ? (layer.title ?? styled.name) : `${styled.name}: ${rule.label}`,
          features: groups.get(index)!,
        } as GisLayer,
      })
    }
  }
  return split
}

/**
 * The KMZ: a folder per layer and symbol, styled from the plan's symbols as far as KML draws them.
 * `dotIcon` is the PNG of {@link KMZ_DOT_ICON}; without it points take the client's own pin.
 */
export function roadKmz(input: RoadGisInput, options: { dotIcon?: Uint8Array; modified?: Date } = {}): RoadGisFile {
  const { layers, document } = roadGisLayers(input, 'KMZ')
  const split = splitByRule(layers, document)
  const diagnostics: ExchangeDiagnostic[] = []
  const styles: Record<string, KmlLayerStyle> = {}
  const colours: Record<string, string> = {}
  const nameField: Record<string, string> = {}
  for (const { layer, source, rule } of split) {
    const styled = kmlStyleForSymbol(rule.symbol, `${layer.title ?? layer.name}`, {
      iconHref: options.dotIcon ? KMZ_DOT_ICON : undefined,
    })
    diagnostics.push(...styled.diagnostics)
    styles[layer.name] = styled.style
    const colour = styled.style.lineColor ?? styled.style.fillColor ?? styled.style.iconColor
    if (colour) colours[layer.name] = colour
    const field = KML_NAME_FIELD[source]
    if (field && layer.fields.some((f) => f.name === field)) nameField[layer.name] = field
  }
  const kmlLayers = split.map((entry) => entry.layer)
  const replaced = replacedLabels(input.overrides)
  const written = writeKmz(kmlLayers, {
    name: input.name,
    description: [
      'Made by PGMaps forest road design: preliminary planning geometry, not a construction design.',
      'Coordinates are WGS84 longitude/latitude, draped on the ground.',
      replaced.length ? `Drawn with saved styles in place of PGMaps' own: ${replaced.join(', ')}.` : '',
      diagnostics.length
        ? `KML draws one line, fill and icon per folder, so these were simplified: ${[
            ...new Set(diagnostics.map((d) => `${d.subject}: ${d.message}`)),
          ].join(' ')}`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
    styles,
    nameField,
    files: options.dotIcon ? { [KMZ_DOT_ICON]: options.dotIcon } : {},
    modified: options.modified,
  })
  return { bytes: written.bytes, warnings: written.warnings, diagnostics, layers: kmlLayers, colours, replaced }
}

/** Which style a simplification is in, for the preview's list. */
const FORMAT_LABEL: Partial<Record<ExchangeDiagnostic['format'], string>> = {
  qml: 'QGIS style',
  sld: 'SLD',
  kml: 'KML',
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The notice after a download: what was written, what each style simplified, and every warning. */
export function roadGisNotice(label: string, file: RoadGisFile): string {
  const approximated = file.diagnostics.filter((d) => d.severity !== 'info').length
  return [
    `${label} downloaded: ${plural(file.layers.length, 'layer')}, ${plural(
      file.layers.reduce((sum, layer) => sum + layer.features.length, 0),
      'feature',
    )}.`,
    file.replaced.length ? `Drawn with your saved styles for ${file.replaced.join(', ')}.` : '',
    approximated
      ? `${plural(approximated, 'symbol part')} ${approximated === 1 ? 'is' : 'are'} simplified; the preview lists ${approximated === 1 ? 'it' : 'them'}.`
      : '',
    file.warnings.length ? `${plural(file.warnings.length, 'warning')}: ${file.warnings.join(' ')}` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/** The written layers' geometry, each in its own colour, with the warnings and simplifications below. */
export function roadGisPreview(file: RoadGisFile): ExportPreview {
  const layers: GeometryLayer[] = file.layers.map((layer) => {
    const positions = (feature: GisFeature) =>
      featurePositions(layer, feature).map((p) => [p[0], p[1]] as [number, number])
    return {
      name: layer.title ?? layer.name,
      ...(file.colours[layer.name] ? { color: file.colours[layer.name] } : {}),
      points: layer.geometry === 'point' ? layer.features.flatMap(positions) : [],
      lines:
        layer.geometry === 'line'
          ? (layer.features as GisLineFeature[]).flatMap((f) =>
              f.lines.map((line) => line.map((p) => [p[0], p[1]] as [number, number])),
            )
          : layer.geometry === 'polygon'
            ? (layer.features as GisPolygonFeature[]).flatMap((f) =>
                f.polygons.flatMap((polygon) =>
                  polygon.map((ring) => ring.map((p) => [p[0], p[1]] as [number, number])),
                ),
              )
            : [],
    }
  })
  const notes = [
    ...file.warnings,
    ...new Set(
      file.diagnostics.map(
        (d) => `${FORMAT_LABEL[d.format] ?? d.format}, ${d.subject ? `${d.subject}: ` : ''}${d.message}`,
      ),
    ),
  ]
  return { type: 'geometry', layers, ...(notes.length ? { notes } : {}) }
}
