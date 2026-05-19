import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: [
      'cognitive-subpanel-huddle.ngrok-free.dev',
      'cable-keep-seduce.ngrok-free.dev',
      'broaden-unlighted-shrubs.ngrok-free.dev'
    ]
  }
})