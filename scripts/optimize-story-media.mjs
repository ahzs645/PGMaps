import { createHash } from 'node:crypto'
import process from 'node:process'
import console from 'node:console'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join, basename, extname, dirname, relative, sep } from 'node:path'

// Explicit authoring command, never a build dependency. Keep source snapshots.
const folder = resolve(process.argv[2] ?? 'vendor/pgmaps-story-prague')
const publicRoot = resolve('public')
// The URL the folder is served at: below public/, its own path; a story kept in
// a repository of its own says in pages/site.json where it publishes story.json.
function servedAt() {
  const site = join(folder, 'pages', 'site.json')
  if (existsSync(site)) {
    const target = JSON.parse(readFileSync(site, 'utf8')).mappings.find(([source]) => source === 'story.json')?.[1]
    if (!target) throw new Error(`${site} does not publish story.json`)
    return `/data/${dirname(target)}`
  }
  if (!folder.startsWith(`${publicRoot}${sep}`)) throw new Error(`${folder} is neither below public/ nor a story repository`)
  return `/${relative(publicRoot, folder).split(sep).join('/')}`
}
const urlBase = servedAt()
const fileFor = (url) => {
  if (!url.startsWith(`${urlBase}/`)) throw new Error(`Media outside the story: ${url}`)
  return join(folder, url.slice(urlBase.length + 1))
}
const urlFor = (file) => `${urlBase}/${relative(folder, file).split(sep).join('/')}`
const documentPath = join(folder, 'story.json')
const document = JSON.parse(readFileSync(documentPath, 'utf8'))
const manifestPath = join(folder, 'delivery.json')
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null
const recipe = { photoMaxWidth: 1920, photoQuality: 88, videoMaxWidth: 1280, videoCrf: 26, version: 1 }
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const media = []
const temporary = mkdtempSync(join(tmpdir(), 'story-delivery-'))
mkdirSync(join(folder, 'assets/delivery'), { recursive: true })
try {
  for (const [resourceId, resource] of Object.entries(document.resources)) {
    const data = resource.data
    if (!['image', 'video'].includes(resource.type) || typeof data?.url !== 'string' || !data.url.startsWith('/data/'))
      continue
    const original = fileFor(data.url)
    if (!original.startsWith(`${folder}/assets/`)) throw new Error(`Media outside the story: ${data.url}`)
    // Source diagrams remain exact PNG/SVG snapshots. Convert only JPEG photos.
    if (resource.type === 'image' && !/\.jpe?g$/i.test(original)) continue
    const source = readFileSync(original)
    const sourceSha256 = digest(source)
    const cached = previous?.media.find((item) => item.resource === resourceId && item.sourceSha256 === sourceSha256)
    if (
      cached &&
      JSON.stringify(previous.recipe) === JSON.stringify(recipe) &&
      existsSync(fileFor(cached.url))
    ) {
      if (digest(readFileSync(fileFor(cached.url))) !== cached.sha256)
        throw new Error(`Delivery hash mismatch: ${cached.url}`)
      data.deliveryUrl = cached.url
      media.push(cached)
      continue
    }
    const extension = resource.type === 'video' ? '.mp4' : '.webp'
    const output = join(temporary, `encode${extension}`)
    const encoding =
      resource.type === 'video'
        ? [
            '-vf',
            `scale=w='min(${recipe.videoMaxWidth},iw)':h=-2`,
            '-an',
            '-c:v',
            'libx264',
            '-preset',
            'slow',
            '-crf',
            String(recipe.videoCrf),
            '-pix_fmt',
            'yuv420p',
            '-movflags',
            '+faststart',
          ]
        : [
            '-vf',
            `scale=w='min(${recipe.photoMaxWidth},iw)':h=-2`,
            '-frames:v',
            '1',
            '-c:v',
            'libwebp',
            '-quality',
            String(recipe.photoQuality),
            '-compression_level',
            '6',
          ]
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', original, ...encoding, output])
    const bytes = readFileSync(output)
    if (bytes.length >= source.length * 0.9) {
      delete data.deliveryUrl
      continue
    }
    const sha256 = digest(bytes)
    const filename = `${basename(original, extname(original))}-${sha256.slice(0, 12)}${extension}`
    const destination = join(folder, 'assets/delivery', filename)
    writeFileSync(destination, bytes)
    const url = urlFor(destination)
    const dimensions = JSON.parse(
      execFileSync(
        'ffprobe',
        ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', output],
        { encoding: 'utf8' },
      ),
    ).streams[0]
    data.deliveryUrl = url
    media.push({
      resource: resourceId,
      type: resource.type,
      sourceUrl: data.url,
      sourceBytes: source.length,
      sourceSha256,
      url,
      bytes: bytes.length,
      sha256,
      ...dimensions,
    })
  }
  writeFileSync(documentPath, `${JSON.stringify(document, null, 2)}\n`)
  writeFileSync(manifestPath, `${JSON.stringify({ recipe, media }, null, 2)}\n`)
  const total = (key) => media.reduce((sum, item) => sum + item[key], 0)
  console.log(
    `${media.length} delivery copies: ${total('sourceBytes').toLocaleString()} -> ${total('bytes').toLocaleString()} bytes; originals retained.`,
  )
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
