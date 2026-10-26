import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    // The Go backend owns the data; only the API and the WebSocket go there.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8081' },
      '/ws': { target: 'ws://127.0.0.1:8081', ws: true },
    },
  },
  build: {
    // Uploaded to S3 by scripts/deploy-frontend.sh.
    outDir: 'dist',
    emptyOutDir: true,
  },
})
