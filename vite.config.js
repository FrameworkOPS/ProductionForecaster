import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages deployment - set base to repo name
  base: '/ProductionForecaster/',
  server: {
    port: 3000,
    strictPort: true,
    host: 'localhost',
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
