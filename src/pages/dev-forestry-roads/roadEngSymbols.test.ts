import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parseSymbolStyle } from '@/lib/mapSheet/symbolStyle'
import {
  colorRefFromHex,
  formatRoadEngFormat,
  hexFromColorRef,
  parseRoadEngFormat,
  parseRoadEngFormatChunk,
  parseRoadEngLabelFormat,
  patchRoadEngFormatChunk,
  readRoadEngIniEntries,
  readRoadEngIniStyles,
  rgbFromColorRef,
  roadEngFeatureLook,
  roadEngFormatWithStyle,
  roadEngLineTypeStyle,
  roadEngLookFromStyle,
  roadEngReferenceLayers,
  roadEngSymbolStyle,
  ROADENG_LAYER_FOLDER,
  setRoadEngIniValue,
} from './roadEngSymbols'
import {
  decodeRoadEngLineItem,
  decodeRoadEngLineTypes,
  decodeRoadEngSymbolItem,
  decodeRoadEngSymbols,
  decodeRoadEngTextItem,
  encodeRoadEngLineItem,
  encodeRoadEngSymbolItem,
  encodeRoadEngTextItem,
  extractRoadEngTableTexts,
  isRoadEngSymbolFile,
  parseRoadEngTableText,
  readRoadEngSymbolFile,
  roadEngLineTypeAt,
  roadEngSymbolDrawing,
  roadEngTableBytes,
  writeRoadEngTableText,
  type RoadEngLineTypeTable,
  type RoadEngSymbol,
  type RoadEngTableNode,
} from './roadEngSymbolTables'

// ---------------------------------------------------------------------------------------------
// Synthetic tables: made up here, in the file's grammar, not copied from any Softree table.

const zeros = (n: number) => new Array<number>(n).fill(0)
/** A line item: width in 1/10 mm, offset and dash/gap lengths in 1/100 mm. */
const lineItem = (width: number, offset = 0, dashes: [number, number][] = []) => {
  const v = [width, offset, dashes.length, 0, 0, ...zeros(20)]
  dashes.forEach(([on, off], i) => {
    v[5 + i] = on
    v[15 + i] = off
  })
  return v.join(',')
}
const userLine = (k: number, desc: string, items: string[]) => [
  `<USER${k}>`,
  '<COLOR>0</COLOR>',
  '<WIDTH>1</WIDTH>',
  `<DESC>${desc}</DESC>`,
  ...items,
  `</USER${k}>`,
]

const LINE_TABLE = [
  '<LINETYPETABLE>',
  '<USERLINES>6</USERLINES>',
  '<SYSTEMLINES>1</SYSTEMLINES>',
  '<SYSTEM0>',
  '<COLOR>0</COLOR>',
  '<DESC>plain</DESC>',
  `<LINEITEM0>${lineItem(2)}</LINEITEM0>`,
  '</SYSTEM0>',
  ...userLine(0, 'Thin', [`<LINEITEM0>${lineItem(1)}</LINEITEM0>`]),
  ...userLine(1, 'Heavy', [`<LINEITEM0>${lineItem(8)}</LINEITEM0>`]),
  ...userLine(2, 'Broken', [`<LINEITEM0>${lineItem(3, 0, [[250, 150]])}</LINEITEM0>`]),
  ...userLine(3, 'Twin rails', [
    `<LINEITEM0>${lineItem(2, 60)}</LINEITEM0>`,
    `<LINEITEM1>${lineItem(2, -60)}</LINEITEM1>`,
  ]),
  ...userLine(4, 'Flow arrows', [
    `<LINEITEM0>${lineItem(2)}</LINEITEM0>`,
    '<SYMBOLITEM0>B1,1,0,1200,0.5,0,0,4,0,0,0,-300,120,1,-300,-120,1,0,0,1</SYMBOLITEM0>',
  ]),
  ...userLine(5, 'Labelled, with text', [
    `<LINEITEM0>${lineItem(2, 0, [[400, 300]])}</LINEITEM0>`,
    '<TEXTITEM0>0.5,1800,1,1500,0.6,-80,A, B</TEXTITEM0>',
  ]),
  '</LINETYPETABLE>',
  '',
].join('\r\n')

