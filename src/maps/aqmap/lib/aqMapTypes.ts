export type OverlayRenderMode = 'raster' | 'vector' | 'deckgl'
export type ActiveFiresRenderMode = OverlayRenderMode
export type FireDangerRenderMode = OverlayRenderMode
export type FirePerimetersRenderMode = OverlayRenderMode
export type ForecastZonesRenderMode = OverlayRenderMode
export type ModelledSmokeRenderMode = OverlayRenderMode
export type AqMonitorIconMode = 'aqmap' | 'revealed' | 'ring'
export type MobileFeatureDisplay = 'card' | 'popup'
export type AqClusterColorScheme = 'classic' | 'slate'

// Sub-type knobs for the ring (pie-donut) cluster marker. The three toggles are
// independent so any combination can be explored on /dev/aqmap/ring.
export type AqRingShape = 'donut' | 'pie'
export type AqRingCenter = 'white' | 'transparent'
export type AqRingStyle = {
  /** Donut leaves a hollow centre; pie fills the wedges all the way in. */
  shape: AqRingShape
  /** Whether the cluster's total sensor count is drawn in the centre. */
  showNumber: boolean
  /** Donut hole fill: solid white, or transparent so the basemap shows through. */
  center: AqRingCenter
}

/** Default ring style — matches the original donut (white hole + count). */
export const DEFAULT_RING_STYLE: AqRingStyle = {
  shape: 'donut',
  showNumber: true,
  center: 'white',
}

export type FireDangerFeatureProperties = {
  GRIDCODE?: number
}

export type FirePerimeterFeatureProperties = {
  hcount?: number
  firstdate?: string
  lastdate?: string
  area?: number
}

export type ForecastZoneFeatureProperties = {
  OBJECTID?: number
  CLC?: string
  FEATURE_ID?: string
  NAME?: string
  NOM?: string
  LAT_DD?: number
  LON_DD?: number
  KIND?: string
  PROVINCE_C?: string
}

export type ActiveFireFeatureProperties = {
  uid?: number
  id?: number
  rep_date?: string
  source?: string
  sensor?: string
  satellite?: string
  agency?: string
  agency_code?: string
  region_code?: string
  national_fire_id?: string
  agency_fire_id?: string
  national_fire_cause?: string
  fire_size?: number
  response_type?: string
  stage_of_control_status?: string
  situation_report_date?: string
  status_date?: string
  latitude?: number
  longitude?: number
  fire_year?: number
  status_year?: number
  record_start?: string
  record_end?: string
  age?: number
  frp?: number
  temp?: number
  fwi?: number
  fuel?: string
}
