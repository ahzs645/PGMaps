export type OverlayRenderMode = 'raster' | 'vector'
export type ActiveFiresRenderMode = OverlayRenderMode
export type FireDangerRenderMode = OverlayRenderMode
export type FirePerimetersRenderMode = OverlayRenderMode
export type ForecastZonesRenderMode = OverlayRenderMode
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
  rep_date?: string
  source?: string
  sensor?: string
  satellite?: string
  agency?: string
  age?: number
  frp?: number
  temp?: number
  fwi?: number
  fuel?: string
}
