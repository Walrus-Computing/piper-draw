import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import license from 'rollup-plugin-license'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      plugins: [
        license({
          thirdParty: {
            output: {
              file: path.resolve(__dirname, 'dist', 'LICENSES.txt'),
            },
          },
        }),
      ],
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
