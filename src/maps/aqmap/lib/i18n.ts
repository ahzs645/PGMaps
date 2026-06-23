export type AqmapLocale = 'en' | 'fr'

type StringMap = Record<string, string>

const EN: StringMap = {
  'app.title': 'AQmap',
  'app.subtitle': 'Static reimplementation of the AQmap monitor and overlay view.',
  'app.snapshot': 'Static snapshot',
  'app.monitorData': 'Monitor data:',
  'app.endpoints': 'aqmap-compatible endpoints',
  'app.lastUpdated': 'Last updated:',
  'app.latestObservation': 'Latest monitor timestamp:',
  'app.noTimestamp': 'No timestamp',
  'map.legend': 'Legend',

  'sidebar.visible': 'Visible',
  'sidebar.pm25Count': 'PM2.5',
  'sidebar.monitorLayers': 'Monitor Layers',
  'sidebar.overlays': 'Overlays',
  'sidebar.wmsLegends': 'WMS Legends',
  'sidebar.basemap': 'Basemap',
  'sidebar.basemap.light': 'Light Theme',
  'sidebar.basemap.topographic': 'Topographic',
  'sidebar.basemap.dark': 'Dark Theme',
  'sidebar.pm25Legend': 'PM2.5 Legend',
  'sidebar.iconLegend': 'Monitor Icon Legend',
  'sidebar.iconMode': 'Monitor Icon Mode',
  'sidebar.featureDisplay': 'Feature Display (mobile)',
  'featureDisplay.card': 'Card',
  'featureDisplay.popup': 'Popup',
  'sidebar.export': 'Export Map',
  'sidebar.language': 'Language',
  'sidebar.debug': 'Debug',

  'controls.basemaps': 'Basemaps',
  'controls.layers': 'Layers',
  'controls.zoomToLocation': 'Zoom to your location',
  'controls.resetView': 'Reset map view',

  'groups.agency': 'Regulatory',
  'groups.lcm': 'Low-cost',
  'groups.other': 'Other networks',

  'sidebar.observationData': 'Observation Data',
  'sidebar.modelEstimates': 'Model Estimates',
  'sidebar.satelliteData': 'Satellite Data',
  'network.agency': 'Agency (FEM)',
  'network.purpleair': 'PurpleAir (PA)',
  'network.aqegg': 'AQ Egg (EGG)',
  'layer.surfaceWind': 'Surface Wind',
  'layer.surfacePm25': 'Surface PM2.5',
  'layer.surfaceSmoke': 'Surface Smoke',

  'monitorType.fem': 'Regulatory (FEM)',
  'monitorType.pa': 'PurpleAir (PA)',
  'monitorType.egg': 'AQegg (EGG)',
  'monitorType.missing': 'Missing recent data',
  'icons.aqmap': 'AQMap',
  'icons.revealed': 'Reveal',
  'reveal.tuning': 'Reveal tuning',
  'reveal.reset': 'Reset',
  'reveal.clusterColors': 'Cluster colors',
  'clusterColors.classic': 'Classic',
  'clusterColors.slate': 'Blue-gray',
  'reveal.clusterRadius': 'Cluster radius',
  'reveal.clusterMaxZoom': 'Cluster until zoom',
  'reveal.tightPacking': 'Tight packing (cap bubbles at half the radius for near-zero overlap)',

  'aqhi.low': 'Low',
  'aqhi.moderate': 'Moderate',
  'aqhi.high': 'High',
  'aqhi.veryHigh': 'Very high',
  'aqhi.noData': 'No Data',
  'aqhi.unit': 'µg m⁻³',
  'aqhi.range.low': '0-29.9',
  'aqhi.range.moderate': '30-59.9',
  'aqhi.range.high': '60-99.9',
  'aqhi.range.veryHigh': '100+',

  'popup.monitor': 'monitor',
  'popup.observedAsOf': 'Observed PM₂.₅ as of:',
  'popup.forecastZone': 'Forecast zone',
  'popup.readings': 'PM₂.₅ averages',
  'popup.tenMinAvg': '10-min average',
  'popup.oneHourAvg': '1-hour average',
  'popup.threeHourAvg': '3-hour average',
  'popup.twentyFourHourAvg': '24-hour average',
  'popup.tenMinTitle': 'Mean average PM2.5 concentration for the past 10 minutes.',
  'popup.oneHourTitle': 'Mean average PM2.5 concentration for the past hour.',
  'popup.threeHourTitle': 'Mean average PM2.5 concentration for the past 3 hours.',
  'popup.twentyFourHourTitle': 'Mean average PM2.5 concentration for the past 24 hours.',
  'popup.healthMessage': 'Health messaging based on the AQHI+ system.',
  'popup.plotButton': 'Plot Timeseries',
  'popup.plotSource.endpoint': '/data/plotting',
  'popup.plotSource.fallback': 'Fallback data',
  'popup.hourlyPm25': 'Hourly PM2.5',
  'popup.now': 'Now',

  'health.heading.low': '1 Hour Average Between 0 - 29.9 µg m⁻³ (Low AQHI+):',
  'health.heading.moderate': '1 Hour Average Between 30 - 59.9 µg m⁻³ (Moderate AQHI+):',
  'health.heading.high': '1 Hour Average Between 60 - 99.9 µg m⁻³ (High AQHI+):',
  'health.heading.veryHigh': '1 Hour Average 100+ µg m⁻³ (Very High AQHI+):',
  'health.heading.noData': 'No recent 1 hour average (No Data AQHI+):',
  'health.noData': 'Data for the past hour from this monitor is missing.',
  'health.low.general': 'General Population - Ideal air for outdoor activities.',
  'health.low.atRisk': 'At Risk - Enjoy usual outdoor activities.',
  'health.moderate.general': 'General Population - No need to modify usual outdoor activities unless symptoms occur.',
  'health.moderate.atRisk': 'At Risk - Consider reducing or rescheduling strenuous activities outdoors if symptoms occur.',
  'health.high.general': 'General Population - Consider reducing or rescheduling strenuous outdoor activities if symptoms occur.',
  'health.high.atRisk': 'At Risk - Reduce or reschedule strenuous outdoor activities. Children and the elderly should also take it easy.',
  'health.veryHigh.general': 'General Population - Reduce or reschedule strenuous outdoor activities.',
  'health.veryHigh.atRisk': 'At Risk - Avoid strenuous outdoor activities. Children and the elderly should also avoid outdoor physical exertion.',

  'smoke.modelled': 'Modelled Smoke',
  'smoke.visible': 'Visible Smoke',
  'smoke.density.light': 'Light',
  'smoke.density.medium': 'Medium',
  'smoke.density.heavy': 'Heavy',
  'smoke.tag': 'Smoke',

  'sidebar.wind': 'Global Wind Field',
  'sidebar.vectorWindBarbs': 'Vector Wind Barbs',
  'wind.tag': 'Wind',
  'wind.legend.title': 'Wind speed',
  'wind.legend.min': '0',
  'wind.legend.max': '24+ m/s',
  'windBarbs.legend.title': 'Wind barbs',
  'windBarbs.legend.calm': 'Calm',
  'windBarbs.legend.5kt': '5 kt',
  'windBarbs.legend.15kt': '15 kt',
  'windBarbs.legend.20kt': '20 kt',
  'windBarbs.legend.25kt': '25 kt',
  'windBarbs.legend.55kt': '55 kt',
  'windBarbs.legend.note': 'Barbs show wind speed in knots and rotate with wind direction.',

  'wms.modelledPm25': 'Modelled PM2.5',
  'wms.activeFires': 'Active Fires',
  'wms.firePerimeters': 'Fire Perimeters',
  'wms.fireDanger': 'Fire Danger',
  'wms.forecastZones': 'Forecast Zones',
  'wms.surfaceWinds': 'Surface Winds',
  'wms.tag': 'WMS',
  'overlay.raster': 'Raster',
  'overlay.vector': 'Vector',
  'overlay.deckgl': 'deck.gl',
  'debug.showMapState': 'Show map state',
  'debug.on': 'On',
  'debug.off': 'Off',
  'debug.zoom': 'Zoom',
  'debug.lng': 'Lng',
  'debug.lat': 'Lat',
  'debug.layers': 'Layers',
  'debug.sources': 'Sources',
  'debug.selected': 'Selected',
  'debug.renderModes': 'Render modes',
  'debug.wms': 'WMS',
  'debug.smoke': 'Smoke',
  'debug.deck': 'Deck',
  'legend.activeFires.current': 'Active fire',
  'legend.activeFires.hotspot': 'Hot spot detection',

  'export.png': 'PNG (map only)',
  'export.pngWithOverlays': 'PNG with overlays',
  'export.jpeg': 'JPEG',
  'export.pdf': 'PDF',
  'export.preparing': 'Preparing…',
  'export.failed': 'Export failed',

  'plot.noData': 'No plot data available',
  'plot.loading': 'Loading plot data…',
  'plot.yAxis': 'PM2.5 (µg m⁻³)',
  'plot.tooltipLabel': 'PM2.5',

  'popup.compare': 'Compare…',
  'popup.compare.internal': 'Internal Sensors',
  'popup.compare.fem': 'With Nearby FEM',
  'plot.ab.title': 'Internal sensor A/B comparison',
  'plot.ab.x': 'Channel B (µg m⁻³)',
  'plot.ab.y': 'Channel A (µg m⁻³)',
  'plot.ab.valid': 'Valid',
  'plot.ab.invalid': 'Invalid',
  'plot.fem.title': 'PurpleAir vs nearby FEM',
  'plot.fem.x': 'PurpleAir PM2.5 (µg m⁻³)',
  'plot.fem.y': 'FEM PM2.5 (µg m⁻³)',
  'plot.fem.raw': 'Raw PA',
  'plot.fem.corrected': 'Corrected PA',
  'plot.fem.comparedWith': 'Compared with {name} (FEM ~{dist} km away)',
  'plot.fem.none': 'No nearby FEM monitor available.',
}

