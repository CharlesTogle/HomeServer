import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendProxyTarget = env.VITE_BACKEND_PROXY_TARGET || 'http://127.0.0.1:3000'

  return {
    plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
    server: {
      proxy: {
        '/api': {
          changeOrigin: true,
          target: backendProxyTarget,
        },
      },
    },
  }
})
