import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The chat calls a relative '/api' — the dev server proxies it to the FastAPI
// backend so there's no CORS dance. Point VITE_BACKEND_URL elsewhere if needed.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL || 'http://localhost:8000',
        changeOrigin: true,
        // Preview runs the screen server-side; give it headroom.
        timeout: 120_000,
      },
    },
  },
})
