/**
 * Styled layers as ArcGIS Pro layer files (`.lyrx`, a `CIMLayerDocument`), one per layer, each
 * pointing at the layer's shapefile in the export's data folder. The feature-layer definition is
 * also what the map (`.mapx`) and layout (`.pagx`) writers embed.
 *
 * - The data connection is a `Shapefile` workspace with a relative `DATABASE=.\data` path and
 *   the dataset `<id>.shp`, the form Pro writes when "store relative paths" is on (seen in
 *   shapefile layer files from Pro 2.0–3.7); Pro resolves it against the folder holding the file.
 * - Rules become a `CIMSimpleRenderer` (one else rule), a `CIMUniqueValueRenderer` (eq / in tests
 *   on one field, the else rule as the default symbol), a `CIMClassBreaksRenderer` (ranges on one
 *   field that touch end to end; Pro's classes include their upper break, ours exclude it, so each
 *   break is written one floating-point step below the range's end, which is exact), or otherwise a unique-value renderer keyed by an Arcade `When()`
 *   expression that returns the number of the first matching rule, so any mix keeps first match.
 * - Labels are one `CIMLabelClass` with an Arcade `$feature.FIELD` expression.
 * Names follow the CIM specification (github.com/Esri/cim-spec, v3). No DOM or network access.
 */
import type {
  FieldValue,
  RuleFilter,
  StyleDocument,
  StyledLayer,
  WriteResult,
  ExchangeDiagnostic,
  LabelStyle,
} from '../model'
import { documentProblems } from '../model'
import { cimSymbol, symbolReference } from './cim'
import { CIM_BUILD, CIM_VERSION, cimColor, diagnostic, nextAfter, type Json } from './cimCommon'

export interface LayerFileOptions {
  /** Folder of the shapefiles, relative to the written file; `data` by default. */
  dataFolder?: string
}

export const RULE_EXPRESSION_TITLE = 'PGMaps rules (first match)'
/** Arcade values outside every class break, so an open range survives JSON. */
const OPEN_BOUND = Number.MAX_VALUE

/** `DATABASE=.\data` for a folder relative to the file, `DATABASE=.` for the same folder. */
export function relativeDatabase(folder = 'data'): string {
  const parts = folder.split(/[\\/]+/).filter((part) => part && part !== '.')
  return parts.length ? `DATABASE=.\\${parts.join('\\')}` : 'DATABASE=.'
}

/** A Pro text symbol in the shape Pro writes for labels and layout text. */
export function cimTextSymbol(
  size: number,
  color: string,
  options: {
    bold?: boolean
    halo?: { color: string; width: number }
    horizontal?: 'Left' | 'Center' | 'Right'
    vertical?: 'Top' | 'Center' | 'Baseline' | 'Bottom'
    font?: string
  } = {},
): Json {
  const fill = (css: string) => ({
    type: 'CIMPolygonSymbol',
    symbolLayers: [{ type: 'CIMSolidFill', enable: true, color: cimColor(css) }],
    angleAlignment: 'Map',
  })
  return {
    type: 'CIMTextSymbol',
    blockProgression: 'TTB',
    depth3D: 1,
    extrapolateBaselines: true,
    fontEffects: 'Normal',
    fontEncoding: 'Unicode',
    fontFamilyName: options.font ?? 'Arial',
    fontStyleName: options.bold ? 'Bold' : 'Regular',
    fontType: 'Unspecified',
    haloSize: options.halo ? options.halo.width : 1,
    ...(options.halo ? { haloSymbol: fill(options.halo.color) } : {}),
    height: size,
    hinting: 'Default',
    horizontalAlignment: options.horizontal ?? 'Left',
    kerning: true,
    letterWidth: 100,
    ligatures: true,
    lineGapType: 'ExtraLeading',
    symbol: fill(color),
    textCase: 'Normal',
    textDirection: 'LTR',
    verticalAlignment: options.vertical ?? 'Bottom',
    verticalGlyphOrientation: 'Right',
    wordSpacing: 100,
    billboardMode3D: 'FaceNearPlane',
  }
}

const ZONES = {
  type: 'CIMMaplexExternalZonePriorities',
  aboveLeft: 4,
  aboveCenter: 2,
  aboveRight: 1,
  centerRight: 3,
  belowRight: 5,
  belowCenter: 7,
  belowLeft: 8,
  centerLeft: 6,
}

