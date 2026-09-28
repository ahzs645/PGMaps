/** Shared by the browser parser and the Node package audit. No DOM or network. */
function validateDocument(doc) {
  const errors = []
  const fail = (path, message) => errors.push(`${path}: ${message}`)
  const object = (v) => v && typeof v === 'object' && !Array.isArray(v)
  const str = (v) => typeof v === 'string' && v.trim().length > 0
  const url = (v) => typeof v === 'string' && /^(https:\/\/|\/(?!\/))/.test(v)
  const color = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
  const finite = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
  const list = (v, p) => (Array.isArray(v) ? v : (fail(p, 'expected array'), []))
  const optionalText = (v, keys, p) => {
    for (const key of keys) if (v[key] !== undefined && typeof v[key] !== 'string') fail(p + '.' + key, 'expected text')
  }
  const dict = (v, p) => (object(v) ? v : (fail(p, 'expected object'), {}))
  if (!object(doc)) return ['document: expected object']
  if (doc.schema !== 'pgmaps-editorial-v1') fail('schema', 'expected pgmaps-editorial-v1')
  if (!str(doc.title)) fail('title', 'required')
  const ids = new Set()
  const id = (v, p) => {
    if (!str(v) || !/^[A-Za-z][\w-]*$/.test(v) || ids.has(v)) fail(p, 'requires a unique safe ID')
    ids.add(v)
  }
  const categories = list(doc.categories, 'categories')
  const categoryIds = new Set()
  categories.forEach((c, i) => {
    if (!object(c) || !str(c.id) || categoryIds.has(c.id) || !str(c.label) || !color(c.color))
      fail(`categories[${i}]`, 'requires unique id, label and hex color')
    categoryIds.add(c?.id)
  })
  const maps = dict(doc.maps, 'maps'),
    views = dict(doc.views, 'views'),
    diagrams = dict(doc.diagrams, 'diagrams'),
    actions = dict(doc.actions, 'actions')
  const ref = (table, key, p) => {
    if (!str(key) || !Object.hasOwn(table, key)) fail(p, `unknown reference ${String(key)}`)
  }
  const category = (key, p) => {
    if (!categoryIds.has(key)) fail(p, `unknown category ${String(key)}`)
  }
  const camera = (v, p) => {
    if (
      !object(v) ||
      !Array.isArray(v.center) ||
      v.center.length !== 2 ||
      !finite(v.center[0], -180, 180) ||
      !finite(v.center[1], -85, 85) ||
      !finite(v.zoom, 0, 22) ||
      (v.pitch !== undefined && !finite(v.pitch, 0, 85)) ||
      (v.bearing !== undefined && !finite(v.bearing, -360, 360))
    )
      fail(p, 'invalid camera')
  }
  for (const [key, map] of Object.entries(maps)) {
    const p = `maps.${key}`
    if (!object(map)) {
      fail(p, 'expected map')
      continue
    }
    optionalText(map, ['categoryProperty'], p)
    if (!str(map.attribution)) fail(p + '.attribution', 'required')
    const seen = new Set()
    list(map.layers, p + '.layers').forEach((l, i) => {
      const q = `${p}.layers[${i}]`
      if (!object(l)) {
        fail(q, 'expected layer')
        return
      }
      if (!str(l.id) || seen.has(l.id)) fail(q + '.id', 'requires unique layer id')
      seen.add(l.id)
      if (!url(l.data)) fail(q + '.data', 'requires local path or HTTPS URL')
      if (l.format !== undefined && !['geojson', 'pmtiles'].includes(l.format))
        fail(q + '.format', 'native editorial supports geojson or pmtiles')
      if (l.format === 'pmtiles' && (!str(l.sourceLayer) || l.geometry === 'point'))
        fail(q, 'PMTiles requires polygon sourceLayer')
      if (l.geometry !== undefined && !['point', 'polygon'].includes(l.geometry))
        fail(q + '.geometry', 'unsupported geometry')
      for (const field of ['idProperty', 'labelProperty']) if (!str(l[field])) fail(q + '.' + field, 'required')
      for (const field of ['fillColor', 'lineColor']) if (!color(l[field])) fail(q + '.' + field, 'requires hex color')
      for (const field of ['fillOpacity', 'lineOpacity'])
        if (!finite(l[field], 0, 1)) fail(q + '.' + field, 'requires 0–1')
      if (!finite(l.lineWidth, 0, 20)) fail(q + '.lineWidth', 'requires 0–20')
      if (l.circleRadius !== undefined && !finite(l.circleRadius, 0, 50)) fail(q + '.circleRadius', 'requires 0–50')
      if (l.attributes) {
        if (!url(l.attributes.data) || !str(l.attributes.boundaryProperty) || !str(l.attributes.attributeProperty))
          fail(q + '.attributes', 'invalid join')
      }
      if (l.category) {
        if (
          !str(l.category.property) ||
          !object(l.category.colors) ||
          !Object.values(l.category.colors).every(color) ||
          !color(l.category.fallback)
        )
          fail(q + '.category', 'invalid palette')
      }
    })
  }
  for (const [key, v] of Object.entries(views)) {
    const p = `views.${key}`
    if (!object(v)) {
      fail(p, 'expected view')
      continue
    }
    ref(maps, v.mapId, p + '.mapId')
    camera(v.camera, p + '.camera')
    const layerIds = new Set(maps[v.mapId]?.layers?.map((l) => l.id))
    list(v.visibleLayerIds, p + '.visibleLayerIds').forEach((l) => {
      if (!layerIds.has(l)) fail(p, 'unknown layer ' + l)
    })
    if (v.highlights)
      list(v.highlights, p + '.highlights').forEach((h) => {
        if (
          !object(h) ||
          !layerIds.has(h.layerId) ||
          !str(h.property) ||
          !Array.isArray(h.values) ||
          !h.values.every((x) => typeof x === 'string') ||
          (h.dimOpacity !== undefined && !finite(h.dimOpacity, 0, 1))
        )
          fail(p + '.highlights', 'invalid highlight')
      })
    if (v.layerOverrides)
      for (const [l, o] of Object.entries(dict(v.layerOverrides, p + '.layerOverrides'))) {
        if (!layerIds.has(l) || !object(o)) {
          fail(p + '.layerOverrides', 'invalid layer')
          continue
        }
        for (const k of Object.keys(o)) {
          if (!['fillOpacity', 'lineOpacity', 'lineWidth'].includes(k) || !finite(o[k], 0, k === 'lineWidth' ? 20 : 1))
            fail(p + '.layerOverrides.' + l, 'unsupported override ' + k)
        }
      }
    if (v.legend)
      list(v.legend, p + '.legend').forEach((x) => {
        if (!str(x?.label) || !color(x?.color)) fail(p + '.legend', 'invalid entry')
      })
  }
  for (const [key, d] of Object.entries(diagrams)) {
    const p = `diagrams.${key}`
    if (!object(d) || !str(d.title) || !str(d.description)) {
      fail(p, 'requires title and description')
      continue
    }
    if (d.type === 'radial-hierarchy') {
      const nodes = list(d.nodes, p + '.nodes'),
        seen = new Map()
      if (!nodes.length || nodes.length > 300) fail(p, 'requires 1–300 nodes')
      nodes.forEach((n) => {
        if (!object(n) || !str(n.id) || seen.has(n.id) || !str(n.label)) {
          fail(p, 'invalid or duplicate node')
          return
        }
        seen.set(n.id, n)
        if (n.categoryId !== undefined) category(n.categoryId, p)
      })
      if (nodes.filter((n) => n && !n.parentId).length !== 1) fail(p, 'requires one root')
      nodes.forEach((n) => {
        const visiting = new Set()
        let cur = n
        while (cur) {
          if (visiting.has(cur.id)) {
            fail(p, 'cycle at ' + cur.id)
            break
          }
          visiting.add(cur.id)
          if (cur.parentId && !seen.has(cur.parentId)) {
            fail(p, 'missing parent ' + cur.parentId)
            break
          }
          cur = seen.get(cur.parentId)
        }
      })
    } else if (d.type === 'category-dots') {
      if (!['illustrative', 'measured'].includes(d.mode) || !str(d.unit)) fail(p, 'requires mode and unit')
      const pts = list(d.points, p + '.points'),
        seen = new Set()
      if (!pts.length || pts.length > 1000) fail(p, 'requires 1–1000 points')
      pts.forEach((pt) => {
        if (!object(pt) || !str(pt.id) || seen.has(pt.id) || !finite(pt.x, 0, 1) || !finite(pt.y, 0, 1)) {
          fail(p, 'invalid or duplicate point')
          return
        }
        seen.add(pt.id)
        category(pt.categoryId, p)
      })
      const steps = new Set()
      list(d.steps, p + '.steps').forEach((s) => {
        if (!object(s) || !str(s.id) || steps.has(s.id) || !str(s.label)) {
          fail(p, 'invalid step')
          return
        }
        steps.add(s.id)
        if (s.categoryIds) list(s.categoryIds, p).forEach((c) => category(c, p))
        if (s.region && (!finite(s.region.x, 0, 1) || !finite(s.region.y, 0, 1) || !finite(s.region.radius, 0, 1)))
          fail(p, 'invalid region')
      })
    } else fail(p, 'unsupported diagram type')
  }
  const inline = (v, p) =>
    list(v, p).forEach((part, i) => {
      if (typeof part === 'string') return
      const q = p + '[' + i + ']'
      if (!object(part) || typeof part.text !== 'string') {
        fail(q, 'invalid inline')
        return
      }
      if (
        (part.strong !== undefined && typeof part.strong !== 'boolean') ||
        (part.emphasis !== undefined && typeof part.emphasis !== 'boolean')
      )
        fail(q, 'format flags must be booleans')
      if (part.href && !(url(part.href) || /^mailto:/.test(part.href))) fail(q, 'unsafe link')
      if (part.actionId) ref(actions, part.actionId, q + '.actionId')
    })
  const image = (m, p) => {
    optionalText(m, ['caption', 'credit'], p)
    if (m.expandable !== undefined && typeof m.expandable !== 'boolean') fail(p + '.expandable', 'expected boolean')
    if (!url(m.src) || !str(m.alt)) fail(p, 'image requires safe src and alt')
  }
  const mapTargets = new Map()
  const media = (m, p, target) => {
    if (!object(m)) {
      fail(p, 'expected media')
      return
    }
    if (m.type === 'image') image(m, p)
    else if (m.type === 'diagram') {
      ref(diagrams, m.diagramId, p)
      if (m.stepId && !diagrams[m.diagramId]?.steps?.some((s) => s.id === m.stepId)) fail(p, 'unknown diagram step')
    } else if (m.type === 'map' || m.type === 'comparison') {
      ref(maps, m.mapId, p + '.mapId')
      if (target && m.type === 'map') {
        if (mapTargets.has(target) && mapTargets.get(target) !== m.mapId) fail(p, 'media region must retain one mapId')
        mapTargets.set(target, m.mapId)
      }
      for (const key of m.type === 'map' ? ['viewId'] : ['leftViewId', 'rightViewId']) {
        ref(views, m[key], p + '.' + key)
        if (views[m[key]]?.mapId !== m.mapId) fail(p, 'view belongs to different map')
      }
      if (m.type === 'comparison' && (!str(m.leftLabel) || !str(m.rightLabel))) fail(p, 'comparison needs labels')
    } else fail(p, 'unsupported media type')
  }
  const copy = (b, p) => {
    if (!object(b)) {
      fail(p, 'expected block')
      return
    }
    id(b.id, p + '.id')
    if (['paragraph', 'heading', 'quote'].includes(b.type)) inline(b.text, p + '.text')
    else if (b.type === 'list') list(b.items, p + '.items').forEach((x, i) => inline(x, p + '.items[' + i + ']'))
    else if (b.type !== 'separator') fail(p, 'unsupported prose block')
  }
  const chapters = list(doc.chapters, 'chapters')
  if (!chapters.length) fail('chapters', 'requires at least one chapter')
  chapters.forEach((ch, i) => {
    const p = `chapters[${i}]`
    if (!object(ch)) {
      fail(p, 'expected chapter')
      return
    }
    id(ch.id, p + '.id')
    if (!str(ch.title)) fail(p + '.title', 'required')
    list(ch.blocks, p + '.blocks').forEach((b, j) => {
      const q = p + `.blocks[${j}]`
      if (!object(b)) {
        fail(q, 'expected block')
        return
      }
      if (['paragraph', 'heading', 'quote', 'list', 'separator'].includes(b.type)) {
        copy(b, q)
        return
      }
      id(b.id, q + '.id')
      if (b.type === 'sidecar') {
        if (
          !['docked', 'floating'].includes(b.presentation) ||
          (b.side !== undefined && !['left', 'right', 'center'].includes(b.side)) ||
          (b.side === 'center' && b.presentation !== 'floating') ||
          (b.width !== undefined && !['medium', 'large'].includes(b.width))
        )
          fail(q, 'invalid sidecar presentation')
        const steps = list(b.steps, q + '.steps')
        if (!steps.length) fail(q, 'sidecar needs steps')
        steps.forEach((s, k) => {
          const r = q + `.steps[${k}]`
          if (!object(s)) {
            fail(r, 'expected step')
            return
          }
          id(s.id, r + '.id')
          list(s.content, r + '.content').forEach((c, n) => copy(c, r + '.content[' + n + ']'))
          media(s.media, r + '.media', b.id)
        })
      } else if (b.type === 'tour') {
        ref(maps, b.mapId, q + '.mapId')
        mapTargets.set(b.id, b.mapId)
        const stops = list(b.stops, q + '.stops')
        if (!stops.length) fail(q, 'tour needs stops')
        stops.forEach((s, k) => {
          const r = q + `.stops[${k}]`
          if (!object(s)) {
            fail(r, 'expected stop')
            return
          }
          id(s.id, r + '.id')
          if (
            !str(s.label) ||
            !Array.isArray(s.coordinates) ||
            s.coordinates.length !== 2 ||
            !finite(s.coordinates[0], -180, 180) ||
            !finite(s.coordinates[1], -85, 85)
          )
            fail(r, 'invalid stop')
          media({ type: 'map', mapId: b.mapId, viewId: s.viewId }, r)
          if (s.media?.type !== 'image') fail(r, 'tour requires image media')
          image(s.media ?? {}, r)
          list(s.content, r + '.content').forEach((c, n) => copy(c, r + '.content[' + n + ']'))
        })
      } else if (b.type === 'carousel') {
        const items = list(b.items, q + '.items')
        if (!items.length) fail(q, 'carousel needs images')
        items.forEach((m) => {
          if (m?.type !== 'image') fail(q, 'carousel accepts images')
          image(m ?? {}, q)
        })
      } else if (b.type === 'credits') inline(b.text, q + '.text')
      else media(b, q, b.id)
    })
  })
  for (const [key, a] of Object.entries(actions)) {
    const p = 'actions.' + key
    if (!object(a)) {
      fail(p, 'invalid action')
      continue
    }
    if (a.type === 'select-category') {
      if (a.categoryId !== null) category(a.categoryId, p)
    } else if (a.type === 'go-to-chapter') {
      if (!chapters.some((c) => c?.id === a.chapterId)) fail(p, 'unknown chapter')
    } else if (a.type === 'set-map-view') {
      ref(views, a.viewId, p)
      if (!mapTargets.has(a.targetId) || mapTargets.get(a.targetId) !== views[a.viewId]?.mapId)
        fail(p, 'view target is missing or belongs to another map')
    } else fail(p, 'unsupported action type')
  }
  if (doc.cover) {
    optionalText(doc.cover, ['summary', 'byline'], 'cover')
    if (!object(doc.cover) || !str(doc.cover.title)) fail('cover', 'requires title')
    for (const key of ['poster', 'video'])
      if (doc.cover[key] !== undefined && !url(doc.cover[key])) fail('cover.' + key, 'unsafe URL')
  }
  return errors
}
export function parseEditorialDocument(value) {
  const errors = validateEditorialDocument(value)
  if (errors.length) throw new Error(errors.join('\n'))
  return value
}

export function validateEditorialDocument(doc) {
  try {
    return validateDocument(doc)
  } catch {
    return ['document: malformed nested value; expected the documented object/array shape']
  }
}
