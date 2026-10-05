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
      // WEB_PORT / API_URL : plusieurs copies du site en parallèle (tests), chacune vers son serveur.
      port: Number(process.env.WEB_PORT) || 5173,
      strictPort: !!process.env.WEB_PORT,
      proxy: { '/api': process.env.API_URL || 'http://localhost:3000' },
      fs: { allow: ['..'] },
    },
    build: {
      outDir: demo ? '../dist-demo' : '../dist',
      emptyOutDir: true,
      chunkSizeWarningLimit: 1500,
      // La démo doit tourner dans des lecteurs intégrés (WebView mobile, cadre isolé) :
      // un seul script classique, sans module ni import.meta, et une syntaxe plus ancienne.
      ...(demo && {
        target: ['es2019', 'safari13', 'chrome80', 'firefox78'],
        modulePreload: false,
        rolldownOptions: {
          output: { format: 'iife', inlineDynamicImports: true },
          // import.meta (préchargement de modules, routes paresseuses de react-router) devient {} : inutilisé ici.
          onLog(level, log, handler) {
            if (log.code !== 'EMPTY_IMPORT_META') handler(level, log);
          },
        },
      }),
    },
  };
});