/** Pro's default Maplex and standard placement blocks, set for a point, line or polygon label. */
function placementProperties(layer: StyledLayer, label: LabelStyle) {
  const featureType = layer.geometry === 'point' ? 'Point' : layer.geometry === 'line' ? 'Line' : 'Polygon'
  const along = label.placement === 'line'
  const maplex = {
    type: 'CIMMaplexLabelPlacementProperties',
    featureType,
    avoidPolygonHoles: true,
    canOverrunFeature: true,
    canPlaceLabelOutsidePolygon: true,
    canRemoveOverlappingLabel: true,
    canStackLabel: false,
    connectionType: 'Unambiguous',
    constrainOffset: 'NoConstraint',
    contourAlignmentType: 'Page',
    contourLadderType: 'Straight',
    contourMaximumAngle: 90,
    enableConnection: true,
    featureWeight: 0,
    fontHeightReductionLimit: 4,
    fontHeightReductionStep: 0.5,
    fontWidthReductionLimit: 90,
    fontWidthReductionStep: 5,
    graticuleAlignmentType: 'Straight',
    keyNumberGroupName: 'Default',
    labelBuffer: 15,
    labelLargestPolygon: true,
    labelPriority: -1,
    labelStackingProperties: {
      type: 'CIMMaplexLabelStackingProperties',
      stackAlignment: 'ChooseBest',
      maximumNumberOfLines: 3,
      minimumNumberOfCharsPerLine: 3,
      maximumNumberOfCharsPerLine: 24,
      separators: [{ type: 'CIMMaplexStackingSeparator', separator: ' ', splitAfter: true }],
    },
    lineFeatureType: 'General',
    linePlacementMethod: along ? 'CenteredCurvedOnLine' : 'CenteredHorizontalOnLine',
    maximumLabelOverrun: 36,
    maximumLabelOverrunUnit: 'Point',
    minimumFeatureSizeUnit: 'Map',
    multiPartOption: 'OneLabelPerPart',
    offsetAlongLineProperties: {
      type: 'CIMMaplexOffsetAlongLineProperties',
      placementMethod: 'BestPositionAlongLine',
      labelAnchorPoint: 'CenterOfLabel',
      distanceUnit: 'Percentage',
      useLineDirection: true,
    },
    pointExternalZonePriorities: ZONES,
    pointPlacementMethod: 'AroundPoint',
    polygonAnchorPointType: 'GeometricCenter',
    polygonBoundaryWeight: 0,
    polygonExternalZones: ZONES,
    polygonFeatureType: 'General',
    polygonInternalZones: { type: 'CIMMaplexInternalZonePriorities', center: 1 },
    polygonPlacementMethod: along ? 'CurvedInPolygon' : 'HorizontalInPolygon',
    primaryOffset: 1,
    primaryOffsetUnit: 'Point',
    removeExtraWhiteSpace: true,
    repetitionIntervalUnit: 'Point',
    rotationProperties: { type: 'CIMMaplexRotationProperties', rotationType: 'Arithmetic', alignmentType: 'Straight' },
    secondaryOffset: 100,
    strategyPriorities: {
      type: 'CIMMaplexStrategyPriorities',
      stacking: 1,
      overrun: 2,
      fontCompression: 3,
      fontReduction: 4,
      abbreviation: 5,
    },
    thinningDistanceUnit: 'Point',
    truncationMarkerCharacter: '.',
    truncationMinimumLength: 1,
    truncationPreferredCharacters: 'aeiou',
  }
  const standard = {
    type: 'CIMStandardLabelPlacementProperties',
    featureType,
    featureWeight: 'None',
    labelWeight: 'High',
    numLabelsOption: 'OneLabelPerName',
    lineLabelPosition: {
      type: 'CIMStandardLineLabelPosition',
      above: !along,
      inLine: along,
      parallel: along,
      horizontal: !along,
    },
    lineLabelPriorities: {
      type: 'CIMStandardLineLabelPriorities',
      aboveStart: 3,
      aboveAlong: 3,
      aboveEnd: 3,
      centerStart: 3,
      centerAlong: 3,
      centerEnd: 3,
      belowStart: 3,
      belowAlong: 3,
      belowEnd: 3,
    },
    pointPlacementMethod: 'AroundPoint',
    pointPlacementPriorities: {
      type: 'CIMStandardPointPlacementPriorities',
      aboveLeft: 2,
      aboveCenter: 2,
      aboveRight: 1,
      centerLeft: 3,
      centerRight: 2,
      belowLeft: 3,
      belowCenter: 3,
      belowRight: 2,
    },
    rotationType: 'Arithmetic',
    polygonPlacementMethod: along ? 'AlwaysStraight' : 'AlwaysHorizontal',
  }
  return { maplex, standard }
}

