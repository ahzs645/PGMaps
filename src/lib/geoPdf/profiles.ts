/**
 * Company profiles interpret a template's export conventions, not regulatory meaning. Everything
 * the reader assumes about a company's sheets lives in its profile: which named layers are which,
 * which images are class rasters and how their legends are drawn, where contour heights are
 * printed, and what colour sits under transparent pixels. Another template is one more profile
 * and its tests (`docs/forestry-road-design/map-pdf-profiles.md`); an unknown template is refused.
 * Calibrated against the supplied August/September 2026 Canfor ArcGIS Pro sheets. No source sheets
 * are distributed.
 */
import { CANFOR_RASTERS, type RasterProfile } from './rasterProfiles'

export interface PdfLayerRule {
  name: string
  match: RegExp
  shape: 'line' | 'polygon'
  role?: 'planned-block'
  selected: boolean
  compound?: boolean
  /** Stroked contour lines collected for a terrain surface instead of a reference layer. */
  contour?: boolean
}

/** How a template draws its raster legend: filled swatches with the range printed beside them. */
export interface LegendGeometry {
  /** Swatch width and height in page points, both bounds exclusive. */
  swatchWidth: [number, number]
  swatchHeight: [number, number]
  /** Swatches must lie entirely to the right of the map frame, or anywhere outside it. */
  placement: 'right-of-frame' | 'outside-frame'
  /** Largest gap, in points, from a swatch's right edge to the start of its label. */
  labelGap: number
  /** Largest vertical distance, in points, between a label's middle and its swatch's middle. */
  labelOffset: number
}

export interface ContourConventions {
  /** Legend text stating the interval; the first group is the interval in metres. */
  statedInterval?: RegExp
  /** A printed contour height. Defaults to an optionally signed whole number of 1–5 digits. */
  label?: RegExp
}

export interface PdfTemplateProfile {
  id: string
  label: string
  /** Recognizes the template from the PDF's creator and its optional-content layer names. */
  matches: (creator: string, layers: string[]) => boolean
  rules: PdfLayerRule[]
  /** Class rasters this template publishes; empty when it has none. */
  rasters: RasterProfile[]
  legend: LegendGeometry
  contours: ContourConventions
  /** Colour the exporter writes under transparent pixels; JPEG tiles encode it. */
  transparentFill: [number, number, number]
}

export const CANFOR_PROFILE: PdfTemplateProfile = {
  id: 'canfor-arcgis-2026-v1',
  label: 'Canfor · ArcGIS map sheets (2026, v1)',
  matches: (creator: string, layers: string[]) =>
    /ArcGIS/i.test(creator) &&
    layers.some((s) => /^Blocks - (0k - 25k|26k - 75k)$/.test(s)) &&
    layers.some((s) => s === 'ROAD: Roads - 0k - 250k') &&
    layers.some((s) => /^Streams - (0k - 25k|No Labels - 26k - 75k)$/.test(s)) &&
    layers.some((s) => /^SU: Reserves/.test(s)),
  rules: [
    { name: 'Block outlines', match: /^Blocks - (0k - 25k|26k - 75k)$/, shape: 'polygon', selected: true },
    { name: 'Roads', match: /^Roads - (0k - 25k|26k - 75k)$/, shape: 'line', selected: true },
    {
      name: 'Streams',
      match: /^Streams - (0k - 25k|No Labels - 26k - 75k)$/,
      shape: 'line',
      selected: true,
      compound: true,
    },
    { name: 'Reserves', match: /^SU: Reserves(?: \(|$)/, shape: 'polygon', selected: true },
    { name: 'RESULTS reserves', match: /^Results Reserves$/, shape: 'polygon', selected: true },
    { name: 'Field lines', match: /^Field Lines - Field Map$/, shape: 'line', selected: false },
    // Only the stroked lines: the "- Index" and "- Default" sublayers are the white filled halos behind labels.
    { name: 'Contours', match: /^Contours - Enhanced - 6k - 26k$/, shape: 'line', selected: false, contour: true },
    { name: 'LiDAR streams', match: /^LiDAR Stream(?:s)?$/, shape: 'line', selected: false },
  ],
  rasters: CANFOR_RASTERS,
  legend: { swatchWidth: [8, 40], swatchHeight: [4, 20], placement: 'right-of-frame', labelGap: 12, labelOffset: 5 },
  contours: { statedInterval: /^Contours\s*-\s*(\d+)\s*m$/i },
  transparentFill: [0, 0, 0],
}

/** Checked in order; the first profile whose `matches` accepts the PDF reads it. */
export const PDF_PROFILES: PdfTemplateProfile[] = [CANFOR_PROFILE]
export const PDF_DRAWING_NOTE =
  'Recovered map drawing. Check against the sheet and original GIS before using it in a calculation. Stream classes and road status are not inferred from colour or legend symbols.'
