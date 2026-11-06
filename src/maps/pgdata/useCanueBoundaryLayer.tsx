import { useMemo, useState } from 'react'
import { formatNullableNumber } from './shared'
import { CANUE_V2_ENABLED, type CanueVariableSelection } from './canueV2'
import {
  buildBoundaryIndex,
  canueBoundaryFeatureState,
  canueBoundaryMetric,
  canueBoundaryPaint,
  getCanueV2VariableLabel,
  getCanueVariableLabel,
  renderCanueDisplayLabel,
  resolvePeriodScale,
  type BoundaryFeatureCollection,
  type BoundaryLevelConfig,
  type CanueBoundaryFeatureCardData,
  type CanueBoundaryLevel,
  type CanueBoundaryResult,
  type CanueColorScale,
  type CanueFile,
} from './canueCore'

type BoundaryLayerData = Pick<CanueBoundaryResult, 'data' | 'loading' | 'minValue' | 'maxValue' | 'validBoundaryCount'>

interface UseCanueBoundaryLayerArgs {
  activeCanueBoundaryData: BoundaryLayerData
  activeCanueBoundaryProperty: string
  canueBoundaries: BoundaryFeatureCollection | null
  canueBoundaryConfig: BoundaryLevelConfig
  canueBoundaryLevel: CanueBoundaryLevel
  canueTimelineScale: CanueColorScale | null
  selectedCanueBoundaryId: string | null
  selectedCanueFile: CanueFile | null
  selectedCanueV2Selection: CanueVariableSelection | null
  selectedCanueVariable: string | null
}

export function useCanueBoundaryLayer({
  activeCanueBoundaryData,
  activeCanueBoundaryProperty,
  canueBoundaries,
  canueBoundaryConfig,
  canueBoundaryLevel,
  canueTimelineScale,
  selectedCanueBoundaryId,
  selectedCanueFile,
  selectedCanueV2Selection,
  selectedCanueVariable,
}: UseCanueBoundaryLayerArgs) {
  const selectedCanueBoundary = useMemo(() => {
    if (!selectedCanueBoundaryId) return null
    return (
      activeCanueBoundaryData.data.features.find((feature) => {
        const featureId = feature.properties?.boundaryId ?? feature.id
        return featureId != null && String(featureId) === selectedCanueBoundaryId
      }) ?? null
    )
  }, [activeCanueBoundaryData.data.features, selectedCanueBoundaryId])

  const selectedCanueBoundaryCard = useMemo<CanueBoundaryFeatureCardData | null>(() => {
    if (!selectedCanueBoundary) return null

    if (CANUE_V2_ENABLED && selectedCanueV2Selection) {
      return {
        title: String(selectedCanueBoundary.properties?.boundaryName ?? 'Selected boundary'),
        metricLabel: renderCanueDisplayLabel(getCanueV2VariableLabel(selectedCanueV2Selection)),
        metricValue: formatNullableNumber(
          canueBoundaryMetric(selectedCanueBoundary, selectedCanueV2Selection.property),
        ),
        recordCount: Number(selectedCanueBoundary.properties?.rowCount ?? 0),
        recordLabel: 'decoded grid features',
      }
    }

    if (selectedCanueFile && selectedCanueVariable) {
      return {
        title: String(selectedCanueBoundary.properties?.boundaryName ?? 'Selected boundary'),
        metricLabel: renderCanueDisplayLabel(getCanueVariableLabel(selectedCanueFile, selectedCanueVariable)),
        metricValue: formatNullableNumber(canueBoundaryMetric(selectedCanueBoundary, activeCanueBoundaryProperty)),
        recordCount: Number(selectedCanueBoundary.properties?.rowCount ?? 0),
        recordLabel: 'source records',
      }
    }

    return null
  }, [
    activeCanueBoundaryProperty,
    selectedCanueBoundary,
    selectedCanueFile,
    selectedCanueV2Selection,
    selectedCanueVariable,
  ])

  const canueBoundaryLayerReady = useMemo(
    () =>
      activeCanueBoundaryData.data.features.some((feature) =>
        Number.isFinite(Number(feature.properties?.[activeCanueBoundaryProperty])),
      ),
    [activeCanueBoundaryData.data.features, activeCanueBoundaryProperty],
  )
  const stableCanueBoundaryLayer = useMemo<{
    data: BoundaryFeatureCollection
    property: string
    minValue: number | null
    maxValue: number | null
    boundaryLevel: CanueBoundaryLevel
  } | null>(() => {
    if (!canueBoundaryLayerReady) return null
    return {
      data: activeCanueBoundaryData.data,
      property: activeCanueBoundaryProperty,
      minValue: activeCanueBoundaryData.minValue,
      maxValue: activeCanueBoundaryData.maxValue,
      boundaryLevel: canueBoundaryLevel,
    }
  }, [
    activeCanueBoundaryData.data,
    activeCanueBoundaryData.maxValue,
    activeCanueBoundaryData.minValue,
    activeCanueBoundaryProperty,
    canueBoundaryLayerReady,
    canueBoundaryLevel,
  ])
  // Guarded render-phase state adjustment: the last ready layer bridges the
  // gap while fresh data for the same boundary level loads.
  const [lastReadyCanueBoundaryLayer, setLastReadyCanueBoundaryLayer] = useState<typeof stableCanueBoundaryLayer>(null)
  if (stableCanueBoundaryLayer && stableCanueBoundaryLayer !== lastReadyCanueBoundaryLayer) {
    setLastReadyCanueBoundaryLayer(stableCanueBoundaryLayer)
  }

  const renderedCanueBoundaryLayer =
    stableCanueBoundaryLayer?.boundaryLevel === canueBoundaryLevel
      ? stableCanueBoundaryLayer
      : lastReadyCanueBoundaryLayer?.boundaryLevel === canueBoundaryLevel
        ? lastReadyCanueBoundaryLayer
        : null
  // The drawn shapes stay one object for as long as the boundaries do. Time only
  // changes feature state, so a step never re-sends and re-tiles every polygon.
  const canueBoundaryShapes = useMemo<BoundaryFeatureCollection | null>(() => {
    if (!canueBoundaries) return null
    return {
      type: 'FeatureCollection',
      features: buildBoundaryIndex(canueBoundaries, canueBoundaryConfig).map(({ feature, id, name }) => ({
        ...feature,
        properties: { boundaryId: id, boundaryName: name },
      })),
    }
  }, [canueBoundaries, canueBoundaryConfig])
  const renderedCanueFeatureState = useMemo(
    () =>
      renderedCanueBoundaryLayer
        ? canueBoundaryFeatureState(renderedCanueBoundaryLayer.data.features, renderedCanueBoundaryLayer.property)
        : null,
    [renderedCanueBoundaryLayer],
  )
  // A shared timeline scale must not follow each period's own range, or every
  // step would hand MapLibre a new paint expression.
  const periodMinValue = canueTimelineScale ? null : (renderedCanueBoundaryLayer?.minValue ?? null)
  const periodMaxValue = canueTimelineScale ? null : (renderedCanueBoundaryLayer?.maxValue ?? null)
  const renderedCanueFillColor = useMemo(
    () => canueBoundaryPaint(canueTimelineScale ?? resolvePeriodScale(periodMinValue, periodMaxValue)),
    [canueTimelineScale, periodMaxValue, periodMinValue],
  )

  return {
    selectedCanueBoundary,
    selectedCanueBoundaryCard,
    canueBoundaryLayerReady,
    stableCanueBoundaryLayer,
    renderedCanueBoundaryLayer,
    canueBoundaryShapes,
    renderedCanueFeatureState,
    renderedCanueFillColor,
  }
}