const FR: StringMap = {
  'app.title': 'AQmap',
  'app.subtitle': 'Réimplémentation statique de la vue des moniteurs et superpositions AQmap.',
  'app.snapshot': 'Capture statique',
  'app.monitorData': 'Données des moniteurs :',
  'app.endpoints': 'points d’accès compatibles aqmap',
  'app.lastUpdated': 'Dernière mise à jour :',
  'app.latestObservation': 'Dernière observation :',
  'app.noTimestamp': 'Aucun horodatage',
  'map.legend': 'Légende',

  'sidebar.visible': 'Visibles',
  'sidebar.pm25Count': 'PM2,5',
  'sidebar.monitorLayers': 'Couches des moniteurs',
  'sidebar.overlays': 'Superpositions',
  'sidebar.wmsLegends': 'Légendes WMS',
  'sidebar.basemap': 'Fond de carte',
  'sidebar.basemap.light': 'Thème clair',
  'sidebar.basemap.topographic': 'Topographique',
  'sidebar.basemap.dark': 'Thème sombre',
  'sidebar.pm25Legend': 'Légende PM2,5',
  'sidebar.iconLegend': 'Légende des icônes',
  'sidebar.iconMode': 'Mode des icônes',
  'sidebar.featureDisplay': 'Affichage des détails (mobile)',
  'featureDisplay.card': 'Carte',
  'featureDisplay.popup': 'Infobulle',
  'sidebar.export': 'Exporter la carte',
  'sidebar.language': 'Langue',
  'sidebar.debug': 'Débogage',

  'controls.basemaps': 'Thèmes',
  'controls.layers': 'Couches',
  'controls.zoomToLocation': 'Zoomer sur votre position',
  'controls.resetView': 'Réinitialiser la vue',

  'groups.agency': 'Réglementaires',
  'groups.lcm': 'Faible coût',
  'groups.other': 'Autres réseaux',

  'sidebar.observationData': 'Données d’observation',
  'sidebar.modelEstimates': 'Estimations des modèles',
  'sidebar.satelliteData': 'Données satellites',
  'network.agency': 'Agence (FEM)',
  'network.purpleair': 'PurpleAir (PA)',
  'network.aqegg': 'AQ Egg (EGG)',
  'layer.surfaceWind': 'Vent de surface',
  'layer.surfacePm25': 'PM2,5 de surface',
  'layer.surfaceSmoke': 'Fumée de surface',

  'monitorType.fem': 'Réglementaires (FEM)',
  'monitorType.pa': 'PurpleAir (PA)',
  'monitorType.egg': 'AQegg (EGG)',
  'monitorType.missing': 'Aucune donnée récente',
  'icons.aqmap': 'AQMap',
  'icons.revealed': 'Révéler',
  'reveal.tuning': 'Réglage Révéler',
  'reveal.reset': 'Réinitialiser',
  'reveal.clusterColors': 'Couleurs des grappes',
  'clusterColors.classic': 'Classique',
  'clusterColors.slate': 'Gris-bleu',
  'reveal.clusterRadius': 'Rayon de regroupement',
  'reveal.clusterMaxZoom': 'Regrouper jusqu’au zoom',
  'reveal.tightPacking': 'Compactage serré (limite les bulles à la moitié du rayon, chevauchement quasi nul)',

  'aqhi.low': 'Faible',
  'aqhi.moderate': 'Modéré',
  'aqhi.high': 'Élevé',
  'aqhi.veryHigh': 'Très élevé',
  'aqhi.noData': 'Aucune donnée',
  'aqhi.unit': 'µg m⁻³',
  'aqhi.range.low': '0-29,9',
  'aqhi.range.moderate': '30-59,9',
  'aqhi.range.high': '60-99,9',
  'aqhi.range.veryHigh': '100+',

  'popup.monitor': 'moniteur',
  'popup.observedAsOf': 'PM₂,₅ observée à :',
  'popup.forecastZone': 'Zone de prévision',
  'popup.readings': 'Moyennes PM₂,₅',
  'popup.tenMinAvg': 'Moyenne 10 min',
  'popup.oneHourAvg': 'Moyenne 1 h',
  'popup.threeHourAvg': 'Moyenne 3 h',
  'popup.twentyFourHourAvg': 'Moyenne 24 h',
  'popup.tenMinTitle': 'Concentration moyenne de PM2,5 pour les 10 dernières minutes.',
  'popup.oneHourTitle': 'Concentration moyenne de PM2,5 pour la dernière heure.',
  'popup.threeHourTitle': 'Concentration moyenne de PM2,5 pour les 3 dernières heures.',
  'popup.twentyFourHourTitle': 'Concentration moyenne de PM2,5 pour les 24 dernières heures.',
  'popup.healthMessage': 'Messages de santé fondés sur le système CAS+.',
  'popup.plotButton': 'Tracer la série temporelle',
  'popup.plotSource.endpoint': '/data/plotting',
  'popup.plotSource.fallback': 'Données de repli',
  'popup.hourlyPm25': 'PM2,5 horaires',
  'popup.now': 'Maintenant',

  'health.heading.low': 'Moyenne horaire entre 0 et 29,9 µg m⁻³ (CAS+ faible) :',
  'health.heading.moderate': 'Moyenne horaire entre 30 et 59,9 µg m⁻³ (CAS+ modéré) :',
  'health.heading.high': 'Moyenne horaire entre 60 et 99,9 µg m⁻³ (CAS+ élevé) :',
  'health.heading.veryHigh': 'Moyenne horaire de 100+ µg m⁻³ (CAS+ très élevé) :',
  'health.heading.noData': 'Aucune moyenne horaire récente (CAS+ : aucune donnée) :',
  'health.noData': 'Les données de la dernière heure de ce moniteur sont manquantes.',
  'health.low.general': 'Population générale — air idéal pour les activités extérieures.',
  'health.low.atRisk': 'À risque — profitez des activités extérieures habituelles.',
  'health.moderate.general': 'Population générale — pas besoin de modifier les activités extérieures à moins de présenter des symptômes.',
  'health.moderate.atRisk': 'À risque — envisagez de réduire ou de reporter les activités intenses si des symptômes apparaissent.',
  'health.high.general': 'Population générale — envisagez de réduire ou de reporter les activités intenses si des symptômes apparaissent.',
  'health.high.atRisk': 'À risque — réduisez ou reportez les activités intenses. Les enfants et les personnes âgées devraient aussi y aller doucement.',
  'health.veryHigh.general': 'Population générale — réduisez ou reportez les activités intenses à l’extérieur.',
  'health.veryHigh.atRisk': 'À risque — évitez les activités intenses à l’extérieur. Les enfants et les personnes âgées devraient aussi éviter tout effort physique extérieur.',

  'smoke.modelled': 'Fumée modélisée',
  'smoke.visible': 'Fumée visible',
  'smoke.density.light': 'Faible',
  'smoke.density.medium': 'Moyen',
  'smoke.density.heavy': 'Haute',
  'smoke.tag': 'Fumée',

  'sidebar.wind': 'Champ de vent mondial',
  'sidebar.vectorWindBarbs': 'Barbules de vent vectorielles',
  'wind.tag': 'Vent',
  'wind.legend.title': 'Vitesse du vent',
  'wind.legend.min': '0',
  'wind.legend.max': '24+ m/s',
  'windBarbs.legend.title': 'Barbules de vent',
  'windBarbs.legend.calm': 'Calme',
  'windBarbs.legend.5kt': '5 kt',
  'windBarbs.legend.15kt': '15 kt',
  'windBarbs.legend.20kt': '20 kt',
  'windBarbs.legend.25kt': '25 kt',
  'windBarbs.legend.55kt': '55 kt',
  'windBarbs.legend.note': 'Les barbules indiquent la vitesse en noeuds et pivotent selon la direction du vent.',

  'wms.modelledPm25': 'PM2,5 modélisé',
  'wms.activeFires': 'Feux actifs',
  'wms.firePerimeters': 'Périmètres des feux',
  'wms.fireDanger': 'Danger d’incendie',
  'wms.forecastZones': 'Zones de prévision',
  'wms.surfaceWinds': 'Vents de surface',
  'wms.tag': 'WMS',
  'overlay.raster': 'Raster',
  'overlay.vector': 'Vecteur',
  'overlay.deckgl': 'deck.gl',
  'debug.showMapState': 'Afficher l’état de la carte',
  'debug.on': 'Activé',
  'debug.off': 'Désactivé',
  'debug.zoom': 'Zoom',
  'debug.lng': 'Lng',
  'debug.lat': 'Lat',
  'debug.layers': 'Couches',
  'debug.sources': 'Sources',
  'debug.selected': 'Sélection',
  'debug.renderModes': 'Modes de rendu',
  'debug.wms': 'WMS',
  'debug.smoke': 'Fumée',
  'debug.deck': 'Deck',
  'legend.activeFires.current': 'Feu actif',
  'legend.activeFires.hotspot': 'Point chaud détecté',

  'export.png': 'PNG (carte seule)',
  'export.pngWithOverlays': 'PNG avec habillage',
  'export.jpeg': 'JPEG',
  'export.pdf': 'PDF',
  'export.preparing': 'Préparation…',
  'export.failed': 'Échec de l’export',

  'plot.noData': 'Aucune donnée à tracer',
  'plot.loading': 'Chargement des données…',
  'plot.yAxis': 'PM2,5 (µg m⁻³)',
  'plot.tooltipLabel': 'PM2,5',

  'popup.compare': 'Comparer…',
  'popup.compare.internal': 'Capteurs internes',
  'popup.compare.fem': 'Avec FEM à proximité',
  'plot.ab.title': 'Comparaison des capteurs internes A/B',
  'plot.ab.x': 'Canal B (µg m⁻³)',
  'plot.ab.y': 'Canal A (µg m⁻³)',
  'plot.ab.valid': 'Valides',
  'plot.ab.invalid': 'Non valides',
  'plot.fem.title': 'PurpleAir vs FEM à proximité',
  'plot.fem.x': 'PM2,5 PurpleAir (µg m⁻³)',
  'plot.fem.y': 'PM2,5 FEM (µg m⁻³)',
  'plot.fem.raw': 'PA brute',
  'plot.fem.corrected': 'PA corrigée',
  'plot.fem.comparedWith': 'Comparé avec {name} (FEM à ~{dist} km)',
  'plot.fem.none': 'Aucun moniteur FEM à proximité.',
}

