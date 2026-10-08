import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Ordinary package resolution: no PG Maps source aliases or data preparation.
export default defineConfig({
  plugins: [react()],
  css: { postcss: { plugins: [] } },
  build: { outDir: 'dist' },
})