const SYMBOL_TABLE = [
  '<SYMBOLTABLE>',
  '<NSYMBOLS>2</NSYMBOLS>',
  '<SYMBOL0>',
  '<COLOR>0</COLOR>',
  '<SCALE>1</SCALE>',
  '<DESC>Square marker</DESC>',
  '<SYMBOLITEM0>B2,1,1,1000,0,0,5,5,-50,50,0,50,50,1,50,-50,1,-50,-50,1,-50,50,1</SYMBOLITEM0>',
  '</SYMBOL0>',
  '<SYMBOL1>',
  '<COLOR>0</COLOR>',
  '<SCALE>1</SCALE>',
  '<DESC>Old bridge</DESC>',
  '<LFFACE>Arial</LFFACE>',
  '<LFHEIG>-20</LFHEIG>',
  '<SYMBOLITEM0>B1,0,1,1000,0,0,1,4,-200,40,0,200,40,1,-200,-40,0,200,-40,1</SYMBOLITEM0>',
  '<TEXTITEM0>1,0,1,0,0,0,b</TEXTITEM0>',
  '</SYMBOL1>',
  '</SYMBOLTABLE>',
  '',
].join('\r\n')

/** A stand-in drawing: the version, filler, then each table as an XRECORD's 310 chunks. */
function synthDrawing(texts: string[], shift = 0): Uint8Array {
  const out: number[] = [...'AC1014'].map((c) => c.charCodeAt(0))
  for (let i = 0; i < 300; i++) out.push((i * 37) & 0xff)
  for (const text of texts) {
    out.push(0x00, 0x00) // stands in for the XRECORD's own fields
    const bytes = roadEngTableBytes(text)
    for (let at = 0; at < bytes.length; at += 127) {
      const part = bytes.subarray(at, at + 127)
      out.push(0x36, 0x01, part.length, ...part)
    }
    out.push(0x00, 0x00, 0x46, 0x01) // the next group code
  }
  const bytes = Uint8Array.from(out)
  if (!shift) return bytes
  // The same stream starting `shift` bits later, as a DWG object that is not byte-aligned would.
  const moved = new Uint8Array(bytes.length + 1)
  moved.set(bytes.subarray(0, 6))
  for (let i = 6; i < bytes.length; i++) {
    moved[i] |= bytes[i] >> shift
    moved[i + 1] |= (bytes[i] << (8 - shift)) & 0xff
  }
  return moved
}

const lineTable = () => decodeRoadEngLineTypes(parseRoadEngTableText(LINE_TABLE))
const symbolTable = () => decodeRoadEngSymbols(parseRoadEngTableText(SYMBOL_TABLE))
const tables = () => ({ lineTypes: lineTable(), symbols: symbolTable() })

