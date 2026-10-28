// Vraies pochettes pour la démo publiée (claude.ai). Le site, lui, n'en copie jamais : il affiche les images depuis le
// serveur de la plateforme (server/covers.js). La démo ne le peut pas : son cadre refuse toute image venue d'un autre
// site. Ce script cherche donc chez Deezer, avec le code du site (mêmes requêtes, même choix du bon album), la pochette
// des éléments de base de la démo (20 albums, 14 singles), en télécharge une copie réduite et écrit le tout dans un
// fichier JSON (images en data: URI, liens Deezer de l'album et de ses morceaux).
//
//   node scripts/demo-covers.mjs [fichier]            défaut : data/demo-covers.json (data/ n'est pas versionné)
//   DEMO_COVERS=data/demo-covers.json npm run build:demo
//
// Le fichier reste hors du dépôt : les pochettes appartiennent à leurs ayants droit. Sans DEMO_COVERS, la démo garde
// ses visuels générés (c'est ce que construisent les tests).
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../server/config.js';
import { openDb } from '../server/db.js';
import { coverItems, createCovers } from '../server/covers.js';

const SIZE = 400;
const out = process.argv[2] || 'data/demo-covers.json';

// Les adresses Deezer portent la taille voulue : …/images/cover/<empreinte>/1000x1000-000000-80-0-0.jpg
const resized = (url) => url.replace(/\/\d+x\d+-([^/]+)$/, `/${SIZE}x${SIZE}-$1`);

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);
  const type = res.headers.get('content-type') || 'image/jpeg';
  if (!/^image\/(jpeg|png|webp)$/.test(type)) throw new Error(`type inattendu ${type} pour ${url}`);
  return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
}

const db = openDb(':memory:', { log: null });
const covers = createCovers(db, { cfg: { ...config, covers: 'deezer', spotify: null } });
await covers.warm({ force: true });
const snap = covers.snapshot();
const items = {};
for (const [key, found] of Object.entries(snap.items)) {
  const src = resized(found.thumb || found.cover);
  const data = await download(src).catch(() => download(found.thumb || found.cover));
  items[key] = { cover: data, coverW: SIZE, thumb: data, thumbW: SIZE, url: found.url, provider: 'deezer' };
}
const tracks = Object.fromEntries(Object.entries(snap.tracks).map(([id, t]) => [id, { url: t.url, provider: 'deezer' }]));
const missing = coverItems().filter((i) => !items[i.key]).map((i) => `${i.artist} — ${i.title}`);

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ fetchedAt: new Date().toISOString(), items, tracks }));
const kb = Math.round(fs.statSync(out).size / 1024);
console.log(`${Object.keys(items).length}/${coverItems().length} pochettes, ${Object.keys(tracks).length} liens de morceaux → ${out} (${kb} Ko)`);
if (missing.length) console.log(`Introuvables : ${missing.join(' · ')}`);
