import { describe, expect, it } from 'vitest'
import proj4 from 'proj4'
import { PDFDocument } from 'pdf-lib'
import { projectedInMetres, readMapFrames } from './georeference'
import { addMapViewports, WEB_MERCATOR_WKT } from './writeViewport'

const mercator = proj4('EPSG:3857', 'EPSG:4326')
/** GDAL's EPSG:3857 WKT: its UNIT is followed by AXIS, EXTENSION and AUTHORITY clauses. */
const GDAL_3857 =
  'PROJCS["WGS 84 / Pseudo-Mercator",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]],PROJECTION["Mercator_1SP"],PARAMETER["central_meridian",0],PARAMETER["scale_factor",1],PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Easting",EAST],AXIS["Northing",NORTH],EXTENSION["PROJ4","+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs"],AUTHORITY["EPSG","3857"]]'

/** A Web Mercator frame near Prince George, 2.4 km by 1.6 km, as a north-up map image draws it. */
const west = -13_672_000,
  east = west + 2_400,
  south = 7_170_000,
  north = south + 1_600
const lonLat = (x: number, y: number) => mercator.forward([x, y]) as [number, number]
const corners: [[number, number], [number, number], [number, number], [number, number]] = [
  lonLat(west, north),
  lonLat(east, north),
  lonLat(east, south),
  lonLat(west, south),
]

async function sheet(wkt: string) {
  const pdf = await PDFDocument.create()
  pdf.addPage([842, 595])
  return addMapViewports(await pdf.save(), [{ page: 0, bbox: [40, 60, 802, 568], corners, wkt }])
}

describe('geospatial PDF map frame', () => {
  it('places interior points of the frame within a millimetre of Web Mercator', async () => {
    const { frames } = await readMapFrames(await sheet(WEB_MERCATOR_WKT))
    expect(frames).toHaveLength(1)
    expect(frames[0].registrationErrorM).toBeLessThan(0.001)
    for (const [u, v] of [
      [0.25, 0.3],
      [0.5, 0.5],
      [0.8, 0.9],
    ]) {
      const page: [number, number] = [40 + u * 762, 60 + v * 508]
      const expected = mercator.inverse(lonLat(west + u * 2_400, south + v * 1_600))
      const got = mercator.inverse(frames[0].toWorld(page))
      expect(Math.hypot(got[0] - expected[0], got[1] - expected[1])).toBeLessThan(0.001)
    }
  })

  it("reads GDAL's Web Mercator WKT, whose unit is not the last clause, and refuses feet", async () => {
    expect(projectedInMetres(GDAL_3857)).toBe(true)
    const { frames } = await readMapFrames(await sheet(GDAL_3857))
    expect(frames[0].registrationErrorM).toBeLessThan(0.001)
    expect(
      projectedInMetres(
        'PROJCS["NAD83 / BC Albers (ftUS)",GEOGCS["NAD83",DATUM["North_American_Datum_1983",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Albers_Conic_Equal_Area"],PARAMETER["standard_parallel_1",50],PARAMETER["standard_parallel_2",58.5],PARAMETER["latitude_of_center",45],PARAMETER["longitude_of_center",-126],PARAMETER["false_easting",3280833.333],PARAMETER["false_northing",0],UNIT["US survey foot",0.304800609601219]]',
      ),
    ).toBe(false)
  })

  it('refuses a frame with no area or corners off the map', async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage([200, 200])
    const bytes = await pdf.save()
    await expect(
      addMapViewports(bytes, [{ page: 0, bbox: [10, 10, 10, 50], corners, wkt: WEB_MERCATOR_WKT }]),
    ).rejects.toThrow(/rectangle/)
    await expect(
      addMapViewports(bytes, [
        {
          page: 0,
          bbox: [10, 10, 50, 50],
          corners: [corners[0], corners[1], corners[2], [0, 89]],
          wkt: WEB_MERCATOR_WKT,
        },
      ]),
    ).rejects.toThrow(/geographic corners/)
  })
})
