import { PlaybackControls } from '@pgmaps/geo-toolkit/ui/playback-controls'
import { useMemo, useState } from 'react'
import { featureTime, type Mission } from './model'

export function TimeBar({ mission, change }: { mission: Mission; change: (fn: (m: Mission) => Mission) => void }) {
  const [playing, setPlaying] = useState(false)
  const extent = useMemo(() => {
    let min = Infinity,
      max = -Infinity
    for (const layer of mission.layers)
      if (layer.timeProperty)
        for (const f of layer.data.features) {
          const t = featureTime(f, layer.timeProperty)
          if (t !== null) {
            min = Math.min(min, t)
            max = Math.max(max, t)
          }
        }
    return Number.isFinite(min)
      ? { min: Math.floor(min / 86400000) * 86400000, max: Math.floor(max / 86400000) * 86400000 }
      : null
  }, [mission.layers])
  const frames = extent ? Math.min(36600, Math.floor((extent.max - extent.min) / 86400000) + 1) : 0
  const frame = extent
    ? Math.min(frames - 1, Math.max(0, Math.round((Date.parse(mission.time.end) - extent.min) / 86400000)))
    : 0
  return (
    <div className="mm-timebar" aria-label="Mission time control">
      <div className="mm-time-dates">
        <strong>
          TIME WINDOW <span>UTC</span>
        </strong>
        <input
          aria-label="Time window start"
          type="date"
          max={mission.time.end}
          value={mission.time.start}
          onChange={(e) => {
            const start = e.target.value
            if (start)
              change((m) => ({ ...m, time: { ...m.time, start, end: m.time.end < start ? start : m.time.end } }))
          }}
        />
        <span>—</span>
        <input
          aria-label="Time window end"
          type="date"
          min={mission.time.start}
          value={mission.time.end}
          onChange={(e) => {
            const end = e.target.value
            if (end) change((m) => ({ ...m, time: { ...m.time, end, start: m.time.start > end ? end : m.time.start } }))
          }}
        />
      </div>
      <PlaybackControls
        frame={frame}
        frameCount={frames}
        playing={playing}
        onPlayingChange={setPlaying}
        intervalMs={750}
        frameLabel={
          extent ? `${mission.time.start} → ${mission.time.end}` : 'Set a layer’s time field to enable playback'
        }
        onFrameChange={(i) => {
          if (!extent) return
          const end = new Date(extent.min + i * 86400000).toISOString().slice(0, 10)
          change((m) => ({ ...m, time: { ...m.time, end, start: m.time.start > end ? end : m.time.start } }))
        }}
      />
    </div>
  )
}