describe('RoadEng symbol files', () => {
  it('finds both tables in the drawing at any bit alignment', () => {
    for (const shift of [0, 3, 7]) {
      const texts = extractRoadEngTableTexts(synthDrawing([LINE_TABLE, SYMBOL_TABLE], shift))
      expect(texts.version).toBe('AC1014')
      expect(texts.lineTypes).toBe(LINE_TABLE)
      expect(texts.symbols).toBe(SYMBOL_TABLE)
      expect(texts.warnings).toEqual([])
    }
  })

  it('says which table is missing and refuses other files', () => {
    const texts = extractRoadEngTableTexts(synthDrawing([SYMBOL_TABLE]))
    expect(texts.lineTypes).toBeNull()
    expect(texts.warnings).toEqual(['The file holds no line-type table.'])
    expect(isRoadEngSymbolFile(new TextEncoder().encode('AC1032'))).toBe(false)
    expect(() => extractRoadEngTableTexts(new TextEncoder().encode('PK\x03\x04'))).toThrow(/not a RoadEng symbol file/)
  })

  it('reads the tag text as a tree and writes the same bytes back', () => {
    for (const text of [LINE_TABLE, SYMBOL_TABLE, LINE_TABLE.replace(/\r\n/g, '\n')])
      expect(writeRoadEngTableText(parseRoadEngTableText(text))).toBe(text)
    const tree = parseRoadEngTableText(SYMBOL_TABLE)
    const desc = (tree.root.children[1] as { children: RoadEngTableNode[] }).children.find((c) => c.tag === 'DESC')
    expect(desc).toEqual({ tag: 'DESC', value: 'Square marker' })
    expect(() => parseRoadEngTableText('<A>\r\n<B>1</C>\r\n</A>\r\n')).toThrow(/line 2/)
    expect(() => parseRoadEngTableText('<A>\r\n<B>1</B>\r\n')).toThrow(/not closed/)
    expect(() => parseRoadEngTableText('<A>\r\n</B>\r\n')).toThrow(/closes <B>/)
  })

  it('decodes line, symbol and text items and encodes them to the same text', () => {
    const line = decodeRoadEngLineItem(lineItem(14, -150, [[1270, 635]]))
    expect(line).toMatchObject({ widthMm: 1.4, offsetMm: -1.5, dashes: [{ onMm: 12.7, offMm: 6.35 }] })
    expect(encodeRoadEngLineItem(line)).toBe(lineItem(14, -150, [[1270, 635]]))
    // Slots past the dash count keep what was there, as RoadEng leaves them.
    expect(encodeRoadEngLineItem({ ...line, widthMm: 0.3, dashes: [] })).toBe(
      lineItem(14, -150, [[1270, 635]]).replace(/^14,-150,1/, '3,-150,0'),
    )

    const raw = 'B0.5,1,2,1500,0.25,-40,6,3,0,0,0,-300,100,1,-300,-100,1'
    const symbol = decodeRoadEngSymbolItem(raw)
    expect(symbol).toMatchObject({ kind: 'B', scale: 0.5, filled: true, pen: 2, spacingMm: 15, phase: 0.25 })
    expect(symbol).toMatchObject({ offsetMm: -0.4, placement: 6 })
    expect(symbol.path).toEqual([
      { x: 0, y: 0, draw: false },
      { x: -3, y: 1, draw: true },
      { x: -3, y: -1, draw: true },
    ])
    expect(encodeRoadEngSymbolItem(symbol)).toBe(raw)

    const text = decodeRoadEngTextItem('0.5,1800,1,1500,0.6,-80,A, B')
    expect(text).toEqual({
      scale: 0.5,
      angleDeg: 180,
      flag: 1,
      spacingMm: 15,
      phase: 0.6,
      offsetMm: -0.8,
      text: 'A, B',
    })
    expect(encodeRoadEngTextItem(text)).toBe('0.5,1800,1,1500,0.6,-80,A, B')

    expect(() => decodeRoadEngLineItem('1,2,3')).toThrow(/3 numbers, not 25/)
    expect(() => decodeRoadEngSymbolItem('B1,0,0,0,0,0,0,2,0,0,1')).toThrow(/for 2 points/)
    expect(() => decodeRoadEngSymbolItem('B1,0,0,0,0,0,0,1,0,0,3')).toThrow(/pen 3/)
  })

  it('decodes the tables into line types and symbols', () => {
    const lines = lineTable()
    expect(lines.system.map((l) => l.description)).toEqual(['plain'])
    expect(lines.user.map((l) => l.description)).toEqual([
      'Thin',
      'Heavy',
      'Broken',
      'Twin rails',
      'Flow arrows',
      'Labelled, with text',
    ])
    expect(roadEngLineTypeAt(lines, 2)?.lines[0].dashes).toEqual([{ onMm: 2.5, offMm: 1.5 }])
    expect(roadEngLineTypeAt(lines, 9)).toBeNull()
    const symbols = symbolTable()
    expect(symbols.map((s) => [s.index, s.description, s.items.length, s.texts.length])).toEqual([
      [0, 'Square marker', 1, 0],
      [1, 'Old bridge', 1, 1],
    ])
    expect(symbols[1].font).toMatchObject({ face: 'Arial', height: -20 })
    const read = readRoadEngSymbolFile(synthDrawing([LINE_TABLE, SYMBOL_TABLE]))
    expect(read.lineTypes?.user).toHaveLength(6)
    expect(read.symbols).toHaveLength(2)
  })

  it('draws a symbol as SVG paths in millimetres, y down', () => {
    const square = roadEngSymbolDrawing(symbolTable()[0])
    expect(square.parts).toEqual([{ d: 'M-1 -1 L1 -1 L1 1 L-1 1 L-1 -1 Z', filled: true, penWidth: 1 }])
    expect(square.radiusMm).toBe(1)
    expect(square.viewBox).toEqual([-1, -1, 2, 2])
    const bridge = roadEngSymbolDrawing(symbolTable()[1])
    expect(bridge.parts[0].d).toBe('M-2 -0.4 L2 -0.4 M-2 0.4 L2 0.4')
    expect(bridge.texts).toEqual([{ text: 'b', x: 0, y: 0, sizeMm: 2, angleDeg: 0 }])
  })
})

