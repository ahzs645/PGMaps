/**
 * A printed-sheet layout as an ArcGIS Pro layout file (`.pagx`, a `CIMLayoutDocument`): the page in
 * inches, the map frame on the template's frame rectangle showing the document's map (embedded
 * through `mapDefinitions` and `layerDefinitions`, so the frame is not empty), the title bar, each
 * panel as a white box with its #ffd37f header bar and title, a `CIMLegend` in the legend panel, a
 * `CIMScaleLine`, and a `CIMMarkerNorthArrow` drawn as a vector marker (the sheet's red needle and a
 * stroked N, never a font glyph). Elements are listed bottom first, as Pro stores them. Every element
 * PGMaps writes carries `pgmaps:*` custom properties so the reader finds the template's rectangles
 * again. Names follow the CIM specification (github.com/Esri/cim-spec, v3); the shape follows
 * layouts Pro 3.6 wrote. No DOM or network access.
 */
import { SHEET_CHROME } from '@/lib/forestry/blockSheet/styles'
import { OPERATING_PLAN_SIDE_PANEL, resolveSheet, type Rect } from '@/lib/mapSheet/layout'
import { safeFileStem, type LayoutDocument, type StyleDocument, type WriteResult } from '../model'
import { CIM_BUILD, CIM_VERSION, cimColor, diagnostic, trim, type Json } from './cimCommon'
import { symbolReference } from './cim'
import { assertWritable, cimTextSymbol, LAYER_FILE_MIME, type LayerContext } from './lyrx'
import { mapDefinitions, type MapFileOptions } from './mapx'
import { project, projectBox } from './projection'

export const PAGE_UNITS_INCHES = 109008
export const MAP_FRAME_NAME = 'Map Frame'
const POINTS_PER_INCH = 72
const METRES_PER_INCH = 0.0254

type Writer = { height: number; k: number }

const inch = (points: number) => trim(points / POINTS_PER_INCH, 5)

/** A rectangle in sheet points (y down) as a Pro ring in inches (y up), clockwise. */
function ring(w: Writer, rect: Rect): number[][] {
  const x0 = inch(rect.x),
    x1 = inch(rect.x + rect.w)
  const y0 = inch(w.height - rect.y - rect.h),
    y1 = inch(w.height - rect.y)
  return [
    [x0, y0],
    [x0, y1],
    [x1, y1],
    [x1, y0],
    [x0, y0],
  ]
}

const props = (entries: Record<string, string>) =>
  Object.entries(entries).map(([key, value]) => ({ type: 'CIMStringMap', key, value }))

const stroke = (color: string, width: number, alpha = 1): Json => ({
  type: 'CIMSolidStroke',
  enable: true,
  capStyle: 'Round',
  joinStyle: 'Miter',
  lineStyle3D: 'Strip',
  miterLimit: 10,
  width: trim(width),
  height3D: 1,
  anchor3D: 'Center',
  color: cimColor(color, alpha),
})
const fill = (color: string, alpha = 1): Json => ({ type: 'CIMSolidFill', enable: true, color: cimColor(color, alpha) })

/** The empty frame Pro gives elements: no border, no background. */
const graphicFrame = (border?: { color: string; width: number }): Json => ({
  type: 'CIMGraphicFrame',
  backgroundSymbol: symbolReference({ type: 'CIMPolygonSymbol', angleAlignment: 'Map' }),
  borderSymbol: symbolReference({
    type: 'CIMLineSymbol',
    symbolLayers: [border ? stroke(border.color, border.width) : stroke('#000000', 1, 0)],
  }),
  shadowSymbol: symbolReference({ type: 'CIMPolygonSymbol', angleAlignment: 'Map' }),
  shadowOffsetX: 10,
  shadowOffsetY: -10,
})

function box(
  w: Writer,
  name: string,
  rect: Rect,
  look: { fill?: string; stroke?: { color: string; width: number } },
  custom: Record<string, string>,
): Json {
  const layers = [look.stroke ? stroke(look.stroke.color, look.stroke.width) : stroke('#000000', 1, 0)]
  if (look.fill) layers.push(fill(look.fill))
  return {
    type: 'CIMGraphicElement',
    anchor: 'BottomLeftCorner',
    name,
    visible: true,
    customProperties: props(custom),
    rotationCenter: { x: inch(rect.x), y: inch(w.height - rect.y - rect.h) },
    graphic: {
      type: 'CIMPolygonGraphic',
      symbol: symbolReference({ type: 'CIMPolygonSymbol', symbolLayers: layers, angleAlignment: 'Map' }),
      blendingMode: 'Alpha',
      placement: 'Unspecified',
      polygon: { rings: [ring(w, rect)] },
    },
  }
}

