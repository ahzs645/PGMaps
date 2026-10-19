import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, '../src') } },
  build: { outDir: path.resolve(__dirname, '../dist-lidar-preview'), emptyOutDir: true, sourcemap: false },
})
