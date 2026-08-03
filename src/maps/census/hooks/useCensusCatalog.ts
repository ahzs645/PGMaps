import { useFetchData } from '@/hooks/useFetchData'
import type { CensusCatalog } from '../types'

const CATALOG_URL = '/data/census/variables/catalog.json'

export function useCensusCatalog() {
  // Dev servers answer missing files with the SPA index.html and a 200;
  // fetchJson detects that and raises it as a missing file.
  const { data: catalog, loading, error } = useFetchData<CensusCatalog>(CATALOG_URL)
  return { catalog, loading, error }
}
