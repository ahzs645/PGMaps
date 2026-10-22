import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { CrossSectionChart } from './Charts'
import { offsetCoordinate } from './engine'
import { safeAnalyzeRoad } from './analysisResult'
import { DEFAULT_ROAD_SETTINGS } from './terrain'
import { sectionSampleAt } from './sectionGeometry'
import type { Alignment, RoadTemplate, TerrainSource } from './types'

export function TemplateSandbox({ template, name }: { template: RoadTemplate; name: string }) {
  const cases = useMemo(() => {
    const alignment: Alignment = {
      id: 'sandbox',
      name: 'Template condition',
      color: '#0d9488',
      points: [
        { id: 'a', coordinate: [0, 0], radiusM: 0 },
        { id: 'b', coordinate: offsetCoordinate([0, 0], 0, 100), radiusM: 0 },
      ],
      vertical: [
        { id: 'v0', chainage: 0, elevation: 100, curveLength: 0 },
        { id: 'v1', chainage: 100, elevation: 100, curveLength: 0 },
      ],
      template,
      overrides: [],
    }
    return [
      { label: 'Cut · ground 2 m above formation', offset: 2, slope: 0 },
      { label: 'Fill · ground 2 m below formation', offset: -2, slope: 0 },
      { label: 'Ground rises to the right · 25%', offset: 0, slope: 0.25 },
      { label: 'Ground rises to the left · 25%', offset: 0, slope: -0.25 },
    ].map((condition) => {
      const source: TerrainSource = {
        elevationAt: (longitude) =>
          100 + condition.offset + ((longitude * Math.PI) / 180) * 6371008.8 * condition.slope,
      }
      const analysis = safeAnalyzeRoad(
        alignment,
        source,
        {
          ...DEFAULT_ROAD_SETTINGS,
          stationInterval: 50,
          crossSectionHalfWidth: 100,
        },
        [],
      )
      const station = analysis.stations.find((s) => Math.abs(s.chainage - 50) < 0.01)
      // Fit this display copy to actual daylight. Keep all engine samples and
      // quantities untouched, and retain the full view when either side is open.
      const canFocus = station?.complete && station.leftDaylightM !== null && station.rightDaylightM !== null
      const daylightRadius = canFocus
        ? Math.max(
            station.leftWidth,
            station.rightWidth,
            Math.abs(station.leftDaylightM!),
            Math.abs(station.rightDaylightM!),
          )
        : 100
      const focusRadius = Math.min(100, Math.max(15, Math.ceil(daylightRadius + Math.max(3, daylightRadius * 0.25))))
      const displayStation =
        canFocus && focusRadius < 100
          ? {
              ...station,
              section: [
                sectionSampleAt(station, -focusRadius),
                ...station.section.filter((p) => p.offset > -focusRadius && p.offset < focusRadius),
                sectionSampleAt(station, focusRadius),
              ],
            }
          : station
      return {
        label: condition.label,
        analysis,
        alignment,
        station: displayStation,
        focused: canFocus && focusRadius < 100,
      }
    })
  }, [template])
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          Four condition previews
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] max-w-5xl overflow-auto">
        <DialogHeader>
          <DialogTitle>{name} · section conditions</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Synthetic ground conditions test this template with the same section engine. These previews do not change the
          road or its source terrain.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {cases.map((c) => (
            <section key={c.label} className="rounded border p-2" data-preview-focused={!!c.focused}>
              <h3 className="text-xs font-medium">{c.label}</h3>
              <div className="h-[260px]">
                <CrossSectionChart station={c.station} alignment={c.alignment} analysis={c.analysis} />
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {c.focused
                  ? 'View fitted to calculated daylight; quantities retain the full sampled section.'
                  : 'Full sampled extent retained; incomplete terrain or unclosed daylight remains visible.'}
              </p>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
