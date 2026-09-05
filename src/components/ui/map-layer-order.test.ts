import type MapLibreGL from 'maplibre-gl'
import { expect, it } from 'vitest'
import { registerMapLayerOrder } from './map-layer-order'
it('restores package order when a lower layer arrives late, and releases registrations', () => {
  let order = ['upper-fill', 'upper-line']
  const map = {
    getLayer: (id: string) => order.includes(id),
    moveLayer: (id: string) => {
      order = order.filter((item) => item !== id).concat(id)
    },
  } as unknown as MapLibreGL.Map
  const remove = registerMapLayerOrder(map, ['upper-fill', 'upper-line'], 2)
  order.push('lower-fill', 'lower-line')
  registerMapLayerOrder(map, ['lower-fill', 'lower-line'], 1)
  expect(order).toEqual(['lower-fill', 'lower-line', 'upper-fill', 'upper-line'])
  remove()
  order = order.filter((id) => !id.startsWith('upper'))
  order.push('middle-fill')
  registerMapLayerOrder(map, ['middle-fill'], 1.5)
  expect(order).toEqual(['lower-fill', 'lower-line', 'middle-fill'])
})