const STRINGS: Record<AqmapLocale, StringMap> = { en: EN, fr: FR }

export function translate(key: string, locale: AqmapLocale): string {
  return STRINGS[locale][key] ?? STRINGS.en[key] ?? key
}

const TIMESTAMP_LOCALE: Record<AqmapLocale, string> = {
  en: 'en-CA',
  fr: 'fr-CA',
}

export function formatLocalizedDate(value: string | null | undefined, locale: AqmapLocale): string {
  if (!value) return translate('app.noTimestamp', locale)
  const parsed = new Date(value.replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat(TIMESTAMP_LOCALE[locale], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(parsed)
}

export function formatGroupLabel(group: 'agency' | 'lcm' | 'other', locale: AqmapLocale): string {
  if (group === 'agency') return translate('groups.agency', locale)
  if (group === 'lcm') return translate('groups.lcm', locale)
  return translate('groups.other', locale)
}

export function formatNetworkLabel(network: 'agency' | 'purpleair' | 'aqegg' | 'other', locale: AqmapLocale): string {
  if (network === 'agency') return translate('network.agency', locale)
  if (network === 'purpleair') return translate('network.purpleair', locale)
  if (network === 'aqegg') return translate('network.aqegg', locale)
  return translate('groups.other', locale)
}

export function formatAqhiCategory(category: string, locale: AqmapLocale): string {
  if (category === 'Low') return translate('aqhi.low', locale)
  if (category === 'Moderate') return translate('aqhi.moderate', locale)
  if (category === 'High') return translate('aqhi.high', locale)
  if (category === 'Very High') return translate('aqhi.veryHigh', locale)
  return translate('aqhi.noData', locale)
}

const HEALTH_HEADING: Record<string, string> = {
  Low: 'health.heading.low',
  Moderate: 'health.heading.moderate',
  High: 'health.heading.high',
  'Very High': 'health.heading.veryHigh',
  'No Data': 'health.heading.noData',
}

const HEALTH_GENERAL: Record<string, string> = {
  Low: 'health.low.general',
  Moderate: 'health.moderate.general',
  High: 'health.high.general',
  'Very High': 'health.veryHigh.general',
}

const HEALTH_AT_RISK: Record<string, string> = {
  Low: 'health.low.atRisk',
  Moderate: 'health.moderate.atRisk',
  High: 'health.high.atRisk',
  'Very High': 'health.veryHigh.atRisk',
}

export interface LocalizedHealthMessage {
  heading: string
  lines: string[]
}

export function localizeHealthMessage(category: string, locale: AqmapLocale): LocalizedHealthMessage {
  const headingKey = HEALTH_HEADING[category] ?? HEALTH_HEADING['No Data']
  if (category === 'No Data') {
    return {
      heading: translate(headingKey, locale),
      lines: [translate('health.noData', locale)],
    }
  }
  return {
    heading: translate(headingKey, locale),
    lines: [
      translate(HEALTH_GENERAL[category] ?? 'health.low.general', locale),
      translate(HEALTH_AT_RISK[category] ?? 'health.low.atRisk', locale),
    ],
  }
}

export function localizeMonitorType(network: string, locale: AqmapLocale): string {
  if (network === 'PA') return translate('monitorType.pa', locale)
  if (network === 'EGG') return translate('monitorType.egg', locale)
  if (network === 'FEM' || network === 'BC ENV') return translate('monitorType.fem', locale)
  return network
}

export function localizeWmsLabel(key: string, locale: AqmapLocale): string {
  return translate(`wms.${key}`, locale)
}

export function localizeSmokeLabel(key: 'modelledSmoke' | 'visibleSmoke', locale: AqmapLocale): string {
  return key === 'modelledSmoke'
    ? translate('smoke.modelled', locale)
    : translate('smoke.visible', locale)
}

export function localizeSmokeDensity(label: string, locale: AqmapLocale): string {
  const normalized = label.toLowerCase()
  if (normalized.startsWith('light') || normalized.startsWith('faible')) return translate('smoke.density.light', locale)
  if (normalized.startsWith('medium') || normalized.startsWith('moyen')) return translate('smoke.density.medium', locale)
  if (normalized.startsWith('heavy') || normalized.startsWith('haute')) return translate('smoke.density.heavy', locale)
  return label
}

export interface LocalizedObservationRow {
  key: string
  label: string
  title: string
}

export function buildObservationRowLabels(locale: AqmapLocale): LocalizedObservationRow[] {
  return [
    { key: 'pm25_10min', label: translate('popup.tenMinAvg', locale), title: translate('popup.tenMinTitle', locale) },
    { key: 'pm25_1hr', label: translate('popup.oneHourAvg', locale), title: translate('popup.oneHourTitle', locale) },
    { key: 'pm25_3hr', label: translate('popup.threeHourAvg', locale), title: translate('popup.threeHourTitle', locale) },
    { key: 'pm25_24hr', label: translate('popup.twentyFourHourAvg', locale), title: translate('popup.twentyFourHourTitle', locale) },
  ]
}

export function formatAqmapPm25Localized(value: number | null, locale: AqmapLocale): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  if (value < 0) return '-'
  const formatter = new Intl.NumberFormat(TIMESTAMP_LOCALE[locale], {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  return formatter.format(value)
}
