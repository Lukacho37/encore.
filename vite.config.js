import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Garde-fou du paquet de démarrage (PLAN.md 8.3, P2.7) : le catalogue de base (shared/catalog.js, les 20 albums de la
 * graine et leurs morceaux) ne sert qu'au serveur et à la démo. S'il se retrouve dans le script chargé au démarrage du
 * site (le point d'entrée et ce qu'il importe directement), la compilation le signale avec le chemin à corriger.
 */
function seedCatalogGuard() {
  const seed = /[\\/]shared[\\/]catalog\.js$/;
  return {
    name: 'am-seed-catalog-guard',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((c) => c.type === 'chunk');
      const byFile = new Map(chunks.map((c) => [c.fileName, c]));
      const initial = new Set();
      const visit = (chunk) => {
        if (!chunk || initial.has(chunk)) return;
        initial.add(chunk);
        for (const file of chunk.imports || []) visit(byFile.get(file));
      };
      for (const chunk of chunks) if (chunk.isEntry) visit(chunk);
      const hit = [...initial].filter((c) => (c.moduleIds || Object.keys(c.modules || {})).some((id) => seed.test(id)));
      if (hit.length) {
        this.warn(`le catalogue de base (shared/catalog.js) est dans le paquet de démarrage (${hit.map((c) => c.fileName).join(', ')}) : `
          + 'les constantes de jeu viennent de @shared/rules.js (POP_TIERS du guide des raretés compris)');
      }
    },
  };
}

/**
 * Vraies pochettes de la démo publiée (scripts/demo-covers.mjs) : `DEMO_COVERS=<fichier JSON>` les intègre à la page,
 * qui ne peut charger aucune image d'un autre site. Sans la variable, le module vaut null : visuels générés.
 */
function demoCovers() {
  const id = 'virtual:demo-covers';
  return {
    name: 'am-demo-covers',
    resolveId: (source) => (source === id ? `\0${id}` : null),
    load(resolved) {
      if (resolved !== `\0${id}`) return null;
      const file = process.env.DEMO_COVERS;
      if (!file) return 'export default null;';
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return `export default ${JSON.stringify({ items: data.items || {}, tracks: data.tracks || {} })};`;
    },
  };
}

// `npm run build` : site complet servi par le serveur Node.
// `npm run build:demo` : démo autonome en un seul fichier HTML (données simulées dans le navigateur, polices comprises).
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    root: 'client',
    plugins: [react(), demoCovers(), demo ? viteSingleFile() : seedCatalogGuard()],
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
