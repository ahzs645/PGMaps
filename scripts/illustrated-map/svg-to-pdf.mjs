// Print an SVG to a one-page vector PDF of its own size with Chromium (Playwright).
//   node scripts/illustrated-map/svg-to-pdf.mjs drawing.svg drawing.pdf
// SVG masks become images in Chromium's PDF; clip paths, strokes and text stay vectors.
import { chromium } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

const [, , input, output] = process.argv
if (!input || !output) throw new Error('Usage: svg-to-pdf.mjs <input.svg> <output.pdf>')
const svg = readFileSync(input, 'utf8')
const size = svg.match(/<svg[^>]*\swidth="([\d.]+)(?:px)?"[^>]*\sheight="([\d.]+)(?:px)?"/)
if (!size) throw new Error('The SVG has no width and height.')
const [width, height] = [Number(size[1]), Number(size[2])]
// The preinstalled Chromium when there is one: the project's Playwright may expect another build.
const executablePath =
  process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)
const browser = await chromium.launch(executablePath ? { executablePath } : {})
const page = await browser.newPage({ viewport: { width: Math.ceil(width), height: Math.ceil(height) } })
await page.setContent(
  `<!doctype html><html><head><style>@page{size:${width}px ${height}px;margin:0}html,body{margin:0}svg{display:block}</style></head><body>${svg.replace(/^<\?xml[^>]*>/, '')}</body></html>`,
)
await page.pdf({ path: output, width: `${width}px`, height: `${height}px`, printBackground: true, pageRanges: '1' })
await browser.close()
