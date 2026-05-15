import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { aqmapApiPlugin } from './src/maps/aqmap/server/aqmapApiPlugin'

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react(), aqmapApiPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/maplibre-gl')) return 'maplibre'
          if (id.includes('node_modules/@turf')) return 'turf'
        }
      }
    }
  },
  server: {
    port: 5173,
    host: '0.0.0.0'
  }
})
