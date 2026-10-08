import { findFamily, loadModel } from './routing'
import type { RoutingRequest, RoutingResponse } from './routing-worker'

const context = self as unknown as {
  onmessage: (event: MessageEvent<RoutingRequest>) => void
  postMessage: (message: RoutingResponse) => void
}
let active: { id: number; controller: AbortController } | null = null

context.onmessage = ({ data }) => {
  if (data.type === 'cancel') {
    if (active?.id === data.id) { active.controller.abort(); active = null }
    return
  }
  active?.controller.abort()
  const controller = new AbortController()
  active = { id: data.id, controller }
  const current = () => active?.id === data.id && !controller.signal.aborted
  void loadModel(false, data.city).then((graph) => {
    if (!current()) return
    return findFamily(graph, data.trip, controller.signal, (family) => {
      // Point previews finish immediately; publish them once, not twice.
      if (current() && (!data.preview || data.trip.loop)) context.postMessage({ type: 'partial', id: data.id, family })
    }, data.preview)
  }).then((family) => {
    if (family && current()) { context.postMessage({ type: 'result', id: data.id, family }); active = null }
  }, (error: unknown) => {
    if (current()) { context.postMessage({ type: 'error', id: data.id, message: error instanceof Error ? error.message : 'Could not calculate a route.' }); active = null }
  })
}
