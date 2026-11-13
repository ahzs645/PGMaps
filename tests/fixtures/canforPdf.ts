import { PDFDocument, PDFName, PDFString, PDFOperator, PDFOperatorNames, rgb, StandardFonts } from 'pdf-lib'
import { encode } from 'fast-png'
import proj4 from 'proj4'
import { CANFOR_RASTERS } from '../../src/lib/geoPdf/rasterProfiles'

/** Synthetic geometry and template vocabulary only; no company plan or map artwork. */
export async function canforPdfFixture(
  options: { registered?: boolean; supported?: boolean; raster?: 'slope' | 'canopy'; legend?: boolean } = {},
) {
  const pdf = await PDFDocument.create()
  pdf.setCreator('Esri ArcGISPro synthetic test')
  const page = pdf.addPage([340, 240])
  const names = [
    'Blocks - 0k - 25k',
    'ROAD: Roads - 0k - 250k',
    'Roads - 0k - 25k',
    'Streams - 0k - 25k',
    'SU: Reserves (Solid Green) - 0k - 75k',
  ]
  const profile = CANFOR_RASTERS.find((p) => p.kind === options.raster)
  if (profile) names.push(profile.layer)
  if (profile?.overlay) names.push(profile.overlay.layer)
  const groups = names.map((name) =>
    pdf.context.register(
      pdf.context.obj({ Type: 'OCG', Name: PDFString.of(options.supported === false ? 'Unknown layer' : name) }),
    ),
  )
  pdf.catalog.set(PDFName.of('OCProperties'), pdf.context.obj({ OCGs: groups, D: { Order: groups, ON: groups } }))
  page.node.set(
    PDFName.of('Resources'),
    pdf.context.obj({ Properties: Object.fromEntries(groups.map((ref, i) => [`L${i}`, ref])) }),
  )
  page.node.addContentStream(
    pdf.context.register(
      pdf.context.flateStream(
        [
          '/OC /L0 BDC 0 0 0 RG 40 40 120 120 re S EMC',
          '/OC /L2 BDC 0 0 0 RG 10 110 m 230 110 l S EMC',
          // Compound linework with a separate legend sample outside the registered map.
          '/OC /L3 BDC 0 0 1 RG 60 60 m 80 90 l 110 120 l 130 80 m 170 100 l S 225 225 m 240 235 l S EMC',
          '/OC /L4 BDC 0 1 0 rg 80 80 60 60 re 95 95 20 20 re f* EMC',
        ].join('\n'),
      ),
    ),
  )
  if (profile) {
    const colors =
      profile.kind === 'canopy'
        ? [
            [255, 127, 127],
            [76, 230, 1],
            [38, 115, 0],
            [190, 255, 232],
            [0, 169, 231],
            [232, 190, 255],
            [169, 0, 231],
            [0, 0, 0],
          ]
        : [
            [255, 255, 115],
            [163, 255, 115],
            [115, 223, 255],
            [223, 115, 255],
            [255, 170, 0],
            [255, 127, 127],
            [232, 21, 21],
            [0, 0, 0],
          ]
    const data = new Uint8Array(4 * 4 * 4)
    for (let i = 0; i < 16; i++) {
      const c = profile.overlay && i % 8 === 7 ? [255, 0, 0] : colors[i % 8]
      data.set([...c, profile.alpha], i * 4)
    }
    data[8 * 4 + 3] = 0 // No mapped class, not a below-range class.
    data.set([100, 100, 100, profile.alpha], 9 * 4) // Reject a colour absent from the legend.
    data[10 * 4 + 3] = 100 // Unexpected alpha stays unknown.
    const image = await pdf.embedPng(encode({ width: 4, height: 4, data, channels: 4 }))
    page.pushOperators(
      PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of('OC'), PDFName.of('L5')]),
    )
    page.drawImage(image, { x: 20, y: 20, width: 180, height: 180 })
    page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent))
    if (profile.overlay) {
      const mask = new Uint8Array(4 * 4 * 4)
      mask[7 * 4 + 3] = 255
      mask[15 * 4 + 3] = 255
      const overlay = await pdf.embedPng(encode({ width: 4, height: 4, data: mask, channels: 4 }))
      page.pushOperators(
        PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of('OC'), PDFName.of('L6')]),
      )
      page.drawImage(overlay, { x: 20, y: 20, width: 180, height: 180 })
      page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent))
    }
    if (options.legend !== false) {
      const font = await pdf.embedFont(StandardFonts.Helvetica)
      page.drawText(profile.heading, { x: 210, y: 205, size: 8, font })
      profile.classes.forEach((c, i) => {
        const y = 185 - i * 17
        page.drawRectangle({
          x: 210,
          y,
          width: 12,
          height: 8,
          color: rgb(colors[i][0] / 255, colors[i][1] / 255, colors[i][2] / 255),
        })
        page.drawText(c.label, { x: 225, y, size: 7, font })
      })
    }
  }
  if (options.registered !== false) {
    const wkt =
      'PROJCS["NAD83 / BC Albers",GEOGCS["NAD83",DATUM["North_American_Datum_1983",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Albers_Conic_Equal_Area"],PARAMETER["standard_parallel_1",50],PARAMETER["standard_parallel_2",58.5],PARAMETER["latitude_of_center",45],PARAMETER["longitude_of_center",-126],PARAMETER["false_easting",1000000],PARAMETER["false_northing",0],UNIT["metre",1]]'
    const projected = proj4(wkt, 'EPSG:4326')
    const world = [
      [1291000, 1015000],
      [1291000, 1016800],
      [1292800, 1016800],
      [1292800, 1015000],
    ].flatMap((xy) => {
      const [lon, lat] = projected.forward(xy)
      return [lat, lon]
    })
    page.node.set(
      PDFName.of('VP'),
      pdf.context.obj([
        {
          Type: 'Viewport',
          BBox: [20, 20, 200, 200],
          Measure: {
            Type: 'Measure',
            Subtype: 'GEO',
            Bounds: [0, 0, 0, 1, 1, 1, 1, 0],
            LPTS: [0, 0, 0, 1, 1, 1, 1, 0],
            GPTS: world,
            GCS: { Type: 'PROJCS', WKT: PDFString.of(wkt) },
          },
        },
      ]),
    )
  }
  return pdf.save()
}