/** Arcade that reads a field whatever its name. */
const arcadeString = (value: string) =>
  `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`
const arcadeLiteral = (value: FieldValue) => (typeof value === 'string' ? arcadeString(value) : String(value))
const fieldRef = (field: string) => `$feature[${arcadeString(field)}]`

/** One rule's test in Arcade, matching `filterMatches`. */
export function arcadeCondition(filter: RuleFilter): string {
  const ref = fieldRef(filter.field)
  if (filter.op === 'eq') return `${ref} == ${arcadeLiteral(filter.value)}`
  if (filter.op === 'in') return `Includes([${filter.values.map(arcadeLiteral).join(', ')}], ${ref})`
  const tests = [`TypeOf(${ref}) == "Number"`]
  if (filter.min !== undefined) tests.push(`${ref} >= ${filter.min}`)
  if (filter.max !== undefined) tests.push(`${ref} < ${filter.max}`)
  return tests.join(' && ')
}

/** `When(test0, "0", test1, "1", …, null)`: the number of the first rule that matches. */
export const rulesExpression = (filters: RuleFilter[]) =>
  `When(${filters.map((filter, i) => `${arcadeCondition(filter)}, "${i}"`).join(', ')}, null)`

interface Context {
  diagnostics: ExchangeDiagnostic[]
  format: 'lyrx' | 'mapx' | 'pagx'
}

const symbolFor = (symbol: StyledLayer['rules'][number]['symbol'], ctx: Context, subject: string) => {
  const written = cimSymbol(symbol, { format: ctx.format })
  ctx.diagnostics.push(...written.diagnostics.map((d) => ({ ...d, subject })))
  return symbolReference(written.symbol)
}

function uniqueClass(label: string, symbol: Json, values: string[]): Json {
  return {
    type: 'CIMUniqueValueClass',
    label,
    patch: 'Default',
    symbol,
    values: values.map((value) => ({ type: 'CIMUniqueValue', fieldValues: [value] })),
    visible: true,
  }
}

/** Ranges that, sorted, touch end to end: what class breaks carry. */
function contiguousRanges(filters: RuleFilter[]): Extract<RuleFilter, { op: 'range' }>[] | null {
  if (!filters.every((filter) => filter.op === 'range')) return null
  const ranges = [...(filters as Extract<RuleFilter, { op: 'range' }>[])].sort(
    (a, b) => (a.min ?? -Infinity) - (b.min ?? -Infinity),
  )
  for (let i = 0; i < ranges.length; i++) {
    if (i > 0 && ranges[i].min === undefined) return null
    if (i < ranges.length - 1 && (ranges[i].max === undefined || ranges[i].max !== ranges[i + 1].min)) return null
    if (ranges[i].min !== undefined && ranges[i].max !== undefined && ranges[i].max! <= ranges[i].min!) return null
  }
  return ranges
}

