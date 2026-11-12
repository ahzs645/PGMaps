/// <reference types="vite/client" />

// The runtime file behind the package's own entry; see src/lib/maplibre-gl-entry.ts.
declare module 'maplibre-gl/dist/maplibre-gl.mjs' {
  export * from 'maplibre-gl'
}
