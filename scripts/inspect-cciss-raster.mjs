import { fromFile } from 'geotiff'

const [file, latitudeText, longitudeText] = process.argv.slice(2)
const latitude = Number(latitudeText)
const longitude = Number(longitudeText)

if (!file || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
  console.error('Usage: node scripts/inspect-cciss-raster.mjs <GeoTIFF> <latitude> <longitude>')
  process.exit(1)
}

const tiff = await fromFile(file)

try {
  const image = await tiff.getImage()
  if (image.getGeoKeys().GeographicTypeGeoKey !== 4326) {
    throw new Error('Expected a CCISS raster in EPSG:4326')
  }
  const [west, north] = image.getOrigin()
  const [xResolution, yResolution] = image.getResolution()

  if (!Number.isFinite(xResolution) || !Number.isFinite(yResolution) || xResolution <= 0 || yResolution >= 0) {
    throw new Error('Expected a north-up CCISS raster in longitude/latitude coordinates')
  }

  const column = Math.floor((longitude - west) / xResolution)
  const row = Math.floor((latitude - north) / yResolution)
  const inside = column >= 0 && row >= 0 && column < image.getWidth() && row < image.getHeight()
  const noData = image.getGDALNoData()
  const values = inside
    ? await image.readRasters({ samples: [0], window: [column, row, column + 1, row + 1] })
    : null
  const rawValue = values?.[0]?.[0] ?? null

  console.log(JSON.stringify({
    file,
    latitude,
    longitude,
    column: inside ? column : null,
    row: inside ? row : null,
    value: rawValue === noData ? null : rawValue,
    noData: !inside || rawValue === noData,
  }, null, 2))
} finally {
  await tiff.close()
}
