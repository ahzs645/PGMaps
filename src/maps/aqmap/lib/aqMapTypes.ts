export type OverlayRenderMode = 'raster' | 'vector' | 'deckgl'
export type ActiveFiresRenderMode = OverlayRenderMode
export type FireDangerRenderMode = OverlayRenderMode
export type FirePerimetersRenderMode = OverlayRenderMode
export type ForecastZonesRenderMode = OverlayRenderMode
export type ModelledSmokeRenderMode = OverlayRenderMode
export type AqMonitorIconMode = 'aqmap' | 'revealed'
export type MobileFeatureDisplay = 'card' | 'popup'
export type AqClusterColorScheme = 'classic' | 'slate'

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
