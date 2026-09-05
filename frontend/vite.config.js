import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from "vite";
import tailwindcss from '@tailwindcss/vite'


// https://vite.dev/config/
export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {

    plugins: [react(), tailwindcss()],
    server: {
      port: 3000,
      proxy: {
        // Forward /api/* → Express gateway on :5000
        "/api": {
          target: env.VITE_API_URL || "http://localhost:5000",
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'jsdom',
    }
  }
});
