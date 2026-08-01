import { drawAsciiGlobe, globePalette } from './map-loader-globe'

type LoaderWorkerMessage =
  | {
      type: 'init'
      canvas: OffscreenCanvas
      width: number
      height: number
      dpr: number
      isDark: boolean
      exiting: boolean
      reduceMotion: boolean
      exitDuration: number
    }
  | { type: 'resize'; width: number; height: number; dpr: number }
  | { type: 'state'; isDark: boolean; exiting: boolean }

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<LoaderWorkerMessage>) => void) | null
}

let canvas: OffscreenCanvas | null = null
let ctx: OffscreenCanvasRenderingContext2D | null = null
let cssWidth = 0
let cssHeight = 0
let dpr = 1
let isDark = false
let exiting = false
let wasExiting = false
let reduceMotion = false
let exitDuration = 1700
let rotation = 0.6
let lastFrameAt = performance.now()
let exitStartedAt = 0
let timer: ReturnType<typeof setInterval> | null = null

function resize() {
  if (!canvas || !ctx) return
  canvas.width = Math.max(1, Math.floor(cssWidth * dpr))
  canvas.height = Math.max(1, Math.floor(cssHeight * dpr))
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function draw(now = performance.now()) {
  if (!ctx) return
  const dt = Math.min(0.05, (now - lastFrameAt) / 1000)
  lastFrameAt = now
  if (exiting && !wasExiting) exitStartedAt = now
  if (!exiting) exitStartedAt = 0
  wasExiting = exiting
  rotation += (Math.PI / 6) * dt
  const exitProgress = exiting ? Math.min(1, (now - exitStartedAt) / exitDuration) : 0
  drawAsciiGlobe(ctx, cssWidth, cssHeight, rotation, exitProgress, globePalette(isDark))
}

function start() {
  if (timer !== null) clearInterval(timer)
  draw()
  if (!reduceMotion) timer = setInterval(() => draw(), 1000 / 30)
}

workerScope.onmessage = (event) => {
  const message = event.data
  if (message.type === 'init') {
    canvas = message.canvas
    ctx = canvas.getContext('2d')
    cssWidth = message.width
    cssHeight = message.height
    dpr = message.dpr
    isDark = message.isDark
    exiting = message.exiting
    reduceMotion = message.reduceMotion
    exitDuration = message.exitDuration
    resize()
    start()
    return
  }

  if (message.type === 'resize') {
    cssWidth = message.width
    cssHeight = message.height
    dpr = message.dpr
    resize()
    draw()
    return
  }

  isDark = message.isDark
  exiting = message.exiting
  draw()
}
