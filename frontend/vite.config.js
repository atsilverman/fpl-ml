import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: 'localhost',
    open: true,
    proxy: {
      // FPL API (CORS blocks direct browser requests); dev only; prod needs serverless proxy
      '/api/fpl': {
        target: 'https://fantasy.premierleague.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/fpl/, '/api')
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})
