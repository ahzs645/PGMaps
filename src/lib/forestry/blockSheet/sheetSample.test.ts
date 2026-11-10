/**
 * Builds every sheet preset as a real PDF from a synthetic block and terrain. With
 * `BLOCK_SHEET_SAMPLE_DIR` set, the PDFs are written there for a visual check
 * (render them with `pdftoppm -png -r 60`); otherwise only their structure is checked.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { GState, jsPDF } from 'jspdf'
import { describe, expect, it } from 'vitest'
import { encodeSheetImages } from '@/lib/mapSheet/png'
import { createSheetPdf, drawSheetPdf } from '@/lib/mapSheet/renderPdf'
import { sheetSvg } from '@/lib/mapSheet/renderSvg'
import { blockFacts } from './blockFacts'
import { composeSheet, sheetFocus, sheetFrame } from './composeSheet'
import { prepareSheetTerrainNow } from './prepareSheet'
import { sampleLayers, syntheticCanopy, syntheticTerrain } from './blockSheetFixtures'
import { SHEET_KINDS, IMAGERY_BASEMAP } from './sheets'

const issue = { date: '2026-11-10', preparedBy: 'J. Planner', organisation: 'Example Forest Co.', revision: 'A' }
const fields = {
  forestLicence: 'A00000',
  cuttingPermit: '101',
  blockId: 'BLK-001',
  operatingArea: 'North Slope',
  timbermark: 'XY1234',
}

function imageryStandIn(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const x = i % width,
      y = Math.floor(i / width)
    const v = 40 + 25 * Math.sin(x / 7) * Math.cos(y / 9) + ((x * 13 + y * 7) % 17)
    data.set([v * 0.6, v * 1.1, v * 0.55, 255], i * 4)
  }
  return { kind: 'rgba' as const, data, width, height }
}

describe('block sheet samples', () => {
  it('builds every preset as a PDF with its own legend', { timeout: 120_000 }, async () => {
    const out = process.env.BLOCK_SHEET_SAMPLE_DIR
    if (out) mkdirSync(out, { recursive: true })
    const facts = blockFacts(sampleLayers.block!.geometry, { source: syntheticTerrain, spacingM: 5 })
    for (const kind of SHEET_KINDS) {
      const frame = sheetFrame(kind, 'tabloid', kind === 'general-access' ? 50000 : 10000, {
        bounds: sheetFocus(sampleLayers)!,
      })
      const products = prepareSheetTerrainNow(
        frame,
        { terrain: syntheticTerrain, canopy: syntheticCanopy },
        out ? 150 : 30,
      )
      const base =
        frame.preset.base === 'imagery'
          ? { image: imageryStandIn(300, 330), attribution: IMAGERY_BASEMAP.attribution }
          : products.base
      const sheet = composeSheet({
        frame,
        layers: sampleLayers,
        base,
        contours: products.contours,
        facts,
        terrainName: 'Synthetic terrain',
        fields,
        issue,
        comments:
          kind === 'general-access'
            ? 'From the highway, take the Sample FSR east for 12 km. Turn right at km 12 onto Spur A; the block starts 800 m up the spur.'
            : undefined,
        sourceLine: 'Slope from synthetic terrain, 1.2 m grid; contours 10 m',
        caveat: 'Preliminary planning, not for construction',
      })
      expect(sheet.legend.some((item) => item.key === 'block')).toBe(true)
      const pdf = createSheetPdf({ jsPDF, GState }, sheet.width, sheet.height)
      const ops = await encodeSheetImages(sheet.ops)
      drawSheetPdf(pdf, { jsPDF, GState }, ops)
      const bytes = pdf.output('arraybuffer')
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
      expect(sheetSvg(ops, sheet.width, sheet.height)).toContain('<svg')
      if (out) writeFileSync(path.join(out, `${kind}.pdf`), Buffer.from(bytes))
    }
  })
})