describe('RoadEng format strings', () => {
  it('reads and writes COLORREF colours', () => {
    expect(rgbFromColorRef(255)).toBe(0xff0000)
    expect(hexFromColorRef(16711680)).toBe('#0000ff')
    expect(hexFromColorRef(8355711)).toBe('#7f7f7f')
    expect(hexFromColorRef(-1)).toBeNull()
    expect(hexFromColorRef(-16777216)).toBeNull()
    expect(colorRefFromHex('#00ff00')).toBe(65280)
    for (const hex of ['#123456', '#000000', '#ffffff']) expect(hexFromColorRef(colorRefFromHex(hex))).toBe(hex)
  })

  it('parses ten- and eleven-field formats and writes them back unchanged', () => {
    for (const v of ['0,8355711,0,-1,0,-1,-16777216,-16777216,255,0', '3,255,0,106,0,-1,-16777216,-16777216,255,0,0']) {
      const f = parseRoadEngFormat(v)!
      expect(formatRoadEngFormat(f)).toBe(v)
    }
    const f = parseRoadEngFormat('3,255,0,106,0,-1,-16777216,-16777216,255,0,0')!
    expect(f).toMatchObject({ lineType: 3, color: 255, symbol: 0, hatch: 106, symbolColor: -1, opacity: 255 })
    expect(formatRoadEngFormat({ ...f, color: colorRefFromHex('#00ff00'), lineType: 1 })).toBe(
      '1,65280,0,106,0,-1,-16777216,-16777216,255,0,0',
    )
    for (const v of [
      '0,0,0,0,0',
      '1.5,0,0,-1,0,-1,0,0,255,0',
      '0,0,0,-1,0,-1,0,0,999,0',
      'REL,0,0,0,0,-1,0,-1,0,0,255,0',
    ])
      expect(parseRoadEngFormat(v)).toBeNull()
  })

  it('reads label formats for their colour, name and font', () => {
    const label = parseRoadEngLabelFormat(
      '2,255,Grades,0,-1.000000,4,1,11657,-30.000000,0,0,900,0,1949.000000,40,0,400,0,1,3,18,1,2,32,Arial',
    )!
    expect(label).toMatchObject({ color: 255, description: 'Grades' })
    expect(label.font).toEqual({ height: 40, weight: 400, italic: false, face: 'Arial' })
  })

  const TLT = [
    '[backgrd]',
    'BckgrdFormat=50,0,0,8355711,0,-1,0,0,0,-1,1,0,0,65280,0,-,0,0,255,1,1',
    '[main]',
    'FormatBoundary=0,16711680,0,-1,0,-1,-16777216,-16777216,255,0',
    'FormatMajor=0,8355711,0,-1,0,-1,-16777216,-16777216,255,0,0',
    'units=10000',
    '[TerLabels]',
    'format0=2,255,Grades,0,-1.000000,4,1,11657,-30.000000,0,0,900,0,1949.000000,40,0,400,0,1,3,18,1,2,32,Arial',
    'nformats=1',
    '[TerLayers]',
    'Layer0=ROAD*,Roads,',
    '',
  ].join('\r\n')

  it('lists the looks an INI file sets', () => {
    const styles = readRoadEngIniStyles(TLT)
    expect(styles.map((s) => [s.section, s.key, s.kind, s.colors])).toEqual([
      ['backgrd', 'BckgrdFormat', 'background', ['#7f7f7f', '#00ff00']],
      ['main', 'FormatBoundary', 'feature', ['#0000ff']],
      ['main', 'FormatMajor', 'feature', ['#7f7f7f']],
      ['TerLabels', 'format0', 'label', ['#ff0000']],
    ])
    expect(readRoadEngIniEntries(TLT).find((e) => e.key === 'Layer0')).toEqual({
      section: 'TerLayers',
      key: 'Layer0',
      value: 'ROAD*,Roads,',
      line: 10,
    })
  })

  it('changes one INI value and keeps every other byte', () => {
    const major = readRoadEngIniStyles(TLT).find((s) => s.key === 'FormatMajor')!.format!
    const next = setRoadEngIniValue(TLT, 'MAIN', 'formatmajor', formatRoadEngFormat({ ...major, color: 255 }))
    expect(next).toBe(TLT.replace('FormatMajor=0,8355711,', 'FormatMajor=0,255,'))
    expect(setRoadEngIniValue(TLT, 'main', 'FormatMajor', major.tokens.join(','))).toBe(TLT)
    expect(setRoadEngIniValue(TLT, 'main', 'FormatMinor', 'x')).toBe(
      TLT.replace('units=10000', 'units=10000\r\nFormatMinor=x'),
    )
    expect(setRoadEngIniValue(TLT, 'plan', 'k', 'v')).toBe(`${TLT.slice(0, -2)}\r\n[plan]\r\nk=v\r\n`)
    expect(() => setRoadEngIniValue(TLT, 'main', 'k', 'a\nb')).toThrow(/line break/)
  })

  it('reads and patches a terrain format chunk', () => {
    const payload = new Uint8Array(56)
    const view = new DataView(payload.buffer)
    ;[1, -1, 0, -1, 0, 11112].forEach((v, i) => view.setInt32(4 * i, v, true))
    view.setFloat64(40, 1, true)
    view.setInt32(52, 1, true)
    expect(parseRoadEngFormatChunk(payload)).toEqual({ lineType: 1, color: -1, symbol: 0, hatch: -1, symbolScale: 1 })
    const patched = patchRoadEngFormatChunk(payload, { lineType: 3, color: 255 })
    expect(parseRoadEngFormatChunk(patched)).toEqual({ lineType: 3, color: 255, symbol: 0, hatch: -1, symbolScale: 1 })
    expect(patched.subarray(16)).toEqual(payload.subarray(16))
    expect(payload[0]).toBe(1)
    expect(parseRoadEngFormatChunk(payload.subarray(0, 20))).toBeNull()
  })
})

