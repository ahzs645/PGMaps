import { useEffect, useMemo, useRef, useState } from 'react'
import type { IsolatedPoint, TreeCrop } from './treeIsolation'
import { TREE_COLOURS } from './treeIsolation'
import { prepareTreeProfile } from './treeProfiles'
import { inPolygon, pointKey, type InspectionState, type ProfileSettings } from './treeInspection'
export type ProfileInteraction = 'pick' | 'pan' | 'polygon' | 'seed'
export function ProfileCanvas({
  crop,
  settings,
  assignments,
  picked,
  selected,
  seeds,
  interaction,
  onPick,
  onSelection,
  onSeed,
  onView,
  sharedHeight,
  sharedRadius,
}: {
  crop: TreeCrop
  settings: ProfileSettings
  assignments: InspectionState['assignments']
  picked: string | null
  selected: Set<string>
  seeds: IsolatedPoint[]
  interaction: ProfileInteraction
  onPick: (p: IsolatedPoint) => void
  onSelection: (keys: string[]) => void
  onSeed: (p: IsolatedPoint) => void
  onView: (patch: Partial<ProfileSettings>) => void
  sharedHeight: number
  sharedRadius: number
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    frame = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 420, height: 360 }),
    [polygon, setPolygon] = useState<[number, number][]>([])
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const prepared = useMemo(() => prepareTreeProfile(crop), [crop])
  const points = useMemo(() => {
    const angle = (settings.angle * Math.PI) / 180
    return prepared.points
      .map((p) => ({
        ...p,
        key: pointKey(p.original),
        horizontal: p.east * Math.cos(angle) + p.north * Math.sin(angle),
        depth: -p.east * Math.sin(angle) + p.north * Math.cos(angle),
      }))
      .filter(
        (p) =>
          p.height >= settings.minHeight &&
          p.height <= settings.maxHeight &&
          (settings.showRejected || assignments[p.key] !== '0') &&
          (settings.mode === 'whole' || Math.abs(p.depth - settings.offset) <= settings.width / 2 + 1e-8),
      )
  }, [
    prepared,
    settings.angle,
    settings.minHeight,
    settings.maxHeight,
    settings.mode,
    settings.offset,
    settings.width,
    settings.showRejected,
    assignments,
  ])
  const top = settings.lockScale ? sharedHeight : Math.max(5, prepared.maximum),
    radius = settings.lockScale ? sharedRadius : prepared.radius + 1
  const scale = Math.min((size.width - 70) / (radius * 2), (size.height - 65) / top) * settings.zoom
  const x = (h: number) => size.width / 2 + (h + settings.panX) * scale,
    y = (h: number) => size.height - 35 - (h + settings.panY) * scale
  const invert = (px: number, py: number): [number, number] => [
    (px - size.width / 2) / scale - settings.panX,
    (size.height - 35 - py) / scale - settings.panY,
  ]
  useEffect(() => {
    if (!frame.current) return
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: Math.max(180, entry.contentRect.width), height: Math.max(180, entry.contentRect.height) }),
    )
    observer.observe(frame.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    setPolygon([])
  }, [crop.id, interaction, settings.angle, settings.mode, settings.width, settings.offset])
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    c.width = size.width * ratio
    c.height = size.height * ratio
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, size.width, size.height)
    ctx.fillStyle = '#fff1df'
    ctx.fillRect(40, y(2), size.width - 50, y(0) - y(2))
    ctx.font = '11px Arial'
    ctx.textAlign = 'right'
    ctx.fillStyle = '#374151'
    for (let h = 0; h <= 80; h += top > 30 ? 10 : 5) {
      const yy = y(h)
      if (yy < 20 || yy > size.height - 35) continue
      ctx.strokeStyle = '#e5e7eb'
      ctx.beginPath()
      ctx.moveTo(40, yy)
      ctx.lineTo(size.width - 10, yy)
      ctx.stroke()
      ctx.fillText(String(h), 35, yy + 4)
    }
    ctx.textAlign = 'center'
    const horizontalStep = Math.max(1, Math.ceil(Math.max(radius / 3, 40 / scale)))
    for (let h = Math.ceil(-radius / horizontalStep) * horizontalStep; h <= radius; h += horizontalStep) {
      const xx = x(h)
      if (xx < 45 || xx > size.width - 15) continue
      ctx.fillText(String(h), xx, size.height - 19)
    }
    ctx.fillText('Horizontal offset (m)', size.width / 2, size.height - 4)
    ctx.textAlign = 'left'
    ctx.fillText('Height above terrain (m)', 45, 14)
    ctx.save()
    ctx.beginPath()
    ctx.rect(40, 20, size.width - 50, size.height - 55)
    ctx.clip()
    for (const p of points) {
      const group = assignments[p.key] ?? crop.id
      ctx.fillStyle =
        p.key === picked
          ? '#e11d48'
          : selected.has(p.key)
            ? '#f59e0b'
            : group === '0'
              ? '#cbd5e1'
              : settings.colour === 'height'
                ? `hsl(${240 - Math.min(p.height / 40, 1) * 240},85%,38%)`
                : settings.colour === 'segment'
                  ? TREE_COLOURS[[...group].reduce((s, c) => s + c.charCodeAt(0), 0) % TREE_COLOURS.length]
                  : '#111'
      ctx.beginPath()
      ctx.arc(x(p.horizontal), y(p.height), p.key === picked ? 5 : settings.pointSize, 0, Math.PI * 2)
      ctx.fill()
    }
    for (const seed of seeds) {
      const p = points.find((p) => p.key === pointKey(seed))
      if (!p) continue
      ctx.strokeStyle = '#2563eb'
      ctx.lineWidth = 2
      ctx.strokeRect(x(p.horizontal) - 5, y(p.height) - 5, 10, 10)
    }
    if (polygon.length) {
      ctx.strokeStyle = '#f59e0b'
      ctx.lineWidth = 2
      ctx.beginPath()
      polygon.forEach(([xx, yy], i) => (i ? ctx.lineTo(x(xx), y(yy)) : ctx.moveTo(x(xx), y(yy))))
      ctx.stroke()
    }
    ctx.restore()
  }, [points, picked, selected, seeds, settings, size, polygon, scale])
  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as [number, number]
  }
  const nearest = (px: number, py: number) => {
    let best: (typeof points)[number] | null = null,
      d = 144
    for (const p of points) {
      const dist = (x(p.horizontal) - px) ** 2 + (y(p.height) - py) ** 2
      if (dist < d) {
        d = dist
        best = p
      }
    }
    return best
  }
  return (
    <div className="relative h-full min-h-[180px] bg-white" ref={frame}>
      <canvas
        ref={canvas}
        className="block h-full w-full touch-none"
        tabIndex={0}
        aria-label={`Interactive side profile for ${crop.id}; ${points.length} observed returns. Use the point list for keyboard inspection.`}
        onPointerDown={(e) => {
          const [px, py] = pos(e)
          if (interaction === 'pan') {
            drag.current = { x: px, y: py, panX: settings.panX, panY: settings.panY }
            e.currentTarget.setPointerCapture(e.pointerId)
          } else if (interaction === 'polygon') setPolygon((p) => [...p, invert(px, py)])
          else {
            const p = nearest(px, py)
            if (p) interaction === 'seed' ? onSeed(p.original) : onPick(p.original)
          }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const [px, py] = pos(e)
          onView({
            lockScale: false,
            panX: Math.max(-100, Math.min(100, drag.current.panX + (px - drag.current.x) / scale)),
            panY: Math.max(-100, Math.min(100, drag.current.panY - (py - drag.current.y) / scale)),
          })
        }}
        onPointerUp={() => {
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
        onDoubleClick={() => {
          if (interaction === 'polygon' && polygon.length >= 3) {
            onSelection(points.filter((p) => inPolygon([p.horizontal, p.height], polygon)).map((p) => p.key))
            setPolygon([])
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setPolygon([])
          if (e.key === 'Enter' && polygon.length >= 3) {
            onSelection(points.filter((p) => inPolygon([p.horizontal, p.height], polygon)).map((p) => p.key))
            setPolygon([])
          }
        }}
        onWheel={(e) => {
          e.preventDefault()
          onView({ lockScale: false, zoom: Math.max(1, Math.min(8, settings.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))) })
        }}
      />
      {interaction === 'polygon' && (
        <div className="absolute bottom-6 left-12 flex gap-2 bg-white/95 p-1 text-[10px] text-slate-700">
          <button
            className="underline"
            disabled={polygon.length < 3}
            onClick={() => {
              onSelection(points.filter((p) => inPolygon([p.horizontal, p.height], polygon)).map((p) => p.key))
              setPolygon([])
            }}
          >
            Finish polygon ({polygon.length} vertices)
          </button>
          <button className="underline" onClick={() => setPolygon([])}>
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
