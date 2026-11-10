// Decodes the published 1 m DTM and DSM GeoTIFFs into raw Float32 arrays for build_kit.py.
// Usage: node scripts/forestry/tutorial-kit/dump.mjs <dir with dtm-1m.tif and dsm-1m.tif> <output dir>
import { fromFile } from 'geotiff'
import fs from 'node:fs'

const [, , src, out] = process.argv
if (!src || !out) {
  console.error('Usage: node dump.mjs <source dir> <output dir>')
  process.exit(1)
}
for (const name of ['dtm-1m', 'dsm-1m']) {
  const tiff = await fromFile(`${src}/${name}.tif`)
  const image = await tiff.getImage()
  const [data] = await image.readRasters()
  const meta = {
    width: image.getWidth(),
    height: image.getHeight(),
    origin: image.getOrigin(),
    resolution: image.getResolution(),
    nodata: image.getGDALNoData(),
    bbox: image.getBoundingBox(),
    geoKeys: image.getGeoKeys(),
  }
  fs.writeFileSync(`${out}/${name}.f32`, Buffer.from(new Float32Array(data).buffer))
  fs.writeFileSync(`${out}/${name}.json`, JSON.stringify(meta, null, 1))
  console.log(name, meta.width, 'x', meta.height, meta.bbox.join(', '))
}