function textElement(
  w: Writer,
  name: string,
  value: string,
  at: [number, number],
  symbol: Json,
  custom: Record<string, string>,
): Json {
  const x = inch(at[0]),
    y = inch(w.height - at[1])
  return {
    type: 'CIMGraphicElement',
    anchor: 'LeftMidPoint',
    name,
    visible: true,
    customProperties: props(custom),
    rotationCenter: { x, y },
    lockedAspectRatio: true,
    graphic: {
      type: 'CIMTextGraphic',
      symbol: symbolReference(symbol),
      blendingMode: 'Alpha',
      placement: 'Unspecified',
      text: value,
      shape: { x, y },
    },
  }
}

/** Header bar height, as the sheet composer draws it. */
const headerHeight = (layout: LayoutDocument, k: number) =>
  (layout.template.id === 'lidar-side-panel' ? 10.6 : 14.4) * k

/** The sheet's north arrow as a Pro point symbol: white-cased red needle, left half filled, and a stroked N. */
function northArrowSymbol(height: number, k: number): Json {
  const width = height * 0.32
  const red = SHEET_CHROME.northArrow
  const needle = [
    [0, height * 0.8],
    [width / 2, 0],
    [0, height * 0.18],
    [-width / 2, 0],
    [0, height * 0.8],
  ].map(([x, y]) => [trim(x, 3), trim(y, 3)])
  const half = [
    [0, height * 0.8],
    [0, height * 0.18],
    [-width / 2, 0],
    [0, height * 0.8],
  ].map(([x, y]) => [trim(x, 3), trim(y, 3)])
  const cap = Math.max(8, height * 0.2) * 0.72
  const cy = height * 0.88
  const n = [
    [-cap * 0.32, cy - cap / 2],
    [-cap * 0.32, cy + cap / 2],
    [cap * 0.32, cy - cap / 2],
    [cap * 0.32, cy + cap / 2],
  ].map(([x, y]) => [trim(x, 3), trim(y, 3)])
  const frame = { xmin: trim(-width / 2), ymin: 0, xmax: trim(width / 2), ymax: trim(height) }
  const marker = (name: string, geometry: Json, symbol: Json): Json => ({
    type: 'CIMVectorMarker',
    enable: true,
    primitiveName: name,
    anchorPointUnits: 'Relative',
    dominantSizeAxis3D: 'Y',
    size: trim(height),
    billboardMode3D: 'FaceNearPlane',
    frame,
    markerGraphics: [{ type: 'CIMMarkerGraphic', geometry, symbol }],
    scaleSymbolsProportionally: true,
    respectFrame: true,
  })
  const line = (color: string, w: number) => ({
    type: 'CIMLineSymbol',
    symbolLayers: [{ ...stroke(color, w), capStyle: 'Round', joinStyle: 'Round' }],
  })
  const area = (layers: Json[]) => ({ type: 'CIMPolygonSymbol', symbolLayers: layers, angleAlignment: 'Map' })
  // Bottom first, then reversed: CIM draws symbol layer 0 on top.
  const layers = [
    marker('pgmaps-north-casing', { rings: [needle] }, area([{ ...stroke('#ffffff', 3 * k), joinStyle: 'Round' }])),
    marker('pgmaps-north-half', { rings: [half] }, area([fill(red)])),
    marker('pgmaps-north-outline', { rings: [needle] }, area([{ ...stroke(red, 0.8 * k), joinStyle: 'Round' }])),
    marker('pgmaps-north-n-halo', { paths: [n] }, line('#ffffff', cap * 0.16 + 4 * k)),
    marker('pgmaps-north-n', { paths: [n] }, line(red, cap * 0.16)),
  ]
  return symbolReference({
    type: 'CIMPointSymbol',
    symbolLayers: layers.reverse(),
    haloSize: 1,
    scaleX: 1,
    angleAlignment: 'Display',
  })
}

