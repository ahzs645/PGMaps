/** Read-only source inventory; does not resolve runtime styles or recolour data. */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import console from 'node:console'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
import tailwindColors from 'tailwindcss/colors.js'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'tmp/color-audit')
fs.mkdirSync(out, { recursive: true })
const files = execFileSync('rg', ['--files', 'src', 'public/data/projects'], { cwd: root, encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(
    (f) =>
      /\.(tsx?|jsx?|css|json)$/.test(f) &&
      !/\.(test|spec)\./.test(f) &&
      !f.endsWith('/index.json') &&
      !f.endsWith('.generated.json'),
  )
  .sort()
const colorRE = /#[\da-f]{8}\b|#[\da-f]{6}\b|#[\da-f]{4}\b|#[\da-f]{3}\b|\b(?:rgba?|hsla?|oklch)\([^()]*\)/gi
const tokenRE =
  /(?:[\w-]+:)*(?:bg|text|border|ring|fill|stroke|from|via|to|decoration|outline)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)(?:\/\d+)?\b/g
const occurrences = [],
  tokens = [],
  parsed = new Map(),
  palettes = []
const normalize = (raw) => {
  let value = raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ',')
  if (/^#[\da-f]{3,4}$/.test(value)) value = '#' + [...value.slice(1)].map((c) => c + c).join('')
  return value
}
function scan(text, file, line) {
  for (const match of text.matchAll(colorRE))
    occurrences.push({ color: normalize(match[0]), raw: match[0], file, line })
  for (const match of text.matchAll(tokenRE)) tokens.push({ token: match[0], file, line })
}
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  if (file.endsWith('.css')) {
    // Retain line positions while removing comments.
    source
      .replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ' '))
      .split('\n')
      .forEach((s, i) => scan(s, file, i + 1))
    for (const section of source.matchAll(/(:root|\.dark)\s*\{([^}]+)\}/g)) {
      const roles = [],
        charts = []
      for (const declaration of section[2].matchAll(/(--[\w-]+):\s*([\d.]+)\s+([\d.]+%)\s+([\d.]+%);/g)) {
        const cssColor = `hsl(${declaration[2]}, ${declaration[3]}, ${declaration[4]})`
        const line = source
          .slice(0, section.index + section[0].indexOf(section[2]) + declaration.index)
          .split('\n').length
        occurrences.push({ color: normalize(cssColor), raw: cssColor, file, line })
        roles.push(cssColor)
        if (declaration[1].startsWith('--chart-')) charts.push(cssColor)
      }
      const theme = section[1] === ':root' ? 'light' : 'dark'
      if (roles.length) palettes.push({ name: `UI theme roles · ${theme}`, colors: roles, file, kind: 'source' })
      if (charts.length) palettes.push({ name: `UI chart roles · ${theme}`, colors: charts, file, kind: 'categorical' })
    }
  } else {
    const ast = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.json') ? ts.ScriptKind.JSON : undefined,
    )
    parsed.set(file, ast)
    function visit(node) {
      if (
        ts.isStringLiteralLike(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
      ) {
        scan(node.text, file, ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1)
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
}
function unwrap(node) {
  while (node && (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)))
    node = node.expression
  return node
}
function colorsIn(node) {
  const result = []
  function visit(n) {
    if (ts.isStringLiteralLike(n) && /^(#[\da-f]{3,8}|rgba?\([^()]*\))$/i.test(n.text)) result.push(n.text)
    ts.forEachChild(n, visit)
  }
  visit(node)
  return result
}
function extract(file, variable, split = false) {
  const ast = parsed.get(file)
  if (!ast) throw new Error(`Missing source ${file}`)
  let found = false
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === variable) {
      found = true
      const value = unwrap(node.initializer)
      const nodes = split && ts.isObjectLiteralExpression(value) ? value.properties : [node]
      for (const item of nodes) {
        const colors = colorsIn(item)
        if (colors.length)
          palettes.push({
            name: split ? `${variable}.${item.name.getText(ast)}` : variable,
            colors,
            file,
            line: ast.getLineAndCharacterOfPosition(item.getStart(ast)).line + 1,
          })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  if (!found) throw new Error(`Missing variable ${variable}`)
}
for (const args of [
  ['src/components/ui/map-styles.ts', 'COLOR_SCALES', true],
  ['src/components/ui/map-styles.ts', 'HEATMAP_COLOR_RAMPS', true],
  ['src/maps/scorebuilder/constants/palettes.ts', 'SCORE_PALETTE_PROFILES', true],
  ['src/maps/foodmap/risk.ts', 'RISK_BAND_COLORS', true],
  ['src/maps/bcassessment/constants.ts', 'CATEGORY_COLORS'],
  ['src/maps/bcassessment/constants.ts', 'VALUE_STOPS'],
  ['src/maps/bcassessment/constants.ts', 'YEAR_STOPS'],
  ['src/maps/aqmap/lib/aqhiScale.ts', 'AQHI_LEVELS'],
  ['src/maps/pgdata/walkabilityMiBands.ts', 'WALKABILITY_MI_BANDS'],
  ['src/maps/scorebuilder/lib/correlationColors.ts', 'BIVARIATE_3X3_PALETTE'],
  ['src/maps/pgdata/WarsHeatmapControls.tsx', 'WARS_HEATMAP_PALETTES', true],
])
  extract(...args)
// Discover literal arrays, positioned stops and keyed colour sets beyond the
// curated groups above. No source module is executed by this audit.
const isColor = (n) => n && ts.isStringLiteralLike(n) && /^(#[\da-f]{3,8}|rgba?\([^()]*\))$/i.test(n.text)
for (const [file, ast] of parsed) {
  if (!file.startsWith('src/')) continue
  function visit(node, trail = '') {
    let name = trail
    if (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node))
      name = [trail, node.name.getText(ast).replaceAll('"', '').replaceAll("'", '')].filter(Boolean).join('.')
    let colors, positions
    if (ts.isArrayLiteralExpression(node)) {
      if (node.elements.length >= 2 && node.elements.every(isColor)) colors = node.elements.map((n) => n.text)
      if (
        node.elements.length >= 2 &&
        node.elements.every(
          (n) =>
            ts.isArrayLiteralExpression(n) &&
            n.elements.length === 2 &&
            ts.isNumericLiteral(n.elements[0]) &&
            isColor(n.elements[1]),
        )
      ) {
        colors = node.elements.map((n) => n.elements[1].text)
        positions = node.elements.map((n) => Number(n.elements[0].text.replaceAll('_', '')))
      }
      if (node.elements.every(ts.isObjectLiteralExpression) && node.elements.length >= 2) {
        const nodes = node.elements.map(
          (n) => n.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(ast) === 'color')?.initializer,
        )
        if (nodes.every(isColor)) colors = nodes.map((n) => n.text)
      }
    }
    if (
      ts.isObjectLiteralExpression(node) &&
      node.properties.length >= 2 &&
      node.properties.every((p) => ts.isPropertyAssignment(p) && isColor(p.initializer))
    )
      colors = node.properties.map((p) => p.initializer.text)
    if (colors) {
      const existing = palettes.find((p) => p.file === file && JSON.stringify(p.colors) === JSON.stringify(colors))
      if (existing) {
        if (positions) existing.positions = positions
      } else
        palettes.push({
          name: name || path.basename(file),
          colors,
          ...(positions ? { positions } : {}),
          file,
          line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
        })
    }
    ts.forEachChild(node, (child) => visit(child, name))
  }
  visit(ast)
}
const projects = files
  .filter((f) => f.startsWith('public/data/projects/') && f.endsWith('.json'))
  .map((file) => ({ file, data: JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) }))
for (const { file, data } of projects) {
  const seen = new Set()
  function visit(obj, pointer) {
    if (!obj || typeof obj !== 'object') return
    if (obj.category?.colors) {
      const entries = Object.entries(obj.category.colors)
      const isMissing = (label) => /^(not reported|no data|missing|unknown)$/i.test(label.trim())
      const colors = entries.filter(([label]) => !isMissing(label)).map(([, value]) => value)
      const missingColor = entries.find(([label]) => isMissing(label))?.[1] ?? obj.category.fallback
      const signature = JSON.stringify([colors, missingColor])
      if (colors.length && !seen.has(signature)) {
        palettes.push({
          name: `${data.slug} · ${obj.category.property}`,
          colors,
          ...(missingColor ? { missingColor } : {}),
          file,
          pointer: pointer + '/category/colors',
        })
        seen.add(signature)
      }
    }
    for (const [key, value] of Object.entries(obj)) visit(value, `${pointer}/${key}`)
  }
  visit(data, '')
}
// Remaining literal colours stay inspectable without misrepresenting them as
// designed gradients (includes UI colour roles and inline map expressions).
for (const file of files) {
  const known = new Set(palettes.filter((p) => p.file === file).flatMap((p) => p.colors.map(normalize)))
  const colors = [...new Set(occurrences.filter((o) => o.file === file && !known.has(o.color)).map((o) => o.color))]
  if (colors.length) palettes.push({ name: `Other colours · ${file}`, colors, file, kind: 'source' })
}
const utilityFamilies = new Map()
for (const token of tokens) {
  const match = token.token.match(/-([a-z]+)-(50|[1-9]00|950)(?:\/\d+)?$/)
  if (!match || !tailwindColors[match[1]]?.[match[2]]) continue
  const family = utilityFamilies.get(match[1]) ?? { shades: new Set(), files: new Set() }
  family.shades.add(Number(match[2]))
  family.files.add(token.file)
  utilityFamilies.set(match[1], family)
}
for (const [family, usage] of [...utilityFamilies].sort()) {
  const positions = [...usage.shades].sort((a, b) => a - b)
  palettes.push({
    name: `Tailwind ${family} · used shades`,
    colors: positions.map((shade) => tailwindColors[family][shade]),
    positions,
    file: 'tailwindcss/colors',
    kind: 'utility',
    utilityFiles: [...usage.files],
  })
}
function resolveImport(file, specifier) {
  const target = specifier.startsWith('@/')
    ? 'src/' + specifier.slice(2)
    : specifier.startsWith('.')
      ? path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
      : null
  if (!target) return null
  return (
    [target, ...['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'].map((ext) => target + ext)].find((f) =>
      parsed.has(f),
    ) ?? null
  )
}
const imports = new Map()
for (const [file, ast] of parsed) {
  const deps = new Set()
  function visit(n) {
    if (
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
      n.moduleSpecifier &&
      ts.isStringLiteral(n.moduleSpecifier)
    ) {
      const dep = resolveImport(file, n.moduleSpecifier.text)
      if (dep) deps.add(dep)
    }
    if (
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteral(n.arguments[0])
    ) {
      const dep = resolveImport(file, n.arguments[0].text)
      if (dep) deps.add(dep)
    }
    ts.forEachChild(n, visit)
  }
  visit(ast)
  imports.set(file, deps)
}
const routes = [],
  app = parsed.get('src/App.tsx'),
  componentFiles = new Map()
function readApp(n) {
  if (ts.isVariableDeclaration(n) && n.initializer) {
    const matches = n.initializer.getText(app).match(/import\(['"]([^'"]+)['"]\)/)
    if (matches) componentFiles.set(n.name.getText(app), resolveImport('src/App.tsx', matches[1]))
  }
  if (ts.isJsxSelfClosingElement(n) && n.tagName.getText(app) === 'Route') {
    const attrs = n.attributes.properties
    const route = attrs.find((a) => a.name?.getText(app) === 'path')?.initializer
    const element = attrs.find((a) => a.name?.getText(app) === 'element')?.initializer
    const component = element?.getText(app).match(/<([A-Z]\w*)/)?.[1]
    if (route && ts.isStringLiteral(route) && componentFiles.has(component) && !route.text.includes(':'))
      routes.push({ href: route.text, file: componentFiles.get(component) })
  }
  ts.forEachChild(n, readApp)
}
readApp(app)
function reaches(start, target, seen = new Set()) {
  if (start === target) return true
  if (seen.has(start)) return false
  seen.add(start)
  return [...(imports.get(start) ?? [])].some((dep) => reaches(dep, target, seen))
}
for (const p of palettes) {
  const name = p.name.toLowerCase()
  p.kind ??= /bivariate/.test(name)
    ? 'bivariate'
    : /map_themes/.test(name) || p.file.includes('theme-presets')
      ? 'basemap'
      : /aqhi|walkability_mi/.test(name)
        ? 'reference'
        : /heatmap|wars_heatmap/.test(name)
          ? 'heatmap'
          : /risk_band_colors|category_colors/.test(name)
            ? 'categorical'
            : /change_band|residual/.test(name)
              ? 'diverging'
              : /color_scales|score_palette_profiles|value_stops|_band|year_stops/.test(name)
                ? 'ordered'
                : 'unclassified'
  const project = projects.find((pr) => pr.file === p.file)
  p.pages = project
    ? [{ href: `/dev/projects/${project.data.slug}`, evidence: 'Project package' }]
    : routes
        .filter((r) => reaches(r.file, p.file))
        .map((r) => ({ href: r.href, evidence: 'Source-module import path; verify active layer' }))
  if (p.utilityFiles)
    p.pages = routes
      .filter((r) => p.utilityFiles.some((file) => reaches(r.file, file)))
      .map((r) => ({
        href: r.href,
        evidence: 'Utility colour family occurs in an imported module; variants and opacity differ',
      }))
  p.directReferences = []
  const [symbol, member, ...rest] = p.name.split('.')
  if (member && !rest.length && !project) {
    for (const [file, ast] of parsed) {
      if (file === p.file) continue
      const localNames = ast.statements.filter(ts.isImportDeclaration).flatMap((n) => {
        if (!ts.isStringLiteral(n.moduleSpecifier) || resolveImport(file, n.moduleSpecifier.text) !== p.file) return []
        const bindings = n.importClause?.namedBindings
        return bindings && ts.isNamedImports(bindings)
          ? bindings.elements.filter((e) => (e.propertyName ?? e.name).text === symbol).map((e) => e.name.text)
          : []
      })
      if (!localNames.length) continue
      function reference(n) {
        if (
          ts.isPropertyAccessExpression(n) &&
          localNames.includes(n.expression.getText(ast)) &&
          n.name.text === member
        )
          p.directReferences.push({ file, line: ast.getLineAndCharacterOfPosition(n.getStart(ast)).line + 1 })
        ts.forEachChild(n, reference)
      }
      reference(ast)
    }
  }
  p.directPages = project
    ? p.pages
    : routes
        .filter((r) => p.directReferences.some((ref) => reaches(r.file, ref.file)))
        .map((r) => ({ href: r.href, evidence: 'Explicit palette-member reference in an imported module' }))
  p.id = `${p.file}::${p.name}::${p.line ?? p.pointer ?? ''}`
}
// Compare only explicit sibling theme definitions. A single authored palette
// does not establish equal rendered appearance (opacity and basemaps can differ).
for (const p of palettes) {
  const variant = p.name.match(/^(.*)(\.| · )(light|dark)$/)
  const sibling =
    variant &&
    palettes.find(
      (candidate) =>
        candidate.file === p.file &&
        candidate.name === `${variant[1]}${variant[2]}${variant[3] === 'light' ? 'dark' : 'light'}`,
    )
  if (sibling) {
    p.theme = {
      status:
        JSON.stringify(p.colors.map(normalize)) === JSON.stringify(sibling.colors.map(normalize))
          ? 'same'
          : 'different',
      variant: variant[3],
      counterpartId: sibling.id,
      evidence: 'Explicit light/dark sibling definitions; compares authored colour values in order.',
    }
  } else if (['source', 'utility', 'basemap'].includes(p.kind) || /light|dark/i.test(p.name)) {
    p.theme = {
      status: 'unknown',
      evidence: 'Mixed source colours, utility shades or an unpaired theme definition; theme behaviour needs review.',
    }
  } else {
    p.theme = {
      status: 'same',
      evidence:
        'Single authored palette; no paired theme variant identified. Consumers may still change opacity, colours or basemaps.',
    }
  }
}
const inventory = Object.values(
  occurrences.reduce((acc, entry) => {
    const row = (acc[entry.color] ??= { color: entry.color, occurrences: 0, locations: [] })
    row.occurrences++
    if (!row.locations.some((l) => l.file === entry.file && l.line === entry.line))
      row.locations.push({ file: entry.file, line: entry.line })
    return acc
  }, {}),
).sort((a, b) => b.occurrences - a.occurrences || a.color.localeCompare(b.color))
const groups = ['src/', 'public/data/projects/'].map((prefix) => {
  const rows = occurrences.filter((o) => o.file.startsWith(prefix))
  return {
    prefix,
    filesScanned: files.filter((f) => f.startsWith(prefix)).length,
    filesWithColors: new Set(rows.map((r) => r.file)).size,
    literals: rows.length,
    uniqueLiterals: new Set(rows.map((r) => r.color)).size,
  }
})
const report = {
  scope:
    'Static colour literals in JS/TS string nodes, project JSON and CSS; tests and generated project index excluded. Includes dev pages and uncommitted work. Does not establish runtime use. Short hex expanded; RGB/HSL equivalent spellings are not merged. Named CSS colours, numeric RGB arrays, computed expressions, external tiles, images and generated data outside project packages are not exhaustively captured.',
  groups,
  distinctLiterals: inventory.length,
  tailwind: {
    occurrences: tokens.length,
    uniqueTokens: new Set(tokens.map((t) => t.token)).size,
    files: new Set(tokens.map((t) => t.file)).size,
  },
  projectBasemaps: projects.reduce((a, { data }) => {
    if (data.workspace?.type === 'story-map') {
      const key = data.workspace.map?.basemap ?? 'auto (default)'
      a[key] = (a[key] ?? 0) + 1
    }
    return a
  }, {}),
  palettes,
  inventory,
  tailwindOccurrences: tokens,
}
fs.writeFileSync(path.join(out, 'inventory.json'), JSON.stringify(report, null, 2) + '\n')
const csv = [['color', 'file', 'line'], ...occurrences.map((o) => [o.color, o.file, o.line])]
  .map((row) => row.map((c) => '"' + String(c).replaceAll('"', '""') + '"').join(','))
  .join('\n')
fs.writeFileSync(path.join(out, 'inventory.csv'), csv + '\n')
const catalogPath = path.join(root, 'src/pages/dev-color-palettes/catalog.generated.json')
fs.mkdirSync(path.dirname(catalogPath), { recursive: true })
const catalog = JSON.stringify(report) + '\n'
if (process.argv.includes('--check')) {
  if (!fs.existsSync(catalogPath) || fs.readFileSync(catalogPath, 'utf8') !== catalog)
    throw new Error('Colour catalog is stale; run node scripts/audit-map-colors.mjs')
} else fs.writeFileSync(catalogPath, catalog)
console.log(
  JSON.stringify(
    {
      groups,
      distinctLiterals: report.distinctLiterals,
      tailwind: report.tailwind,
      projectBasemaps: report.projectBasemaps,
      paletteRows: palettes.length,
      report: '/dev/color-palettes',
    },
    null,
    2,
  ),
)