describe('RoadEng looks in PGMaps', () => {
  const line = (k: number) => roadEngLineTypeAt(lineTable(), k)!

  it('reads a line type as a width, a dash and a mark', () => {
    expect(roadEngLineTypeStyle(line(0)).style).toEqual({ width: 0.5, dash: 'solid' })
    expect(roadEngLineTypeStyle(line(1)).style).toEqual({ width: 2.25, dash: 'solid' })
    // 2.5 mm on and 1.5 mm off a line drawn 0.75 pt wide: 9.45 and 5.67 widths.
    expect(roadEngLineTypeStyle(line(2)).style).toEqual({ width: 0.75, dash: 'custom', dashPattern: [9.45, 5.67] })
    const twin = roadEngLineTypeStyle(line(3))
    expect(twin.left).toEqual(['"Twin rails" draws 2 parallel strokes; one is drawn.'])
    expect(roadEngLineTypeStyle(line(4)).style.marker).toBe('arrow')
    const text = roadEngLineTypeStyle(line(5))
    expect(text.left).toEqual(['"Labelled, with text" writes "A, B" along the line.'])
    for (let k = 0; k < 6; k++) expect(() => parseSymbolStyle(roadEngLineTypeStyle(line(k)).style)).not.toThrow()
  })

  it('shortens a dash too long to draw and keeps its rhythm', () => {
    const lines = lineTable()
    const long = { ...lines.user[2], lines: [decodeRoadEngLineItem(lineItem(0, 0, [[4000, 2000]]))] }
    const { style, left } = roadEngLineTypeStyle(long)
    expect(style.dashPattern).toEqual([40, 20])
    expect(left).toEqual(['"Broken" has dashes longer than a line can draw; the pattern is shortened.'])
  })

  it('gives a feature its own colour first, then the format colour', () => {
    const t = tables()
    const look = roadEngFeatureLook(
      { shape: 'line', color: 0x00aa00, format: { lineType: 2, color: 255, symbol: 0, hatch: -1 } },
      t,
    )
    expect(look.style).toEqual({ color: '#00aa00', width: 0.75, dash: 'custom', dashPattern: [9.45, 5.67] })
    expect(look.lineType?.description).toBe('Broken')
    expect(
      roadEngFeatureLook({ shape: 'line', color: null, format: { lineType: 0, color: 255, symbol: 0, hatch: -1 } }, t)
        .style.color,
    ).toBe('#ff0000')
    expect(roadEngFeatureLook({ shape: 'line', color: 0x123456 }, { lineTypes: null, symbols: null })).toMatchObject({
      style: { color: '#123456' },
      left: [],
    })
    expect(
      roadEngFeatureLook({ shape: 'line', color: null, format: { lineType: 40, color: -1, symbol: 0, hatch: -1 } }, t)
        .left,
    ).toEqual(["Line type 40 is not in the file's table."])
  })

  it('draws points with PGMaps icons and areas with a tint or no fill', () => {
    const t = tables()
    expect(roadEngSymbolStyle(t.symbols[1])).toEqual({ icon: 'bridge', size: 11 })
    const point = roadEngFeatureLook(
      { shape: 'point', color: 0xff0000, format: { lineType: 0, color: -1, symbol: 2, hatch: -1 } },
      t,
    )
    expect(point.style).toEqual({ color: '#ff0000', icon: 'bridge', size: 11 })
    const marker = roadEngFeatureLook(
      { shape: 'point', color: null, format: { lineType: 0, color: -1, symbol: 1, hatch: -1 } },
      t,
    )
    expect(marker.style).toEqual({ size: 6 })
    expect(marker.left).toEqual(['"Square marker" has no PGMaps icon; the default point is drawn.'])
    const hatched = roadEngFeatureLook(
      { shape: 'area', color: 0x0000ff, format: { lineType: 0, color: -1, symbol: 0, hatch: 2 } },
      t,
    )
    expect(hatched.style).toEqual({ color: '#0000ff', width: 0.5, dash: 'solid', pattern: 'solid', opacity: 0.25 })
    const outline = roadEngFeatureLook(
      { shape: 'area', color: 0x0000ff, format: { lineType: 0, color: -1, symbol: 0, hatch: -1 } },
      t,
    )
    expect(outline.style.noFill).toBe(true)
    for (const look of [point, marker, hatched, outline]) expect(() => parseSymbolStyle(look.style)).not.toThrow()
  })

  it('files features under RoadEng terrain, one layer per group and look', () => {
    const t = tables()
    const look = (color: number, lineType: number) =>
      roadEngFeatureLook({ shape: 'line', color, format: { lineType, color: -1, symbol: 0, hatch: -1 } }, t)
    const { layerOf, styles, notes } = roadEngReferenceLayers([
      { id: 'a', group: 'Roads', shape: 'line', look: look(0xff0000, 1) },
      { id: 'b', group: 'Roads', shape: 'line', look: look(0xff0000, 1) },
      { id: 'c', group: 'Streams', shape: 'line', look: look(0x0000ff, 2) },
      { id: 'd', group: 'Streams', shape: 'line', look: look(0x00ffff, 2) },
      { id: 'e', group: 'P.I. / marks', shape: 'line', look: roadEngFeatureLook({ shape: 'line', color: null }, t) },
    ])
    expect(Object.fromEntries(layerOf)).toEqual({
      a: `${ROADENG_LAYER_FOLDER}/Roads`,
      b: `${ROADENG_LAYER_FOLDER}/Roads`,
      c: `${ROADENG_LAYER_FOLDER}/Streams (#0000ff, line)`,
      d: `${ROADENG_LAYER_FOLDER}/Streams (#00ffff, line)`,
      e: `${ROADENG_LAYER_FOLDER}/P I marks`,
    })
    expect(styles.map((s) => [s.layer, s.color])).toEqual([
      [`${ROADENG_LAYER_FOLDER}/Roads`, '#ff0000'],
      [`${ROADENG_LAYER_FOLDER}/Streams (#0000ff, line)`, '#0000ff'],
      [`${ROADENG_LAYER_FOLDER}/Streams (#00ffff, line)`, '#00ffff'],
    ])
    expect(notes).toEqual([])
  })
})