function legendElement(w: Writer, rect: Rect, layers: Json[], k: number, columns = 1): Json {
  const text = (size: number) => symbolReference(cimTextSymbol(size, '#000000', { vertical: 'Center' }))
  // One legend entry; without a layer, the template Pro uses for layers added later.
  const item = (layer?: Json): Json => ({
    type: 'CIMHorizontalLegendItem',
    ...(layer ? { name: layer.name } : {}),
    layerNameSymbol: text(8 * k),
    manualColumn: -1,
    keepTogetherOption: 'Items',
    showHeading: false,
    headingSymbol: text(7 * k),
    showLabels: true,
    ...(layer ? { layer: layer.uRI } : {}),
    showDescription: false,
    labelSymbol: text(7 * k),
    descriptionSymbol: text(6 * k),
    autoVisibility: true,
    showGroupLayerName: false,
    groupLayerNameSymbol: text(8 * k),
    showLayerName: true,
    countPrefix: ' (',
    countSuffix: ')',
    isVisible: true,
    arrangement: 'PatchLabelDescription',
  })
  return {
    type: 'CIMLegend',
    anchor: 'TopLeftCorner',
    name: 'Legend',
    visible: true,
    customProperties: props({ 'pgmaps:role': 'legend' }),
    rotationCenter: { x: inch(rect.x), y: inch(w.height - rect.y) },
    lockedAspectRatio: true,
    expanded: true,
    frame: { rings: [ring(w, rect)] },
    graphicFrame: graphicFrame(),
    mapFrame: MAP_FRAME_NAME,
    autoAdd: true,
    autoFonts: true,
    autoReorder: false,
    autoVisibility: true,
    defaultPatchHeight: trim(10 * k),
    defaultPatchWidth: trim(20 * k),
    groupGap: trim(5 * k),
    headingGap: trim(3 * k),
    horizontalItemGap: trim(5 * k),
    patchGap: trim(4 * k),
    // Pro lists legend items top first, in map order.
    items: layers
      .filter((layer) => layer.visibility !== false)
      .map((layer) => item(layer))
      .reverse(),
    minFontSize: 4.5,
    scaleSymbols: true,
    showTitle: false,
    textGap: trim(4 * k),
    title: 'Legend',
    titleGap: trim(4 * k),
    titleSymbol: text(9 * k),
    itemGap: trim(3 * k),
    classGap: trim(3 * k),
    layerNameGap: trim(3 * k),
    fittingStrategy: 'AdjustColumnsAndFont',
    groupLayerNameGap: trim(3 * k),
    columns,
    makeColumnsSameWidth: true,
    defaultLegendItem: item(),
    balanceColumns: true,
  }
}

function scaleLineElement(w: Writer, rect: Rect, k: number): Json {
  const line = symbolReference({
    type: 'CIMLineSymbol',
    symbolLayers: [{ ...stroke('#000000', 1 * k), joinStyle: 'Round' }],
  })
  return {
    type: 'CIMScaleLine',
    anchor: 'BottomLeftCorner',
    name: 'Scale Bar',
    visible: true,
    customProperties: props({ 'pgmaps:role': 'scale' }),
    rotationCenter: { x: inch(rect.x), y: inch(w.height - rect.y - rect.h) },
    frame: { rings: [ring(w, rect)] },
    graphicFrame: graphicFrame(),
    mapFrame: MAP_FRAME_NAME,
    division: 100,
    divisions: 2,
    divisionsBeforeZero: 0,
    fittingStrategy: 'AdjustDivision',
    labelFrequency: 'DivisionsAndFirstMidpoint',
    labelGap: trim(2 * k),
    labelPosition: 'Above',
    labelSymbol: symbolReference(cimTextSymbol(7 * k, '#000000', { horizontal: 'Center', vertical: 'Baseline' })),
    numberFormat: {
      type: 'CIMNumericFormat',
      alignmentOption: 'esriAlignLeft',
      alignmentWidth: 12,
      roundingOption: 'esriRoundNumberOfDecimals',
      roundingValue: 0,
      useSeparator: true,
    },
    subdivisions: 2,
    unitLabel: 'm',
    unitLabelGap: trim(3 * k),
    unitLabelPosition: 'AfterLabels',
    unitLabelSymbol: symbolReference(cimTextSymbol(7 * k, '#000000', { vertical: 'Center' })),
    units: { uwkid: 9001 },
    barWidth: inch(rect.w * 0.8),
    divisionMarkHeight: trim(6 * k),
    divisionMarkSymbol: line,
    markFrequency: 'DivisionsAndSubdivisions',
    markPosition: 'Above',
    subdivisionMarkHeight: trim(4 * k),
    subdivisionMarkSymbol: line,
    midpointMarkHeight: trim(4 * k),
    lineSymbol: line,
  }
}

