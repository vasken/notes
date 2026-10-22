import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
// @ts-ignore — plain JS module
import { apiMiddleware } from './api.mjs';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    { name: 'notes-api', configureServer: (server) => void server.middlewares.use(apiMiddleware()) },
  ],
  server: { host: '127.0.0.1', port: 5173 },
});
