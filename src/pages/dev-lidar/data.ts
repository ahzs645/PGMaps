export const LIDAR_TILE = {
  name: 'BC 093G086 · LiDAR',
  filename: 'bc_093g086_4_4_4_xyes_8_utm10_20240713_20240713.laz',
  sourceUrl: 'https://drive.google.com/file/d/12HM0-w7PNe_cC1t-ThLrFoBZngr4jgfI/view',
  points: 84_608_005,
  bytes: 550_572_701,
  elevation: [589.95, 864.47],
  crs: 'NAD83(CSRS) / UTM zone 10N',
  verticalDatum: 'CGVD2013 (CGG2013)',
  basePath: `${import.meta.env.BASE_URL}data/lidar/bc-093g086/`,
} as const

export type LidarEngine = 'geolibre' | 'rustgis'

/** Use absolute dataset URLs: the viewers run on a different origin. */
export function lidarViewerUrl(engine: LidarEngine, origin: string, theme: string) {
  const data = new URL(LIDAR_TILE.basePath, origin)
  if (engine === 'rustgis') {
    const url = new URL('https://web.rustgis.app/')
    url.searchParams.set('blank', '1')
    url.searchParams.set('embed', '1')
    url.searchParams.set('data', new URL('overview.laz', data).href)
    return url.href
  }
  const url = new URL('https://web.geolibre.app/')
  url.searchParams.set('data', new URL('ept.json', data).href)
  url.searchParams.set('layout', 'compact')
  url.searchParams.set('welcome', '0')
  url.searchParams.set('theme', theme === 'dark' ? 'dark' : 'light')
  return url.href
}
