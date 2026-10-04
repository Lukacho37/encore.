import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';

// `npm run build` : site complet servi par le serveur Node.
// `npm run build:demo` : démo autonome en un seul fichier HTML (données simulées dans le navigateur).
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    root: 'client',
    plugins: [react(), demo && viteSingleFile()].filter(Boolean),
    define: { __DEMO__: JSON.stringify(demo) },
    resolve: { alias: { '@shared': path.resolve('shared') } },
    server: {
      port: 5173,
      proxy: { '/api': 'http://localhost:3000' },
      fs: { allow: ['..'] },
    },
    build: {
      outDir: demo ? '../dist-demo' : '../dist',
      emptyOutDir: true,
      chunkSizeWarningLimit: 1500,
    },
  };
});