/** The renderer for a layer's rules, first match kept. */
export function layerRenderer(layer: StyledLayer, ctx: Context): Json {
  const last = layer.rules[layer.rules.length - 1]
  const fallback = last && !last.filter ? last : undefined
  const tested = layer.rules.filter((rule) => rule.filter)
  const subject = layer.name
  const fallbackSymbol = fallback && symbolFor(fallback.symbol, ctx, `${layer.name}: ${fallback.label}`)
  if (!tested.length && fallback)
    return { type: 'CIMSimpleRenderer', patch: 'Default', label: fallback.label, symbol: fallbackSymbol }
  const defaults = fallback
    ? {
        defaultLabel: fallback.label,
        defaultSymbol: fallbackSymbol,
        defaultSymbolPatch: 'Default',
        useDefaultSymbol: true,
      }
    : { useDefaultSymbol: false }
  const filters = tested.map((rule) => rule.filter!)
  const fields = new Set(filters.map((filter) => filter.field))
  const field = filters[0].field
  if (fields.size === 1 && filters.every((filter) => filter.op !== 'range')) {
    const seen = new Set<string>()
    const classes: Json[] = []
    for (const rule of tested) {
      const filter = rule.filter as Exclude<RuleFilter, { op: 'range' }>
      const raw = filter.op === 'eq' ? [filter.value] : filter.values
      if (raw.some((value) => typeof value === 'boolean'))
        ctx.diagnostics.push(
          diagnostic(
            ctx.format,
            'warning',
            `"${rule.label}" tests true/false, which Pro matches as the text "true"/"false".`,
            subject,
          ),
        )
      const values = raw.map(String).filter((value) => {
        if (seen.has(value)) {
          ctx.diagnostics.push(
            diagnostic(
              ctx.format,
              'warning',
              `"${rule.label}" repeats ${value}, which an earlier rule already draws.`,
              subject,
            ),
          )
          return false
        }
        seen.add(value)
        return true
      })
      if (values.length)
        classes.push(uniqueClass(rule.label, symbolFor(rule.symbol, ctx, `${layer.name}: ${rule.label}`), values))
    }
    return {
      type: 'CIMUniqueValueRenderer',
      sampleSize: 10000,
      ...defaults,
      fields: [field],
      groups: [{ type: 'CIMUniqueValueGroup', classes, heading: field }],
      polygonSymbolColorTarget: 'Fill',
    }
  }
  const ranges = fields.size === 1 ? contiguousRanges(filters) : null
  if (ranges) {
    const byRange = new Map(tested.map((rule) => [rule.filter, rule]))
    if (ranges.some((range) => range.max !== undefined))
      ctx.diagnostics.push(
        diagnostic(
          ctx.format,
          'info',
          "Each class break sits one floating-point step below the PGMaps range's end, so Pro's breaks, which include their upper value, draw exactly the values PGMaps does.",
          subject,
        ),
      )
    return {
      type: 'CIMClassBreaksRenderer',
      barrierWeight: 'High',
      breaks: ranges.map((range) => {
        const rule = byRange.get(range)!
        return {
          type: 'CIMClassBreak',
          label: rule.label,
          patch: 'Default',
          symbol: symbolFor(rule.symbol, ctx, `${layer.name}: ${rule.label}`),
          upperBound: range.max === undefined ? OPEN_BOUND : nextAfter(range.max, false),
        }
      }),
      classBreakType: 'GraduatedColor',
      classificationMethod: 'Manual',
      field,
      heading: field,
      minimumBreak: ranges[0].min ?? -OPEN_BOUND,
      numberFormat: {
        type: 'CIMNumericFormat',
        alignmentOption: 'esriAlignLeft',
        alignmentWidth: 0,
        roundingOption: 'esriRoundNumberOfDecimals',
        roundingValue: 6,
        zeroPad: true,
      },
      showInAscendingOrder: true,
      sampleSize: 10000,
      ...defaults,
      polygonSymbolColorTarget: 'Fill',
      normalizationType: 'Nothing',
      normalizationTotal: 0,
      exclusionSymbolPatch: 'Default',
      useExclusionSymbol: false,
      alwaysUpdateClassLabels: false,
      drawGraduatedSymbolsAboveAllLayers: false,
    }
  }
  ctx.diagnostics.push(
    diagnostic(
      ctx.format,
      'info',
      'The rules test more than one field or overlap, so Pro draws them through an Arcade expression that returns the first matching rule; edit the rules in PGMaps.',
      subject,
    ),
  )
  return {
    type: 'CIMUniqueValueRenderer',
    sampleSize: 10000,
    ...defaults,
    groups: [
      {
        type: 'CIMUniqueValueGroup',
        classes: tested.map((rule, i) =>
          uniqueClass(rule.label, symbolFor(rule.symbol, ctx, `${layer.name}: ${rule.label}`), [String(i)]),
        ),
        heading: 'Rule',
      },
    ],
    valueExpressionInfo: {
      type: 'CIMExpressionInfo',
      title: RULE_EXPRESSION_TITLE,
      expression: rulesExpression(filters),
      returnType: 'String',
    },
    polygonSymbolColorTarget: 'Fill',
  }
}

