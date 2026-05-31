import { useMemo } from 'react'
import { formatNullableNumber } from './shared'
import { CANUE_V2_ENABLED, type CanueVariableSelection } from './canueV2'
import {
  canueBoundaryPaint,
  getCanueV2VariableLabel,
  getCanueVariableLabel,
  renderCanueDisplayLabel,
  type BoundaryFeatureCollection,
  type CanueBoundaryFeatureCardData,
  type CanueBoundaryLevel,
  type CanueBoundaryResult,
  type CanueFile,
} from './canueCore'

type BoundaryLayerData = Pick<CanueBoundaryResult, 'data' | 'loading' | 'minValue' | 'maxValue' | 'validBoundaryCount'>

interface UseCanueBoundaryLayerArgs {
  activeCanueBoundaryData: BoundaryLayerData
  activeCanueBoundaryProperty: string
  canueBoundaryLevel: CanueBoundaryLevel
  selectedCanueBoundaryId: string | null
  selectedCanueFile: CanueFile | null
  selectedCanueV2Selection: CanueVariableSelection | null
  selectedCanueVariable: string | null
}

export function useCanueBoundaryLayer({
  activeCanueBoundaryData,
  activeCanueBoundaryProperty,
  canueBoundaryLevel,
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
          Number(selectedCanueBoundary.properties?.[selectedCanueV2Selection.property]),
        ),
        recordCount: Number(selectedCanueBoundary.properties?.rowCount ?? 0),
        recordLabel: 'decoded grid features',
      }
    }

    if (selectedCanueFile && selectedCanueVariable) {
      return {
        title: String(selectedCanueBoundary.properties?.boundaryName ?? 'Selected boundary'),
        metricLabel: renderCanueDisplayLabel(getCanueVariableLabel(selectedCanueFile, selectedCanueVariable)),
        metricValue: formatNullableNumber(Number(selectedCanueBoundary.properties?.[activeCanueBoundaryProperty])),
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

  const renderedCanueBoundaryLayer =
    stableCanueBoundaryLayer?.boundaryLevel === canueBoundaryLevel ? stableCanueBoundaryLayer : null
  const renderedCanueFillColor = useMemo(() => {
    if (!renderedCanueBoundaryLayer) return '#e5e7eb'
    return canueBoundaryPaint(
      renderedCanueBoundaryLayer.property,
      renderedCanueBoundaryLayer.minValue,
      renderedCanueBoundaryLayer.maxValue,
    )
  }, [renderedCanueBoundaryLayer])

  return {
    selectedCanueBoundary,
    selectedCanueBoundaryCard,
    canueBoundaryLayerReady,
    stableCanueBoundaryLayer,
    renderedCanueBoundaryLayer,
    renderedCanueFillColor,
  }
}