describe('RoadEng looks written back', () => {
  it('picks the file line type that draws like the style', () => {
    const t = tables()
    for (const lt of t.lineTypes.user.filter((l) => !l.texts.length)) {
      const style = roadEngLineTypeStyle(lt).style
      const out = roadEngLookFromStyle(style, 'line', t)
      expect(roadEngLineTypeStyle(roadEngLineTypeAt(t.lineTypes, out.lineType!)!).style).toEqual(style)
    }
    expect(roadEngLookFromStyle({ dash: 'dashed', width: 0.75 }, 'line', t).lineType).toBe(2)
    expect(roadEngLookFromStyle({ width: 2 }, 'line', t).lineType).toBe(1)
  })

  it('writes the colour, the symbol and the line type a look sets, and nothing else', () => {
    const t = tables()
    expect(roadEngLookFromStyle({ color: '#ff0000' }, 'line', t)).toEqual({
      colorRef: 255,
      lineType: null,
      symbol: null,
      notes: [],
    })
    expect(roadEngLookFromStyle({ icon: 'bridge' }, 'point', t).symbol).toBe(2)
    expect(roadEngLookFromStyle({ icon: 'tree' }, 'point', t).notes).toEqual([
      "No symbol in the file's table matches the tree icon; the original symbol is kept.",
    ])
    expect(roadEngLookFromStyle({ dash: 'solid' }, 'line', { lineTypes: null, symbols: null }).notes).toEqual([
      'The line style is not written: the project holds no RoadEng line-type table.',
    ])
    const format = parseRoadEngFormat('0,8355711,0,-1,0,-1,-16777216,-16777216,255,0,0')!
    const { format: next } = roadEngFormatWithStyle(format, { color: '#0000ff', width: 2.25, dash: 'solid' }, 'line', t)
    expect(formatRoadEngFormat(next)).toBe('1,16711680,0,-1,0,-1,-16777216,-16777216,255,0,0')
  })

  it('reads back what it writes', () => {
    const t = tables()
    const style = { color: '#aa5500', width: 0.75, dash: 'custom' as const, dashPattern: [9.45, 5.67] }
    const out = roadEngLookFromStyle(style, 'line', t)
    const look = roadEngFeatureLook(
      {
        shape: 'line',
        color: rgbFromColorRef(out.colorRef!),
        format: { lineType: out.lineType!, color: -1, symbol: 0, hatch: -1 },
      },
      t,
    )
    expect(look.style).toEqual(style)
  })
})

