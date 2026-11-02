import { useEffect, useMemo } from 'react'
import { Map, MapControls, MapScaleBar, useMap } from '@/components/ui/map'
import { MapFillLayer } from '@/components/ui/map-layers'
import { LegendItem, MapLegendPanel } from '@/components/ui/map-panels'
import { mapTooltipHtml } from '@/components/ui/map-tooltip-card'
import { albersBoxToLngLat, multiPolygonToLngLat } from '../dev-avast/projection'
import { bboxOf } from '../dev-avast/geometry'
import { summaryRecord } from './exports'
import type { AnalysisResult, BBox } from './types'

function Camera({ box }: { box: BBox | null }) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!map || !isLoaded || !box) return
    const [west, south, east, north] = albersBoxToLngLat(box)
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 55, maxZoom: 15, duration: 400 },
    )
  }, [map, isLoaded, box])
  return null
}

export function ThlbMap({
  result,
  selected,
  onSelect,
}: {
  result: AnalysisResult | null
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  const data = useMemo(() => {
    const areas: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features:
        result?.areas.map((area, index) => ({
          type: 'Feature' as const,
          geometry: multiPolygonToLngLat(area.geometry),
          properties: { id: area.id, ...summaryRecord(result.rows[index]) },
        })) ?? [],
    }
    // Draw the union ledger: overlapping assessment areas never stack proxy fills.
    const pieces: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features:
        result?.combinedPieces.map((piece) => ({
          type: 'Feature' as const,
          geometry: multiPolygonToLngLat(piece.geometry),
          properties: { kind: piece.kind, factor: piece.factor },
        })) ?? [],
    }
    return { areas, pieces }
  }, [result])
  const box = useMemo(() => {
    const areas = selected ? result?.areas.filter((area) => area.id === selected) : result?.areas
    return areas?.length ? bboxOf(areas.flatMap((area) => area.geometry)) : null
  }, [result, selected])
  return (
    <Map center={[-123.4, 54.2]} zoom={6} controls={<MapControls position="top-right" showCompass showFullscreen />}>
      <Camera box={box} />
      <MapFillLayer
        data={data.pieces}
        fillColor={
          [
            'case',
            ['==', ['get', 'factor'], null],
            '#d97706',
            ['==', ['get', 'kind'], 'official'],
            '#15803d',
            '#7c3aed',
          ] as never
        }
        fillOpacity={0.65}
        lineWidth={0.25}
      />
      <MapFillLayer
        data={data.areas}
        fillColor="#e879f9"
        fillOpacity={0.08}
        lineColor="#d946ef"
        lineWidth={2}
        lineOpacity={1}
        selectedId={selected}
        idProperty="id"
        onFeatureClick={(id) => onSelect(String(id) === selected ? null : String(id))}
        hoverHtml={(p) =>
          mapTooltipHtml({
            title: String(p.Area_ID),
            rows: [
              ['Known THLB', `${Number(p.Known_THLB_ha).toFixed(2)} ha`],
              ['No source', `${Number(p.No_source_ha).toFixed(2)} ha`],
            ],
          })
        }
      />
      <MapScaleBar />
      <MapLegendPanel title="THLB source coverage" collapsible defaultCollapsed="mobile" width="fit">
        <LegendItem color="#15803d" label="Official TSR" />
        <LegendItem color="#7c3aed" label="Proxy estimate" />
        <LegendItem color="#d97706" label="Missing official factor" />
        <LegendItem color="#d946ef" label="Assessment outline; unfilled gaps are unknown" />
      </MapLegendPanel>
    </Map>
  )
}
