/**
 * A style document as an ArcGIS Pro map file (`.mapx`, a `CIMMapDocument`): one `CIMMap` whose
 * layers are the document's layers, each reading `<dataFolder>/<id>.shp` by a relative path, in BC
 * Albers when the extent lies in British Columbia and Web Mercator otherwise, opening on the
 * document's extent. The map definition is shared with the layout writer. Names follow the CIM
 * specification (github.com/Esri/cim-spec, v3); the shape follows maps Pro 3.6 wrote.
 * No DOM or network access.
 */
import { safeFileStem, type StyleDocument, type WriteResult } from '../model'
import { CIM_BUILD, CIM_VERSION, cimColor, trim, type Json } from './cimCommon'
import {
  assertWritable,
  featureLayerDefinition,
  LAYER_FILE_MIME,
  type LayerContext,
  type LayerFileOptions,
} from './lyrx'
import { defaultWkid, projectBox, spatialReference, type MapWkid } from './projection'

export interface MapFileOptions extends LayerFileOptions {
  /** Map coordinate system; BC Albers for an extent inside BC, else Web Mercator. */
  wkid?: MapWkid
}

/** The map's CIM path key, from the document name. */
export const mapKey = (doc: StyleDocument) => safeFileStem(doc.name).toLowerCase() || 'map'

/** The map definition and its layer definitions, layers listed top first as Pro lists them. */
export function mapDefinitions(
  doc: StyleDocument,
  ctx: LayerContext,
  options: MapFileOptions = {},
): { map: Json; layers: Json[]; uri: string; wkid: MapWkid } {
  const key = mapKey(doc)
  const uri = `CIMPATH=${key}/${key}.json`
  const wkid = options.wkid ?? defaultWkid(doc.extent)
  const reference = spatialReference(wkid)
  const layers = doc.layers.map((layer) =>
    featureLayerDefinition(layer, `CIMPATH=${key}/${layer.id.toLowerCase()}.json`, ctx, options),
  )
  let extent: Json | undefined
  if (doc.extent) {
    const [x0, y0, x1, y1] = projectBox(wkid, doc.extent)
    const padX = (x1 - x0) * 0.05,
      padY = (y1 - y0) * 0.05
    extent = {
      xmin: trim(x0 - padX, 3),
      ymin: trim(y0 - padY, 3),
      xmax: trim(x1 + padX, 3),
      ymax: trim(y1 + padY, 3),
      spatialReference: reference,
    }
  }
  const map: Json = {
    type: 'CIMMap',
    name: doc.name,
    uRI: uri,
    sourceModifiedTime: { type: 'TimeInstant' },
    useSourceMetadata: true,
    // Pro lists layers top first; the document draws bottom first.
    layers: layers.map((layer) => layer.uRI).reverse(),
    defaultViewingMode: 'Map',
    mapType: 'Map',
    ...(extent ? { defaultExtent: extent } : {}),
    generalPlacementProperties: {
      type: 'CIMMaplexGeneralPlacementProperties',
      invertedLabelTolerance: 2,
      unplacedLabelColor: cimColor('#ff0000'),
      keyNumberGroups: [
        {
          type: 'CIMMaplexKeyNumberGroup',
          delimiterCharacter: '.',
          horizontalAlignment: 'Left',
          maximumNumberOfLines: 20,
          minimumNumberOfLines: 2,
          name: 'Default',
          numberResetType: 'None',
          keyNumberMethod: 'PreventUnplacedLabels',
        },
      ],
      placementQuality: 'High',
    },
    spatialReference: reference,
    colorModel: 'RGB',
    scaleDisplayFormat: 'Value',
    clippingMode: 'None',
    nearPlaneClipDistanceMode: 'Automatic',
    rGBColorProfile: 'sRGB IEC61966-2.1',
    cMYKColorProfile: 'U.S. Web Coated (SWOP) v2',
  }
  return { map, layers, uri, wkid }
}

/** `<name>.mapx`: the document as one Pro map. */
export function arcgisMapx(doc: StyleDocument, options: MapFileOptions = {}): WriteResult {
  assertWritable(doc)
  const ctx: LayerContext = { diagnostics: [], format: 'mapx' }
  const { map, layers } = mapDefinitions(doc, ctx, options)
  const cimDocument = {
    type: 'CIMMapDocument',
    version: CIM_VERSION,
    build: CIM_BUILD,
    mapDefinition: map,
    layerDefinitions: layers,
  }
  return {
    files: [
      { path: `${safeFileStem(doc.name)}.mapx`, content: JSON.stringify(cimDocument, null, 2), mime: LAYER_FILE_MIME },
    ],
    diagnostics: ctx.diagnostics,
  }
}
