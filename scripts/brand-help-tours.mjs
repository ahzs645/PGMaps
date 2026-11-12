// TourKit exports are standalone HTML documents. Inline the same identity and
// player controls in each so downloaded lessons also work without a server.
import { readFile, writeFile } from 'node:fs/promises'
import { tsImport } from 'tsx/esm/api'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'
import path from 'node:path'
import { rebuildPortableGuards, helpRadiusTokens, tokenizedPlayerCss } from './lib/help-tour-build.mjs'

const brandDir = new URL('../public/brand/', import.meta.url)
const helpDir = new URL('../public/help/', import.meta.url)
const check = process.argv.includes('--check')
async function generated(file, content, previous) {
  previous ??= await readFile(file, 'utf8').catch(() => '')
  if (content === previous) return
  if (check) throw Error(`Stale help export: ${file.pathname}. Run npm run help:build.`)
  await writeFile(file, content)
}
const tokens = helpRadiusTokens(await readFile(new URL('../src/index.css', import.meta.url), 'utf8'))
await generated(new URL('designTokens.css', helpDir), tokens)
const { outputFiles } = await build({
  entryPoints: [new URL('../src/help/parseCapture.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'PGMapsCapture',
  target: 'es2020',
  minify: true,
})
const guards = outputFiles[0].text
const { outputFiles: brandingFiles } = await build({
  entryPoints: [new URL('../src/branding/helpBootstrap.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2020',
  minify: true,
  plugins: [
    {
      name: 'inline-brand-css',
      setup(build) {
        build.onResolve({ filter: /\.css\?inline$/ }, (args) => ({
          path: path.resolve(args.resolveDir, args.path.replace(/\?inline$/, '')),
          namespace: 'brand-css',
        }))
        build.onLoad({ filter: /.*/, namespace: 'brand-css' }, async (args) => ({
          contents: await readFile(args.path, 'utf8'),
          loader: 'text',
        }))
      },
    },
  ],
})
const brandingRuntime = brandingFiles[0].text
await generated(new URL('branding.js', helpDir), brandingRuntime)
const catalogWithBranding = await readFile(new URL('index.html', helpDir), 'utf8')
const catalogBrandScript = '<script defer src="branding.js"></script>'
await generated(
  new URL('index.html', helpDir),
  catalogWithBranding.replace(catalogBrandScript, '').replace('</head>', catalogBrandScript + '</head>'),
  catalogWithBranding,
)
const introductionFile = new URL('open-hillside/index.html', helpDir)
const introduction = await readFile(introductionFile, 'utf8')
const introductionBrandScript = '<script defer src="../branding.js"></script>'
await generated(
  introductionFile,
  introduction.replace(introductionBrandScript, '').replace('</head>', introductionBrandScript + '</head>'),
  introduction,
)
const { parseCapture } = await tsImport('../src/help/parseCapture.ts', import.meta.url)
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
const licenses = await Promise.all(
  ['Inter-OFL.txt', 'SpaceMono-OFL.txt'].map((file) => readFile(new URL(file, brandDir), 'utf8')),
)
const theme = await readFile(new URL('../src/help/tourPlayer.css', import.meta.url), 'utf8')
const style = `<style id="ddc-tour-theme">/*\n${licenses.join('\n')}\n*/\n${tokens}\n${brand}\n${theme}</style>`
// The order learners see in the catalog is also their reading and playing order.
const catalog = await readFile(new URL('index.html', helpDir), 'utf8')
const lessons = await Promise.all(
  Array.from(catalog.matchAll(/href="([a-z0-9-]+)\/tour\.html"/g), async ([, id]) => {
    const guideFile = new URL(id + '/index.html', helpDir)
    const guide = await readFile(guideFile, 'utf8')
    const title = guide.match(/<h1>([^<]+)<\/h1>/)?.[1]
    if (!title) throw new Error('Missing lesson title in ' + id)
    return { id, guideFile, guide, title }
  }),
)

for (const [index, lesson] of lessons.entries()) {
  const next = lessons[index + 1]
  const guideLink = next
    ? `<a data-next-lesson="${next.id}" rel="next" href="../${next.id}/index.html">Next lesson · ${next.title}</a>`
    : ''
  const nav = navFor(lesson.id, 'guide')
  const navAssets =
    '<link rel="stylesheet" href="../lessonNavigation.css"><script defer src="../workspaceContext.js"></script>'
  const guideBrandScript = '<script defer src="../branding.js"></script>'
  const guide = lesson.guide
    .replace(guideBrandScript, '')
    .replace('</head>', guideBrandScript + '</head>')
    .replace(navAssets, '')
    .replace('</head>', navAssets + '</head>')
    .replace(
      /<body>\s*(?:<header class="mast">[\s\S]*?<\/header>|<nav class="tour-nav"[^>]*>[\s\S]*?<\/nav>)?/,
      '<body>' + nav,
    )
    .replace(/<a data-next-lesson="[^"]*"[^>]*>[^<]*<\/a>/, '')
    .replace('</footer>', guideLink + '</footer>')
  await generated(lesson.guideFile, guide, lesson.guide)

  const continuation = next
    ? `<a data-next-lesson="${next.id}" rel="next" href="../${next.id}/tour.html"><span>Next lesson</span>${next.title}</a>`
    : '<a href="../index.html"><span>Lesson catalog</span>Return to all workflows</a>'
  const nextNav = `<nav class="tour-continue" aria-label="Continue learning">${continuation}</nav>`
  const file = new URL(lesson.id + '/tour.html', helpDir)
  const html = await readFile(file, 'utf8')
  const capture = html.match(/<script id="tourkit-capture-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1]
  if (!capture) throw Error('Missing capture data in ' + lesson.id)
  parseCapture(capture)
  let runtimeCount = 0
  const updated = html
    .replace(/<script id="pgmaps-help-branding">[\s\S]*?<\/script>/, '')
    .replace(/<script>([\s\S]*?)<\/script>/g, (_, runtime) => {
      runtimeCount++
      return '<script>' + rebuildPortableGuards(runtime, guards) + '</script>'
    })
    .replace(/<style id="ddc-tour-theme">[\s\S]*?<\/style>/, '')
    .replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => '<style>' + tokenizedPlayerCss(css) + '</style>')
    .replace('</head>', () => style + '</head>')
    .replace(/<body>(?:<nav\b[^>]*>[\s\S]*?<\/nav>)?/, '<body>' + navFor(lesson.id, 'tour'))
    .replace(/<script id="tour-workspace-context">[\s\S]*?<\/script>/, '')
    .replace(/<\/body>(?=<\/html>\s*$)/, () => '<script id="tour-workspace-context">' + context + '</script></body>')
    .replace(
      /<\/body>(?=<\/html>\s*$)/,
      () => '<script id="pgmaps-help-branding">' + brandingRuntime + '</script></body>',
    )
    .replace(
      /(<div id="root"><\/div>)(?:<nav class="tour-continue"[^>]*>[\s\S]*?<\/nav>)?/,
      (_, root) => root + nextNav,
    )
  if (runtimeCount !== 1) throw Error('Expected one portable player runtime in ' + lesson.id)
  await generated(file, updated, html)
}
