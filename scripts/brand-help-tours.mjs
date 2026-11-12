// TourKit exports are standalone HTML documents. Inline the same identity and
// player controls in each so downloaded lessons also work without a server.
import { readFile, writeFile } from 'node:fs/promises'
import { tsImport } from 'tsx/esm/api'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const brandDir = new URL('../public/brand/', import.meta.url)
const helpDir = new URL('../public/help/', import.meta.url)
const { LessonNavigation } = await tsImport('../src/help/LessonNavigation.tsx', import.meta.url)
const navFor = (lesson, view) => renderToStaticMarkup(createElement(LessonNavigation, { lesson, view }))
const context = await readFile(new URL('workspaceContext.js', helpDir), 'utf8')
const navCss = await readFile(new URL('lessonNavigation.css', helpDir), 'utf8')
let brand = await readFile(new URL('access.css', brandDir), 'utf8')
brand += '\n' + navCss.replaceAll("url('../brand/", "url('./")
const mime = { woff2: 'font/woff2', ttf: 'font/ttf', svg: 'image/svg+xml' }
for (const [reference, file, ext] of brand.matchAll(/url\('\.\/([^']+\.(woff2|ttf|svg))'\)/g)) {
  const bytes = await readFile(new URL(file, brandDir))
  brand = brand.replace(reference, `url('data:${mime[ext]};base64,${bytes.toString('base64')}')`)
}
const licenses = await Promise.all(['Inter-OFL.txt', 'SpaceMono-OFL.txt'].map(file => readFile(new URL(file, brandDir), 'utf8')))
const theme = await readFile(new URL('../src/help/tourPlayer.css', import.meta.url), 'utf8')
const style = `<style id="ddc-tour-theme">/*\n${licenses.join('\n')}\n*/\n${brand}\n${theme}</style>`
// The order learners see in the catalog is also their reading and playing order.
const catalog = await readFile(new URL('index.html', helpDir), 'utf8')
const lessons = await Promise.all(Array.from(catalog.matchAll(/href="([a-z0-9-]+)\/tour\.html"/g), async ([, id]) => {
  const guideFile = new URL(id + '/index.html', helpDir)
  const guide = await readFile(guideFile, 'utf8')
  const title = guide.match(/<h1>([^<]+)<\/h1>/)?.[1]
  if (!title) throw new Error('Missing lesson title in ' + id)
  return { id, guideFile, guide, title }
}))

for (const [index, lesson] of lessons.entries()) {
  const next = lessons[index + 1]
  const guideLink = next
    ? `<a data-next-lesson="${next.id}" rel="next" href="../${next.id}/index.html">Next lesson · ${next.title}</a>`
    : ''
  const nav = navFor(lesson.id, 'guide')
  const navAssets = '<link rel="stylesheet" href="../lessonNavigation.css"><script defer src="../workspaceContext.js"></script>'
  const guide = lesson.guide
    .replace(navAssets, '')
    .replace('</head>', navAssets + '</head>')
    .replace(/<body>\s*(?:<header class="mast">[\s\S]*?<\/header>|<nav class="tour-nav"[^>]*>[\s\S]*?<\/nav>)?/, '<body>' + nav)
    .replace(/<a data-next-lesson="[^"]*"[^>]*>[^<]*<\/a>/, '')
    .replace('</footer>', guideLink + '</footer>')
  if (guide !== lesson.guide) await writeFile(lesson.guideFile, guide)

  const continuation = next
    ? `<a data-next-lesson="${next.id}" rel="next" href="../${next.id}/tour.html"><span>Next lesson</span>${next.title}</a>`
    : '<a href="../index.html"><span>Lesson catalog</span>Return to all workflows</a>'
  const nextNav = `<nav class="tour-continue" aria-label="Continue learning">${continuation}</nav>`
  const file = new URL(lesson.id + '/tour.html', helpDir)
  const html = await readFile(file, 'utf8')
  const updated = html.replace(/<style id="ddc-tour-theme">[\s\S]*?<\/style>/, '')
    .replace('</head>', () => style + '</head>')
    .replace(/<body>(?:<nav\b[^>]*>[\s\S]*?<\/nav>)?/, '<body>' + navFor(lesson.id, 'tour'))
    .replace(/<script id="tour-workspace-context">[\s\S]*?<\/script>/, '')
    .replace(/<\/body>(?=<\/html>\s*$)/, () => '<script id="tour-workspace-context">' + context + '</script></body>')
    .replace(/(<div id="root"><\/div>)(?:<nav class="tour-continue"[^>]*>[\s\S]*?<\/nav>)?/, (_, root) => root + nextNav)
  if (updated !== html) await writeFile(file, updated)
}