/** `<name>.pagx`: the sheet's page, frame, panels, legend, scale bar and north arrow, with the map inside. */
export function arcgisPagx(layout: LayoutDocument, doc: StyleDocument, options: MapFileOptions = {}): WriteResult {
  assertWritable(doc)
  const ctx: LayerContext = { diagnostics: [], format: 'pagx' }
  const sheet = resolveSheet(layout.template, layout.paper)
  const barFill =
    layout.template.id === OPERATING_PLAN_SIDE_PANEL.id ? SHEET_CHROME.operatingPlanFill : SHEET_CHROME.barFill
  const k = sheet.k
  const w: Writer = { height: sheet.height, k }
  const extent = layout.extent ?? doc.extent
  const { map, layers, uri, wkid } = mapDefinitions({ ...doc, extent }, ctx, options)
  const frame = sheet.frame

  // The camera: the extent's centre, at the layout's scale or the scale that fits the extent.
  let camera: Json | undefined
  if (extent) {
    const [x0, y0, x1, y1] = projectBox(wkid, extent)
    const [cx, cy] = project(wkid, [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2])
    const fit = Math.max(
      (x1 - x0) / ((frame.w / POINTS_PER_INCH) * METRES_PER_INCH),
      (y1 - y0) / ((frame.h / POINTS_PER_INCH) * METRES_PER_INCH),
    )
    const scale = layout.scale ?? Math.ceil(fit)
    camera = {
      type: 'CIMViewCamera',
      pitch: -90,
      scale: trim(scale, 3),
      x: trim(cx, 3),
      y: trim(cy, 3),
      z: 'NaN',
      viewportHeight: -1,
      viewportWidth: -1,
    }
    if (wkid === 3857)
      ctx.diagnostics.push(
        diagnostic(
          'pagx',
          'info',
          "The map is in Web Mercator, so Pro's map scale is not the ground scale away from the equator.",
        ),
      )
  } else
    ctx.diagnostics.push(
      diagnostic(
        'pagx',
        'warning',
        'Neither the layout nor the document has an extent; Pro opens the frame on its default view.',
      ),
    )

  const elements: Json[] = []
  const custom = { 'pgmaps:role': 'frame', 'pgmaps:template': layout.template.id }
  elements.push({
    type: 'CIMMapFrame',
    anchor: 'BottomLeftCorner',
    name: MAP_FRAME_NAME,
    visible: true,
    customProperties: props(custom),
    rotationCenter: { x: inch(frame.x), y: inch(sheet.height - frame.y - frame.h) },
    frame: { rings: [ring(w, frame)] },
    graphicFrame: graphicFrame({ color: SHEET_CHROME.line, width: 1 * k }),
    ...(camera
      ? { autoCamera: { type: 'CIMAutoCamera', autoCameraType: 'None', marginType: 'Percent', source: 'None' } }
      : {}),
    uRI: uri,
    view: {
      type: 'CIMMapView',
      viewableObjectPath: uri,
      viewingMode: 'Map',
      ...(camera ? { camera } : {}),
      verticalExaggerationScaleFactor: 1,
      sceneDrawingMode: 'Perspective',
      fieldOfView: 55,
      colorVisionDeficiencyMode: 'None',
    },
    useMapBackgroundColor: true,
  })

  const title = sheet.title
  elements.push(
    box(
      w,
      'Title bar',
      title,
      { fill: barFill, stroke: { color: SHEET_CHROME.line, width: 1 * k } },
      { 'pgmaps:role': 'title-bar' },
    ),
  )
  const titleSize = Math.min(14 * k, title.h * 0.6)
  elements.push(
    textElement(
      w,
      'Title',
      layout.title,
      [title.x + 6 * k, title.y + title.h / 2],
      cimTextSymbol(titleSize, SHEET_CHROME.barText, { bold: true, vertical: 'Center' }),
      {
        'pgmaps:role': 'title',
      },
    ),
  )
  if (layout.subtitle) {
    const subtitle = textElement(
      w,
      'Subtitle',
      layout.subtitle,
      [title.x + title.w - 6 * k, title.y + title.h / 2],
      cimTextSymbol(titleSize * 0.75, SHEET_CHROME.barText, { horizontal: 'Right', vertical: 'Center' }),
      { 'pgmaps:role': 'subtitle' },
    )
    elements.push({ ...subtitle, anchor: 'RightMidPoint' })
  }

  let legendBody: Rect | undefined
  let footerBody: Rect | undefined
  for (const panel of sheet.panels) {
    const name = panel.title ?? panel.id
    const body = { ...panel.rect }
    if (panel.bare)
      elements.push(box(w, `${name} panel`, panel.rect, {}, { 'pgmaps:panel': panel.id, 'pgmaps:part': 'box' }))
    else {
      const bar = headerHeight(layout, k)
      elements.push(
        box(
          w,
          `${name} panel`,
          panel.rect,
          { fill: '#ffffff', stroke: { color: SHEET_CHROME.line, width: 1 * k } },
          {
            'pgmaps:panel': panel.id,
            'pgmaps:part': 'box',
          },
        ),
        box(
          w,
          `${name} header`,
          { ...panel.rect, h: bar },
          { fill: barFill, stroke: { color: SHEET_CHROME.line, width: 1 * k } },
          { 'pgmaps:panel': panel.id, 'pgmaps:part': 'header' },
        ),
      )
      const heading = textElement(
        w,
        `${name} title`,
        panel.title ?? '',
        [panel.rect.x + panel.rect.w / 2, panel.rect.y + bar / 2],
        cimTextSymbol(Math.min(9 * k, bar * 0.7), SHEET_CHROME.barText, {
          bold: true,
          horizontal: 'Center',
          vertical: 'Center',
        }),
        { 'pgmaps:panel': panel.id, 'pgmaps:part': 'title' },
      )
      elements.push({ ...heading, anchor: 'CenterPoint' })
      body.y += bar
      body.h -= bar
    }
    if (panel.id === 'legend') legendBody = body
    if (panel.id === 'footer') footerBody = body
  }

  if (legendBody) {
    const pad = 4 * k
    elements.push(
      legendElement(
        w,
        { x: legendBody.x + pad, y: legendBody.y + pad, w: legendBody.w - pad * 2, h: legendBody.h - pad * 2 },
        layers,
        k,
        layout.template.id === OPERATING_PLAN_SIDE_PANEL.id ? 2 : 1,
      ),
    )
  } else
    ctx.diagnostics.push(diagnostic('pagx', 'info', 'The template has no legend panel, so the layout has no legend.'))

  const scaleRect = footerBody
    ? {
        x: footerBody.x + 6 * k,
        y: footerBody.y + 4 * k,
        w: Math.min(footerBody.w - 12 * k, 160 * k),
        h: Math.min(24 * k, footerBody.h / 2),
      }
    : { x: frame.x + frame.w - 170 * k, y: frame.y + frame.h - 34 * k, w: 160 * k, h: 24 * k }
  elements.push(scaleLineElement(w, scaleRect, k))

  // North arrow, bottom left inside the frame, as the sheet places it.
  const arrowHeight = Math.min(70 * k, frame.h * 0.14)
  const arrowWidth = arrowHeight * 0.32
  const cx = frame.x + Math.max(24 * k, frame.w * 0.035)
  const bottom = frame.y + frame.h - 14 * k
  const arrowRect = { x: cx - arrowWidth / 2, y: bottom - arrowHeight, w: arrowWidth, h: arrowHeight }
  elements.push({
    type: 'CIMMarkerNorthArrow',
    anchor: 'BottomMidPoint',
    name: 'North Arrow',
    visible: true,
    customProperties: props({ 'pgmaps:role': 'north-arrow' }),
    rotationCenter: { x: inch(cx), y: inch(sheet.height - bottom) },
    lockedAspectRatio: true,
    frame: { rings: [ring(w, arrowRect)] },
    graphicFrame: graphicFrame(),
    mapFrame: MAP_FRAME_NAME,
    pointSymbol: northArrowSymbol(arrowHeight, k),
    northType: 'TrueNorth',
  })

  elements.push(
    box(
      w,
      'Neatline',
      sheet.neatline,
      { stroke: { color: SHEET_CHROME.line, width: 1.5 * k } },
      { 'pgmaps:role': 'neatline' },
    ),
  )

  const cimDocument = {
    type: 'CIMLayoutDocument',
    version: CIM_VERSION,
    build: CIM_BUILD,
    layoutDefinition: {
      type: 'CIMLayout',
      name: layout.name,
      uRI: `CIMPATH=layout/${safeFileStem(layout.name).toLowerCase() || 'layout'}.json`,
      sourceModifiedTime: { type: 'TimeInstant' },
      useSourceMetadata: true,
      elements,
      page: {
        type: 'CIMPage',
        height: inch(sheet.height),
        width: inch(sheet.width),
        units: { uwkid: PAGE_UNITS_INCHES },
        showRulers: true,
        showGuides: true,
        smallestRulerDivision: 0,
      },
      colorModel: 'RGB',
      rGBColorProfile: 'sRGB IEC61966-2.1',
      cMYKColorProfile: 'U.S. Web Coated (SWOP) v2',
    },
    mapDefinitions: [map],
    layerDefinitions: layers,
  }
  return {
    files: [
      {
        path: `${safeFileStem(layout.name)}.pagx`,
        content: JSON.stringify(cimDocument, null, 2),
        mime: LAYER_FILE_MIME,
      },
    ],
    diagnostics: ctx.diagnostics,
  }
}
