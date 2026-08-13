import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { apiPlugin } from './server/middleware.mjs'

export default defineConfig({
  plugins: [react(), apiPlugin()],
  server: { port: 5180, host: '127.0.0.1' },
})
