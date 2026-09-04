#!/usr/bin/env node
/* global process, console, URL */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const draftMode = args.includes('--draft')
const packagePath = args.find((argument) => !argument.startsWith('--'))
if (!packagePath) {
  console.error('Usage: node audit-project-package.mjs <package.json> [--draft]')
  process.exit(2)
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const absolutePackagePath = resolve(process.cwd(), packagePath)
const errors = []
const warnings = []
const placeholderPattern = /^(?:tbd|todo|unknown|n\/?a|placeholder|developer review)$/i
const projectKinds = new Set(['map-story', 'raster-story', 'index-preset', 'research-pack'])
const projectThemes = new Set(['cyan', 'amber', 'emerald', 'blue', 'slate'])

let project
try {
  project = JSON.parse(readFileSync(absolutePackagePath, 'utf8'))
} catch (error) {
  console.error(`Could not read ${absolutePackagePath}: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}

const requireString = (object, key, scope = 'package') => {
  if (typeof object?.[key] !== 'string' || object[key].trim() === '') {
    errors.push(`${scope}.${key} must be a non-empty string`)
    return false
  }
  return true
}

const flagPlaceholder = (value, scope) => {
  if (typeof value !== 'string' || !placeholderPattern.test(value.trim())) return
  const message = `${scope} contains unresolved placeholder text: ${JSON.stringify(value)}`
  if (draftMode) warnings.push(message)
  else errors.push(`${message}; use --draft only for an explicitly incomplete review artifact`)
}

const requireFiniteNumber = (object, key, scope) => {
  if (typeof object?.[key] !== 'number' || !Number.isFinite(object[key])) {
    errors.push(`${scope}.${key} must be a finite number`)
    return false
  }
  return true
}

const isHttpsUrl = (value) => {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

const validateTemplate = (value, scope) => {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${scope} must be a non-empty string`)
    return
  }
  const tokens = [...value.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1])
  for (const token of tokens) {
    if (token !== 'count') errors.push(`${scope} uses unsupported template token {${token}}`)
  }
}

for (const key of ['slug', 'title', 'kind', 'theme', 'owner', 'updated', 'region', 'status', 'summary', 'sourceNote']) {
  requireString(project, key)
}
for (const key of ['owner', 'updated', 'region', 'status', 'summary', 'sourceNote']) {
  flagPlaceholder(project[key], `package.${key}`)
}
if (project.version !== 1) errors.push('package.version must be 1')
if (typeof project.slug === 'string' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.slug)) {
  errors.push('package.slug must use lowercase kebab-case')
}
if (typeof project.kind === 'string' && !projectKinds.has(project.kind))
  errors.push(`unsupported package.kind ${project.kind}`)
if (typeof project.theme === 'string' && !projectThemes.has(project.theme))
  errors.push(`unsupported package.theme ${project.theme}`)
for (const key of ['catalogMetrics', 'layers', 'scenes', 'files']) {
  if (!Array.isArray(project[key])) errors.push(`package.${key} must be an array`)
}
if (Array.isArray(project.catalogMetrics)) {
  if (project.kind === 'research-pack' && project.catalogMetrics.length === 0) {
    const message = 'research-pack catalogMetrics is empty; add sourced metrics before registration'
    if (draftMode) warnings.push(message)
    else errors.push(message)
  }
  project.catalogMetrics.forEach((metric, index) => {
    requireString(metric, 'label', `package.catalogMetrics[${index}]`)
    requireString(metric, 'value', `package.catalogMetrics[${index}]`)
    flagPlaceholder(metric?.value, `package.catalogMetrics[${index}].value`)
  })
}

const featureRegistry = {
  'summary-stats': {
    component: 'src/maps/project-explorer/features/SummaryStatsFeature.tsx',
    reference: '.agents/skills/pgmaps-project-builder/references/map-explorer-features/summary-stats.md',
  },
  timeline: {
    component: 'src/maps/project-explorer/features/TimelineFeature.tsx',
    reference: '.agents/skills/pgmaps-project-builder/references/map-explorer-features/timeline.md',
  },
  'category-filter': {
    component: 'src/maps/project-explorer/features/CategoryFilterFeature.tsx',
    reference: '.agents/skills/pgmaps-project-builder/references/map-explorer-features/category-filter.md',
  },
  'aggregate-records': {
    component: 'src/maps/project-explorer/features/AggregateRecordsFeature.tsx',
    reference: '.agents/skills/pgmaps-project-builder/references/map-explorer-features/aggregate-records.md',
  },
  search: {
    component: 'src/maps/project-explorer/features/SearchFeature.tsx',
    reference: '.agents/skills/pgmaps-project-builder/references/map-explorer-features/search.md',
  },
  'ranked-list': {
    component: 'src/maps/project-explorer/features/RankedListFeature.tsx',
    reference: '.agents/skills/pgmaps-project-builder/references/map-explorer-features/ranked-list.md',
  },
  'map-legend': {
    component: 'src/maps/project-explorer/features/MapLegendFeature.tsx',
    reference: '.agents/skills/pgmaps-project-builder/references/map-explorer-features/map-legend.md',
  },
  'location-popup': {
    component: 'src/maps/project-explorer/features/LocationPopupFeature.tsx',
    reference: '.agents/skills/pgmaps-project-builder/references/map-explorer-features/location-popup.md',
  },
}

