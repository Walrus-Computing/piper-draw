import { defineConfig, build as viteBuild } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import license from 'rollup-plugin-license'
import path from 'path'

/**
 * Dev-only: the standalone-HTML export (utils/htmlExport.ts) fetches
 * `/viewer.html` expecting the fully-inlined viewer. The dev server otherwise
 * serves the raw entry (referencing /@vite/client + /src/...), which is broken
 * once saved to disk. This middleware lazily runs the viewer build in-memory
 * and serves the inlined result, so exports work in dev exactly as in prod.
 */
function devInlineViewer(): Plugin {
  let cached: string | null = null
  return {
    name: 'dev-inline-viewer',
    apply: 'serve',
    // Drop the cached build when any viewer source changes, so repeated exports
    // during development reflect edits without restarting the dev server.
    handleHotUpdate(ctx) {
      if (/(?:[\\/]src[\\/]viewer[\\/]|viewer\.html$|vite\.viewer\.config)/.test(ctx.file)) {
        cached = null
      }
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if ((req.url || '').split('?')[0] !== '/viewer.html') return next()
        try {
          if (!cached) {
            const result = await viteBuild({
              configFile: path.resolve(__dirname, 'vite.viewer.config.ts'),
              logLevel: 'silent',
              build: { write: false },
            })
            const outputs = Array.isArray(result) ? result : [result]
            for (const out of outputs) {
              if (!('output' in out)) continue
              for (const chunk of out.output) {
                if (chunk.type === 'asset' && chunk.fileName === 'viewer.html') {
                  cached = typeof chunk.source === 'string'
                    ? chunk.source
                    : Buffer.from(chunk.source).toString('utf8')
                }
              }
            }
          }
          if (cached) {
            res.setHeader('Content-Type', 'text/html')
            res.end(cached)
            return
          }
        } catch {
          // Fall through to the default (raw) handler on any build error.
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), devInlineViewer()],
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
    port: Number(process.env.VITE_PORT ?? 5173),
    strictPort: false,
    proxy: {
      '/api': `http://localhost:${process.env.BACKEND_PORT ?? 8000}`,
    },
  },
})