// Softree's published sample projects, read in place and never committed: set ROADENG_SAMPLES to
// the folder holding them.
const samples = process.env.ROADENG_SAMPLES

function sampleFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sampleFiles(path) : [path]
  })
}

describe.skipIf(!samples || !existsSync(samples))('Softree sample symbol tables', () => {
  const files = samples && existsSync(samples) ? sampleFiles(samples) : []
  /** Every `.ds3`/`.te1` inside the samples' `.dsnx`/`.terx` archives, plus loose `.te1` files. */
  const symbolFiles = files.flatMap((path): [string, Uint8Array][] => {
    if (/\.te1$/i.test(path)) return [[path, new Uint8Array(readFileSync(path))]]
    if (!/\.(dsnx|terx)$/i.test(path)) return []
    const entries = unzipSync(new Uint8Array(readFileSync(path)))
    return Object.entries(entries)
      .filter(([name]) => /\.(ds3|te1)$/i.test(name))
      .map(([name, bytes]) => [`${path}:${name}`, bytes])
  })
  const iniTexts = files.flatMap((path): [string, string][] => {
    const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes)
    if (/\.(tlt|ilt)$/i.test(path)) return [[path, new TextDecoder('latin1').decode(readFileSync(path))]]
    if (!/\.(dsnx|terx)$/i.test(path)) return []
    return Object.entries(unzipSync(new Uint8Array(readFileSync(path))))
      .filter(([name]) => /\.(tlt|dsn)$/i.test(name))
      .map(([name, bytes]) => [`${path}:${name}`, bytes.length < 2_000_000 ? text(bytes) : ''])
  })

  it('finds both tables in every symbol file and writes their text back byte for byte', () => {
    expect(symbolFiles.length).toBeGreaterThanOrEqual(15)
    for (const [path, bytes] of symbolFiles) {
      const texts = extractRoadEngTableTexts(bytes)
      expect(texts.version, path).toBe('AC1014')
      expect(texts.warnings, path).toEqual([])
      for (const text of [texts.lineTypes!, texts.symbols!]) {
        expect(writeRoadEngTableText(parseRoadEngTableText(text)), path).toBe(text)
        expect(roadEngTableBytes(text).length, path).toBe(text.length)
      }
    }
  })

  it('decodes every item and encodes it to its exact text', () => {
    let items = 0
    for (const [path, bytes] of symbolFiles) {
      const { lineTypes, symbols } = readRoadEngSymbolFile(bytes)
      for (const entry of [...lineTypes!.system, ...lineTypes!.user, ...symbols!]) {
        const f = entry.fields
        const lineItems = 'lines' in entry ? entry.lines : []
        lineItems.forEach((item, k) => expect(encodeRoadEngLineItem(item), path).toBe(f[`LINEITEM${k}`]))
        const drawn = 'lines' in entry ? entry.symbols : entry.items
        drawn.forEach((item, k) => expect(encodeRoadEngSymbolItem(item), path).toBe(f[`SYMBOLITEM${k}`]))
        entry.texts.forEach((item, k) => expect(encodeRoadEngTextItem(item), path).toBe(f[`TEXTITEM${k}`]))
        items += lineItems.length + drawn.length + entry.texts.length
      }
    }
    expect(items).toBeGreaterThan(5000)
  })

  it('counts the stock and older tables as the format study found them', () => {
    const read = (suffix: string) => {
      const found = symbolFiles.find(([path]) => path.endsWith(suffix))
      expect(found, suffix).toBeDefined()
      const { lineTypes, symbols } = readRoadEngSymbolFile(found![1])
      return [lineTypes!.system.length, lineTypes!.user.length, symbols!.length]
    }
    expect(read('LongRoad 1.terx:Terrain1.te1')).toEqual([9, 119, 87])
    expect(read('R_L_Shoulders.terx:Terrain1.te1')).toEqual([9, 118, 87])
    expect(read('contour.terx:Terrain1.te1')).toEqual([9, 56, 73])
  })

  it('reads the stock lines by their stated widths and dashes', () => {
    const [, bytes] = symbolFiles.find(([path]) => path.endsWith('R_L_Shoulders.terx:Terrain1.te1'))!
    const { lineTypes } = readRoadEngSymbolFile(bytes)
    const byName = (name: string) => lineTypes!.user.find((l) => l.description === name)!
    for (const [name, width] of [
      ['Solid (.3 mm)', 0.3],
      ['Dash (1.4 mm)', 1.4],
      ['Dot (.5 mm)', 0.5],
    ] as const)
      expect(byName(name).lines[0].widthMm, name).toBe(width)
    expect(byName('DASHED').lines[0].dashes).toEqual([{ onMm: 12.7, offMm: 6.35 }])
    const hw = byName('HOT_WATER_SUPPLY')
    expect(hw.texts[0].spacingMm).toBeCloseTo(hw.lines[0].dashes[0].onMm + hw.lines[0].dashes[0].offMm, 9)
    expect(roadEngLineTypeAt(lineTypes, 1)?.description).toBe('Solid (.1 mm)')
    expect(roadEngLineTypeAt(lineTypes, 3)?.description).toBe('Solid (.3 mm)')
  })

  it('maps every line type and symbol to a look PGMaps accepts, and back to an equal look', () => {
    for (const [path, bytes] of symbolFiles) {
      const t = readRoadEngSymbolFile(bytes) as { lineTypes: RoadEngLineTypeTable; symbols: RoadEngSymbol[] }
      for (const lt of t.lineTypes.user) {
        const { style } = roadEngLineTypeStyle(lt)
        expect(() => parseSymbolStyle(style), `${path} ${lt.description}`).not.toThrow()
        if (lt.texts.length) continue
        const back = roadEngLookFromStyle(style, 'line', t)
        expect(roadEngLineTypeStyle(roadEngLineTypeAt(t.lineTypes, back.lineType!)!).style).toEqual(style)
      }
      for (const s of t.symbols) {
        const { icon, size } = roadEngSymbolStyle(s)
        expect(() => parseSymbolStyle({ size, ...(icon ? { icon } : {}) }), `${path} ${s.description}`).not.toThrow()
      }
    }
  })

  it('reads every format string in the INI files and writes it back unchanged', () => {
    let formats = 0
    for (const [path, text] of iniTexts) {
      if (!text) continue
      for (const style of readRoadEngIniStyles(text)) {
        if (style.kind !== 'feature') continue
        expect(formatRoadEngFormat(style.format!), `${path} ${style.key}`).toBe(style.value)
        expect(setRoadEngIniValue(text, style.section, style.key, style.value)).toBe(text)
        formats++
      }
    }
    expect(formats).toBeGreaterThan(50)
    const [, tlt] = iniTexts.find(([path]) => path.endsWith('LongRoad 1.terx:Terrain1.tlt'))!
    const main = readRoadEngIniStyles(tlt).filter((s) => s.section === 'main')
    expect(main.map((s) => [s.key, s.colors[0]])).toEqual([
      ['FormatBoundary', '#0000ff'],
      ['FormatMajor', '#7f7f7f'],
      ['FormatMinor', '#cccccc'],
      ['IsectFormat', '#008040'],
    ])
  })

  it("reads the cul-de-sac C-Lines' format chunks", () => {
    const path = files.find((p) => p.endsWith('R_L_Shoulders.terx'))!
    const ter = unzipSync(new Uint8Array(readFileSync(path)))['Terrain1.ter']
    const view = new DataView(ter.buffer, ter.byteOffset, ter.byteLength)
    const chunks = []
    for (let at = 0; at + 16 <= ter.length; at++)
      if (view.getUint32(at + 4, true) === 2 && view.getUint32(at + 8, true) === 58 && view.getUint32(at, true) === 72)
        chunks.push(parseRoadEngFormatChunk(ter.subarray(at + 16, at + 72)))
    expect(chunks).toEqual([
      { lineType: 1, color: -1, symbol: 0, hatch: -1, symbolScale: 1 },
      { lineType: 1, color: -1, symbol: 0, hatch: -1, symbolScale: 1 },
    ])
  })
})
