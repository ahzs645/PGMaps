import { compareBoundaryLayers, type DifferenceLayer } from './boundaryDifference'

self.onmessage = (event: MessageEvent<[DifferenceLayer, DifferenceLayer]>) => {
  try {
    self.postMessage({ result: compareBoundaryLayers(event.data) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Unable to compare these geometries.' })
  }
}
