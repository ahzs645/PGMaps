import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

// Application read models, rebuilt from canonical snapshots after data:sync.
// Never modify or duplicate the source archives in the PGMaps repository.
export function restaurantLocations(file) {
  const fields = [
    'dataset',
    'source_index',
    'latitude',
    'longitude',
    'google_geocoded_address',
    'google_place_id',
    'google_location_type',
    'google_partial_match',
  ]
  return {
    locations: (file.locations ?? [])
      .filter((row) => row.dataset === 'restaurants')
      .map((row) =>
        Object.fromEntries(fields.filter((field) => row[field] !== undefined).map((field) => [field, row[field]])),
      ),
  }
}

export function searchRows(kind, data) {
  if (kind === 'restaurants')
    return data.map((r, i) => ({
      id: `food-${i}`,
      label: r.name,
      sublabel: r.address || 'Prince George',
      params: { q: r.name },
    }))
  if (kind === 'parks')
    return data.flatMap((feature, i) => {
      const p = feature.attributes ?? feature.properties ?? {}
      const name = p.ParkName || p.Location
      return name
        ? [
            {
              id: `park-${p.OBJECTID ?? i}`,
              label: name,
              sublabel: p.ParkClassification || 'Park',
              params: { tab: 'parks', q: name },
            },
          ]
        : []
    })
  if (kind === 'properties')
    return (data.features ?? []).flatMap((feature, i) => {
      const p = feature.properties ?? {}
      const address = p.address || p.ADDRESS
      return address
        ? [
            {
              id: `assessment-${p.oid_evbc || i}`,
              label: address,
              sublabel: `BC Assessment | ${p.desc || p.cat || 'Property'}`,
              params: { q: address },
            },
          ]
        : []
    })
  if (kind === 'census')
    return (data.categories ?? []).flatMap((category) => [
      {
        id: `census-category-${category.id}`,
        label: category.name,
        sublabel: `${category.group || 'Census'} | ${category.variables?.length || 0} variables`,
        params: { category: category.id },
      },
      ...(category.variables ?? []).map((variable) => ({
        id: `census-var-${category.id}-${variable.id}`,
        label: variable.label,
        sublabel: `${category.name} | ${variable.id}`,
        params: { category: category.id, variable: variable.id },
      })),
    ])
  throw new Error(`Unknown search source: ${kind}`)
}

export async function buildUiData(root) {
  const output = resolve(root, 'public/data/ui')
  await mkdir(resolve(output, 'search'), { recursive: true })
  const read = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'))
  const write = async (path, data) => {
    const json = JSON.stringify(data)
    const bytes = path.endsWith('.gz') ? gzipSync(json, { level: 9 }) : json
    await writeFile(resolve(output, path), bytes)
    console.log(`${path}: ${Buffer.byteLength(bytes).toLocaleString()} bytes`)
  }
  await write(
    'restaurant-locations.json',
    restaurantLocations(await read('public/data/geocoding/geocoded_locations.json')),
  )
  const sources = {
    restaurants: 'public/data/restaurants.json',
    parks: 'vendor/bcdatamapper/datascrapers/citypg/source/public_gis/parks.json',
    properties: 'public/data/bc-assessment/parcels.geojson',
    census: 'public/data/census/variables/catalog.json',
  }
  for (const [kind, path] of Object.entries(sources)) {
    await write(`search/${kind}.json.gz`, searchRows(kind, await read(path)))
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildUiData(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
}
