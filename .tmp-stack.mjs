import { chromium } from 'playwright'
const OUT = process.env.OUT
const browser = await chromium.launch({ channel: 'chrome' })
const p = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
await p.goto('http://localhost:5199/dev/interact', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(3500)

// open the table from the sidebar sheet
await p.getByRole('button', { name: 'Open table' }).first().click()
await p.waitForTimeout(1000)
await p.screenshot({ path: `${OUT}/stack-1-table.png` })

// now select a row, which focuses a feature -> does a feature card appear too?
await p.getByRole('row').filter({ hasText: 'Cottonwood' }).first().click()
await p.waitForTimeout(1200)
await p.screenshot({ path: `${OUT}/stack-2-table-plus-feature.png` })

const s = await p.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-sheet-open-state]')]
  return {
    cardIds: cards.map(c => c.id || '(no id)'),
    cardZ: cards.map(c => getComputedStyle(c).zIndex),
    sheetPresent: !!document.querySelector('[data-map-mobile-sheet]'),
    tableCard: !!document.querySelector('#map-feature-table'),
  }
})
console.log(JSON.stringify(s, null, 1))
await browser.close()
