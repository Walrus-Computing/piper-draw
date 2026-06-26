import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import path from 'path'

// Second build pass: produces a single, fully-inlined `dist/viewer.html` used
// by the standalone-HTML export (utils/htmlExport.ts). Runs AFTER the main
// `vite build` with emptyOutDir:false so it appends to dist/ without wiping
// the SPA. viteSingleFile inlines all JS/CSS so the export has no external deps.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: path.resolve(__dirname, 'viewer.html'),
    },
  },
})