function labelClass(layer: StyledLayer, label: LabelStyle): Json {
  const { maplex, standard } = placementProperties(layer, label)
  const field = /^[A-Za-z_][A-Za-z0-9_]*$/.test(label.field) ? `$feature.${label.field}` : fieldRef(label.field)
  return {
    type: 'CIMLabelClass',
    expressionTitle: 'Custom',
    expression: field,
    expressionEngine: 'Arcade',
    featuresToLabel: 'AllVisibleFeatures',
    maplexLabelPlacementProperties: maplex,
    name: 'Class 1',
    priority: -1,
    standardLabelPlacementProperties: standard,
    textSymbol: symbolReference(
      cimTextSymbol(label.size, label.color, {
        bold: label.bold,
        halo: label.halo,
        horizontal: label.placement === 'line' ? 'Center' : 'Left',
        vertical: label.placement === 'line' ? 'Center' : 'Bottom',
      }),
    ),
    useCodedValue: true,
    visibility: true,
    iD: -1,
  }
}

/** The `CIMFeatureLayer` for a styled layer, reading `<dataFolder>/<id>.shp`. */
export function featureLayerDefinition(
  layer: StyledLayer,
  uri: string,
  ctx: Context,
  options: LayerFileOptions = {},
): Json {
  return {
    type: 'CIMFeatureLayer',
    name: layer.name,
    uRI: uri,
    sourceModifiedTime: { type: 'TimeInstant' },
    useSourceMetadata: true,
    description: layer.name,
    layerElevation: { type: 'CIMLayerElevationSurface' },
    expanded: true,
    layerType: 'Operational',
    showLegends: true,
    visibility: !layer.hidden,
    displayCacheType: 'Permanent',
    maxDisplayCacheAge: 5,
    showPopups: true,
    serviceLayerID: -1,
    refreshRate: -1,
    refreshRateUnit: 'esriTimeUnitsSeconds',
    blendingMode: 'Alpha',
    autoGenerateFeatureTemplates: true,
    featureElevationExpression: '0',
    featureTable: {
      type: 'CIMFeatureTable',
      displayField: layer.label?.field ?? layer.fields[0]?.name ?? 'FID',
      editable: true,
      fieldDescriptions: layer.fields.map((field) => ({
        type: 'CIMFieldDescription',
        alias: field.name,
        fieldName: field.name,
        ...(field.type === 'number'
          ? {
              numberFormat: {
                type: 'CIMNumericFormat',
                alignmentOption: 'esriAlignRight',
                alignmentWidth: 0,
                roundingOption: 'esriRoundNumberOfDecimals',
                roundingValue: 6,
              },
            }
          : {}),
        visible: true,
        searchMode: 'Exact',
      })),
      dataConnection: {
        type: 'CIMStandardDataConnection',
        workspaceConnectionString: relativeDatabase(options.dataFolder),
        workspaceFactory: 'Shapefile',
        dataset: `${layer.id}.shp`,
        datasetType: 'esriDTFeatureClass',
      },
      studyAreaSpatialRel: 'esriSpatialRelUndefined',
      searchOrder: 'esriSearchOrderSpatial',
    },
    htmlPopupEnabled: true,
    selectable: true,
    featureCacheType: 'Session',
    labelClasses: layer.label ? [labelClass(layer, layer.label)] : [],
    labelVisibility: Boolean(layer.label),
    renderer: layerRenderer(layer, ctx),
    scaleSymbols: true,
    snappable: true,
  }
}

/** Throws when the document cannot be written, naming every problem. */
export function assertWritable(doc: StyleDocument) {
  const problems = documentProblems(doc)
  if (problems.length) throw Error(`The style cannot be written: ${problems.join(' ')}`)
}

export const LAYER_FILE_MIME = 'application/json'

/** One `.lyrx` per layer, each reading `<dataFolder>/<layer id>.shp` next to it. */
export function arcgisLayerFiles(doc: StyleDocument, options: LayerFileOptions = {}): WriteResult {
  assertWritable(doc)
  const ctx: Context = { diagnostics: [], format: 'lyrx' }
  const files = doc.layers.map((layer) => {
    const uri = `CIMPATH=map/${layer.id.toLowerCase()}.json`
    const cimDocument = {
      type: 'CIMLayerDocument',
      version: CIM_VERSION,
      build: CIM_BUILD,
      layers: [uri],
      layerDefinitions: [featureLayerDefinition(layer, uri, ctx, options)],
      rGBColorProfile: 'sRGB IEC61966-2.1',
      cMYKColorProfile: 'U.S. Web Coated (SWOP) v2',
    }
    return { path: `${layer.id}.lyrx`, content: JSON.stringify(cimDocument, null, 2), mime: LAYER_FILE_MIME }
  })
  return { files, diagnostics: ctx.diagnostics }
}

export type { Context as LayerContext }