const coverage = []
let mode = 'catalog-only'

if (project.workspace?.type === 'map-explorer') {
  mode = project.workspace.schema ?? 'map-explorer (missing schema)'
  if (project.workspace.schema !== 'map-explorer-v1') errors.push('workspace.schema must be map-explorer-v1')
  if (project.workspace.data?.adapter !== 'research-records-v1') {
    errors.push('map-explorer-v1 currently supports data.adapter research-records-v1 only')
  }
  if (!isHttpsUrl(project.workspace.data?.baseUrl)) {
    errors.push('workspace.data.baseUrl must be HTTPS')
  }
  for (const fileKey of ['overview', 'records', 'locations', 'timeline']) {
    requireString(project.workspace.data?.files, fileKey, 'workspace.data.files')
  }
  const categories = project.workspace.data?.categories
  if (!Array.isArray(categories) || categories.length === 0) {
    errors.push('workspace.data.categories must contain at least one category')
  } else {
    const categoryIds = new Set()
    categories.forEach((category, index) => {
      const scope = `workspace.data.categories[${index}]`
      requireString(category, 'id', scope)
      requireString(category, 'label', scope)
      requireString(category, 'color', scope)
      if (typeof category?.id === 'string' && categoryIds.has(category.id)) {
        errors.push(`${scope}.id duplicates category ${category.id}`)
      }
      categoryIds.add(category?.id)
    })
  }
  if (!Array.isArray(project.workspace.data?.aggregateLocationIds)) {
    errors.push('workspace.data.aggregateLocationIds must be an array')
  } else if (project.workspace.data.aggregateLocationIds.some((id) => typeof id !== 'string' || id.trim() === '')) {
    errors.push('workspace.data.aggregateLocationIds must contain only non-empty strings')
  }

  const map = project.workspace.map
  const center = map?.center
  if (
    !Array.isArray(center) ||
    center.length !== 2 ||
    !center.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate)) ||
    center[0] < -180 ||
    center[0] > 180 ||
    center[1] < -90 ||
    center[1] > 90
  ) {
    errors.push('workspace.map.center must be a valid [longitude, latitude] pair')
  }
  const hasZoom = requireFiniteNumber(map, 'zoom', 'workspace.map')
  const hasMinZoom = requireFiniteNumber(map, 'minZoom', 'workspace.map')
  const hasMaxZoom = requireFiniteNumber(map, 'maxZoom', 'workspace.map')
  if (hasMinZoom && hasMaxZoom && map.minZoom > map.maxZoom) {
    errors.push('workspace.map.minZoom must not exceed maxZoom')
  }
  if (hasZoom && hasMinZoom && map.zoom < map.minZoom) errors.push('workspace.map.zoom must be at least minZoom')
  if (hasZoom && hasMaxZoom && map.zoom > map.maxZoom) errors.push('workspace.map.zoom must not exceed maxZoom')

  for (const key of [
    'recordSingular',
    'recordPlural',
    'locationSingular',
    'locationPlural',
    'yearPlural',
    'loading',
    'unavailable',
  ]) {
    requireString(project.workspace.labels, key, 'workspace.labels')
  }
  if (!Array.isArray(project.workspace.features)) {
    errors.push('workspace.features must be an array')
  } else if (project.workspace.features.length === 0) {
    errors.push('workspace.features must contain at least one feature')
  } else {
    const seen = new Set()
    for (const feature of project.workspace.features) {
      const type = feature?.type
      if (typeof type !== 'string') {
        errors.push('every workspace feature needs a string type')
        continue
      }
      if (seen.has(type)) warnings.push(`feature ${type} appears more than once`)
      seen.add(type)
      const registration = featureRegistry[type]
      if (!registration) {
        errors.push(`feature ${type} has no registered component/reference`)
        continue
      }
      const componentExists = existsSync(resolve(repoRoot, registration.component))
      const referenceExists = existsSync(resolve(repoRoot, registration.reference))
      if (!componentExists) errors.push(`feature ${type} component is missing: ${registration.component}`)
      if (!referenceExists) errors.push(`feature ${type} reference is missing: ${registration.reference}`)
      coverage.push({ type, ...registration, componentExists, referenceExists })

      const scope = `workspace.features[${project.workspace.features.indexOf(feature)}]`
      switch (type) {
        case 'summary-stats': {
          if (!Array.isArray(feature.items) || feature.items.length === 0) {
            errors.push(`${scope}.items must contain at least one summary metric`)
            break
          }
          const allowedMetrics = new Set(['records', 'locations', 'year-range'])
          const allowedIcons = new Set(['book-open', 'map-pin', 'calendar'])
          feature.items.forEach((item, index) => {
            if (!allowedMetrics.has(item?.metric)) errors.push(`${scope}.items[${index}].metric is unsupported`)
            requireString(item, 'label', `${scope}.items[${index}]`)
            if (!allowedIcons.has(item?.icon)) errors.push(`${scope}.items[${index}].icon is unsupported`)
          })
          break
        }
        case 'timeline':
          requireString(feature, 'title', scope)
          requireString(feature, 'showLabel', scope)
          requireString(feature, 'hideLabel', scope)
          if (feature.granularity !== 'decade') errors.push(`${scope}.granularity must be decade`)
          break
        case 'category-filter':
          requireString(feature, 'title', scope)
          break
        case 'aggregate-records':
          validateTemplate(feature.triggerTemplate, `${scope}.triggerTemplate`)
          requireString(feature, 'modalTitle', scope)
          validateTemplate(feature.modalDescription, `${scope}.modalDescription`)
          break
        case 'search': {
          requireString(feature, 'placeholder', scope)
          const allowedFields = new Set(['title', 'author', 'tags'])
          if (!Array.isArray(feature.fields) || feature.fields.length === 0) {
            errors.push(`${scope}.fields must contain at least one search field`)
          } else if (feature.fields.some((field) => !allowedFields.has(field))) {
            errors.push(`${scope}.fields contains an unsupported search field`)
          }
          break
        }
        case 'ranked-list':
          requireString(feature, 'title', scope)
          if (!Number.isInteger(feature.limit) || feature.limit < 1)
            errors.push(`${scope}.limit must be a positive integer`)
          break
        case 'map-legend':
          requireString(feature, 'title', scope)
          if (feature.description !== undefined && typeof feature.description !== 'string') {
            errors.push(`${scope}.description must be a string when provided`)
          }
          break
        case 'location-popup':
          if (!Number.isInteger(feature.maxCategories) || feature.maxCategories < 1) {
            errors.push(`${scope}.maxCategories must be a positive integer`)
          }
          break
      }
    }
  }
} else if (project.workspace?.type === 'story-map') {
  mode = project.workspace.schema ?? 'story-map (missing schema)'
  if (project.workspace.schema !== 'story-map-v1') errors.push('workspace.schema must be story-map-v1')
  const workspace = project.workspace
  const map = workspace.map
  const center = map?.center
  if (
    !Array.isArray(center) ||
    center.length !== 2 ||
    !center.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate)) ||
    center[0] < -180 ||
    center[0] > 180 ||
    center[1] < -90 ||
    center[1] > 90
  ) {
    errors.push('workspace.map.center must be a valid [longitude, latitude] pair')
  }
  const hasZoom = requireFiniteNumber(map, 'zoom', 'workspace.map')
  const hasMinZoom = requireFiniteNumber(map, 'minZoom', 'workspace.map')
  const hasMaxZoom = requireFiniteNumber(map, 'maxZoom', 'workspace.map')
  if (hasMinZoom && hasMaxZoom && map.minZoom > map.maxZoom) {
    errors.push('workspace.map.minZoom must not exceed maxZoom')
  }
  if (hasZoom && hasMinZoom && map.zoom < map.minZoom) errors.push('workspace.map.zoom must be at least minZoom')
  if (hasZoom && hasMaxZoom && map.zoom > map.maxZoom) errors.push('workspace.map.zoom must not exceed maxZoom')
  if (map?.basemap !== undefined && !['auto', 'light', 'dark'].includes(map.basemap)) {
    errors.push('workspace.map.basemap must be auto, light, or dark when provided')
  }

  if (workspace.options !== undefined) {
    const options = workspace.options
    const allowedOptions = {
      layout: ['panel', 'scrolly', 'slides'],
      sceneTransition: ['ease', 'fly', 'jump'],
      mobileSheet: ['collapsed', 'half', 'full'],
      legendCollapsed: ['auto', 'always', 'never'],
      mapControls: ['auto', 'hidden'],
      cameraFit: ['auto', 'off'],
      slidesSwipeHint: ['off', 'pane', 'fullscreen', true],
    }
    for (const [key, allowed] of Object.entries(allowedOptions)) {
      if (options[key] !== undefined && !allowed.includes(options[key])) {
        errors.push(`workspace.options.${key} has an unsupported value`)
      }
    }
    if (
      options.sceneTransitionMs !== undefined &&
      (typeof options.sceneTransitionMs !== 'number' ||
        !Number.isFinite(options.sceneTransitionMs) ||
        options.sceneTransitionMs < 0 ||
        options.sceneTransitionMs > 5000)
    ) {
      errors.push('workspace.options.sceneTransitionMs must be between 0 and 5000')
    }
    for (const key of ['mobilePeekSceneText', 'mobilePeekTicker']) {
      if (options[key] !== undefined && typeof options[key] !== 'boolean') {
        errors.push(`workspace.options.${key} must be boolean when provided`)
      }
    }
  }

  const topLayerIds = new Set()
  if (Array.isArray(project.layers)) {
    project.layers.forEach((layer, index) => {
      requireString(layer, 'id', `package.layers[${index}]`)
      if (typeof layer?.id === 'string' && topLayerIds.has(layer.id)) {
        errors.push(`package.layers[${index}].id duplicates layer ${layer.id}`)
      }
      topLayerIds.add(layer?.id)
    })
  }

  const storyLayerIds = new Set()
  if (!Array.isArray(workspace.layers) || workspace.layers.length === 0) {
    errors.push('workspace.layers must contain at least one layer')
  } else {
    workspace.layers.forEach((layer, index) => {
      const scope = `workspace.layers[${index}]`
      for (const key of ['id', 'data', 'idProperty', 'labelProperty', 'fillColor', 'lineColor']) {
        requireString(layer, key, scope)
      }
      if (typeof layer?.id === 'string' && storyLayerIds.has(layer.id)) {
        errors.push(`${scope}.id duplicates story layer ${layer.id}`)
      }
      storyLayerIds.add(layer?.id)
      if (typeof layer?.id === 'string' && !topLayerIds.has(layer.id)) {
        errors.push(`${scope}.id ${layer.id} is missing from package.layers`)
      }
      if (
        typeof layer?.data === 'string' &&
        !((layer.data.startsWith('/') && !layer.data.startsWith('//')) || isHttpsUrl(layer.data))
      ) {
        errors.push(`${scope}.data must be a repository-root path or HTTPS URL`)
      }
      if (layer?.format === 'pmtiles' && (typeof layer.sourceLayer !== 'string' || layer.sourceLayer.trim() === '')) {
        errors.push(`${scope}.sourceLayer is required for PMTiles`)
      }
      if (layer?.format !== undefined && !['geojson', 'pmtiles'].includes(layer.format)) {
        errors.push(`${scope}.format must be geojson or pmtiles when provided`)
      }
      for (const key of ['fillOpacity', 'lineOpacity']) {
        if (typeof layer?.[key] !== 'number' || !Number.isFinite(layer[key]) || layer[key] < 0 || layer[key] > 1) {
          errors.push(`${scope}.${key} must be between 0 and 1`)
        }
      }
      if (typeof layer?.lineWidth !== 'number' || !Number.isFinite(layer.lineWidth) || layer.lineWidth < 0) {
        errors.push(`${scope}.lineWidth must be a non-negative number`)
      }
    })
  }

  const placeIds = new Set()
  if (!Array.isArray(workspace.places)) {
    errors.push('workspace.places must be an array')
  } else {
    workspace.places.forEach((place, index) => {
      const scope = `workspace.places[${index}]`
      requireString(place, 'id', scope)
      requireString(place, 'label', scope)
      if (
        !Array.isArray(place?.coordinates) ||
        place.coordinates.length !== 2 ||
        !place.coordinates.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate)) ||
        place.coordinates[0] < -180 ||
        place.coordinates[0] > 180 ||
        place.coordinates[1] < -90 ||
        place.coordinates[1] > 90
      ) {
        errors.push(`${scope}.coordinates must be a valid [longitude, latitude] pair`)
      }
      if (typeof place?.id === 'string' && placeIds.has(place.id))
        errors.push(`${scope}.id duplicates place ${place.id}`)
      placeIds.add(place?.id)
    })
  }

  if (!Array.isArray(project.scenes) || project.scenes.length === 0) {
    errors.push('package.scenes must contain at least one scene')
  } else {
    project.scenes.forEach((scene, index) => {
      const scope = `package.scenes[${index}]`
      for (const key of ['label', 'title', 'text', 'focus']) requireString(scene, key, scope)
      if (!Array.isArray(scene?.visibleLayerIds)) {
        errors.push(`${scope}.visibleLayerIds must be an array`)
      } else {
        for (const layerId of scene.visibleLayerIds) {
          if (typeof layerId !== 'string' || !storyLayerIds.has(layerId)) {
            errors.push(`${scope}.visibleLayerIds references unknown story layer ${String(layerId)}`)
          }
        }
      }
      if (scene?.placeIds !== undefined) {
        if (!Array.isArray(scene.placeIds)) {
          errors.push(`${scope}.placeIds must be an array when provided`)
        } else {
          for (const placeId of scene.placeIds) {
            if (typeof placeId !== 'string' || !placeIds.has(placeId)) {
              errors.push(`${scope}.placeIds references unknown place ${String(placeId)}`)
            }
          }
        }
      }
      if (scene?.camera !== undefined) {
        const cameraCenter = scene.camera?.center
        if (
          !Array.isArray(cameraCenter) ||
          cameraCenter.length !== 2 ||
          !cameraCenter.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate)) ||
          !Number.isFinite(scene.camera?.zoom)
        ) {
          errors.push(`${scope}.camera must contain a finite center and zoom`)
        }
      }
      if (scene?.highlights !== undefined) {
        if (!Array.isArray(scene.highlights)) {
          errors.push(`${scope}.highlights must be an array when provided`)
        } else {
          scene.highlights.forEach((highlight, highlightIndex) => {
            const highlightScope = `${scope}.highlights[${highlightIndex}]`
            requireString(highlight, 'layerId', highlightScope)
            requireString(highlight, 'property', highlightScope)
            if (!storyLayerIds.has(highlight?.layerId)) {
              errors.push(`${highlightScope}.layerId references unknown story layer ${String(highlight?.layerId)}`)
            } else if (!scene.visibleLayerIds?.includes(highlight.layerId)) {
              errors.push(`${highlightScope}.layerId must also appear in the scene's visibleLayerIds`)
            }
            if (!Array.isArray(highlight?.values) || highlight.values.length === 0) {
              errors.push(`${highlightScope}.values must contain at least one value`)
            }
          })
        }
      }
      if (scene?.layerOverrides !== undefined) {
        if (
          typeof scene.layerOverrides !== 'object' ||
          scene.layerOverrides === null ||
          Array.isArray(scene.layerOverrides)
        ) {
          errors.push(`${scope}.layerOverrides must be an object when provided`)
        } else {
          for (const layerId of Object.keys(scene.layerOverrides)) {
            if (!storyLayerIds.has(layerId)) errors.push(`${scope}.layerOverrides references unknown layer ${layerId}`)
            else if (!scene.visibleLayerIds?.includes(layerId)) {
              errors.push(`${scope}.layerOverrides.${layerId} must also appear in visibleLayerIds`)
            }
          }
        }
      }
    })
  }
} else if (project.kind === 'index-preset') {
  mode = 'index-preset'
  if (!project.lab || typeof project.lab !== 'object') errors.push('index-preset packages require a lab recipe')
} else if (project.workspace) {
  errors.push(`unsupported workspace.type ${String(project.workspace.type)}`)
}

console.log(`PGMaps project audit: ${project.title ?? absolutePackagePath}`)
console.log(`Mode: ${mode}`)
console.log(`Audit target: ${draftMode ? 'draft structure' : 'repository-ready structure'}`)
if (coverage.length > 0) {
  console.log('Feature coverage:')
  for (const item of coverage) {
    const status = item.componentExists && item.referenceExists ? 'ok' : 'missing'
    console.log(`- ${item.type}: ${status}`)
    console.log(`  component: ${item.component}`)
    console.log(`  reference: ${item.reference}`)
  }
}
for (const warning of warnings) console.warn(`Warning: ${warning}`)
if (errors.length > 0) {
  for (const error of errors) console.error(`Error: ${error}`)
  console.error('Audit failed.')
  process.exit(1)
}
if (draftMode) {
  console.log(
    warnings.length > 0
      ? `Draft structural audit passed with ${warnings.length} warning(s); artifact is not repository-ready.`
      : 'Draft structural audit passed; run without --draft before calling the artifact repository-ready.',
  )
} else {
  console.log('Audit passed.')
}
