import type { MapFeatureTableLabels } from '@/components/map/MapFeatureTable'
import { dateColumn, numberColumn, textColumn } from '@/components/map/tableColumns'
import type { AirMonitor } from '@/maps/airquality'
import {
  getAqhiCategory,
  getMonitorAqhiPm25,
  isFemMonitor,
  parseObservedDate,
} from '@/maps/airquality/lib/monitorPopup'
import {
  buildObservationRowLabels,
  formatAqhiCategory,
  formatAqmapPm25Localized,
  formatLocalizedDate,
  localizeMonitorType,
  translate,
  type AqmapLocale,
} from './i18n'

/** PM2.5 readings in the popup's own order; FEM monitors report no 10-minute average. */
const READINGS: Record<string, (monitor: AirMonitor) => number | null | undefined> = {
  pm25_10min: (monitor) => (isFemMonitor(monitor) ? null : monitor.pm25Recent),
  pm25_1hr: (monitor) => monitor.pm25OneHour,
  pm25_3hr: (monitor) => monitor.pm25ThreeHour,
  pm25_24hr: (monitor) => monitor.pm25TwentyFourHour,
}

/** The table's own words, in the page's language. */
export function aqTableLabels(locale: AqmapLocale): MapFeatureTableLabels {
  const word = (key: string) => translate(`table.${key}`, locale)
  const rows = (count: string) => `${count} ${word(count === '1' ? 'rowOne' : 'rowMany')}`
  return {
    all: word('all'),
    visible: word('visible'),
    rows,
    shownOf: (shown, total) => `${shown} ${word('of')} ${total}`,
    search: word('search'),
    searchPlaceholder: word('searchPlaceholder'),
    options: word('options'),
    downloadCsv: (count) => `${word('download')} (${rows(count)})`,
    columns: word('columns'),
    sortAscending: word('sortAscending'),
    sortDescending: word('sortDescending'),
    resetSort: word('resetSort'),
    columnStats: word('columnStats'),
    columnOptions: (column) =>
      locale === 'fr' ? `${word('columnOptions')} ${column}` : `${column} ${word('columnOptions')}`,
    close: word('close'),
    expand: word('expand'),
    collapse: word('collapse'),
    loading: word('loading'),
    loadFailed: word('loadFailed'),
    noRows: word('empty'),
    noRowsInView: word('noRowsInView'),
    locale: locale === 'fr' ? 'fr-CA' : 'en-CA',
  }
}

export function aqMonitorColumns(locale: AqmapLocale) {
  const unit = translate('aqhi.unit', locale)
  return [
    textColumn<AirMonitor>('name', translate('table.name', locale), (monitor) => monitor.name, { width: 240 }),
    textColumn<AirMonitor>('type', translate('table.network', locale), (monitor) =>
      localizeMonitorType(monitor.network, locale),
    ),
    textColumn<AirMonitor>(
      'aqhi',
      translate('table.aqhi', locale),
      (monitor) => formatAqhiCategory(getAqhiCategory(getMonitorAqhiPm25(monitor)), locale),
      { width: 120 },
    ),
    ...buildObservationRowLabels(locale).map(({ key, label }) =>
      numberColumn<AirMonitor>(key, `${label} (${unit})`, READINGS[key], {
        format: (value) => formatAqmapPm25Localized(value, locale),
        width: 170,
      }),
    ),
    textColumn<AirMonitor>('zone', translate('popup.forecastZone', locale), (monitor) => monitor.forecastZoneName),
    {
      ...dateColumn<AirMonitor>(
        'observed',
        translate('table.observed', locale),
        (monitor) => parseObservedDate(monitor.dateObserved),
        { width: 190 },
      ),
      getValue: (monitor: AirMonitor) => formatLocalizedDate(monitor.dateObserved, locale),
    },
  ]
}
