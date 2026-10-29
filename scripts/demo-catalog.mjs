// Grand catalogue pour la démo publiée (claude.ai) : les albums importés d'une base, dans un fichier compact que la
// démo charge à côté de la page (client/src/demo/bigCatalog.js). Sans ce fichier (démo ouverte en local, tests), la
// démo garde ses 20 albums de base. Pochettes : la page ne peut charger aucune image d'un autre site ; si les planches
// de scripts/demo-sprites.mjs existent, chaque album porte sa case, sinon il garde son visuel généré.
//
//   DATABASE_FILE=data/albummania.db node scripts/demo-catalog.mjs [fichier]     défaut : data/demo-catalog.json
//
// Format (v1) : artists [[id, nom, genre, pays]] ; albums [[id, n° d'artiste, titre, année, genre, titres des
// morceaux séparés par \u001f, indices de popularité, case de la pochette dans les planches ou -1]] ; promos [[id, n°
// d'artiste, titre, indice, année, genre]] ; sprites { size, cols, count, prefix } (planches publiées sous covers/).
// Les albums suivent l'ordre « populaires » (indice moyen décroissant) ; la rareté se déduit de l'indice (POP_TIERS).
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../server/config.js';
import { openDb } from '../server/db.js';

const out = process.argv[2] || 'data/demo-catalog.json';
// Planches de pochettes (scripts/demo-sprites.mjs), si elles existent : case de chaque album.
const spritesFile = process.env.DEMO_SPRITES || 'data/demo-sprites/index.json';
const sheet = fs.existsSync(spritesFile) ? JSON.parse(fs.readFileSync(spritesFile, 'utf8')) : null;
const db = openDb(config.dbFile, { log: null });
const albums = db.prepare(`SELECT a.id, a.artist_id, a.title, a.year, a.genre, AVG(t.pop) AS avg
  FROM cat_albums a JOIN cat_tracks t ON t.album_id = a.id
  WHERE a.source = 'deezer' AND a.status = 'active' AND t.status = 'active'
  GROUP BY a.id ORDER BY avg DESC, a.fans DESC`).all();
const tracksOf = db.prepare("SELECT n, title, pop FROM cat_tracks WHERE album_id = ? AND status = 'active' ORDER BY n");
const promos = db.prepare(`SELECT id, artist_id, title, pop, year, genre FROM cat_tracks
  WHERE kind = 'promo' AND source = 'deezer' AND status = 'active' ORDER BY pop DESC`).all();
const artistIds = [...new Set([...albums.map((a) => a.artist_id), ...promos.map((p) => p.artist_id)])];
const artistRow = db.prepare('SELECT id, name, genre, country FROM cat_artists WHERE id = ?');
const artists = artistIds.map((id) => artistRow.get(id)).filter(Boolean);
const index = new Map(artists.map((a, i) => [a.id, i]));

const clean = (s) => String(s || '').replace(/\u001f/g, ' ');
const data = {
  v: 1,
  artists: artists.map((a) => [a.id, a.name, a.genre || 'pop', a.country || null]),
  albums: [],
  ...(sheet && { sprites: { size: sheet.size, cols: sheet.cols, count: sheet.sprites, prefix: 'covers/s' } }),
  promos: promos.filter((p) => index.has(p.artist_id)).map((p) => [p.id, index.get(p.artist_id), p.title, p.pop ?? 0, p.year || null, p.genre || 'pop']),
};
let trackCount = 0;
for (const a of albums) {
  if (!index.has(a.artist_id)) continue;
  const list = tracksOf.all(a.id);
  // Les numéros doivent se suivre (identifiants des cartes : <album>:01, :02…) : sinon l'album est laissé de côté.
  if (!list.length || list.some((t, i) => t.n !== i + 1)) continue;
  trackCount += list.length;
  data.albums.push([a.id, index.get(a.artist_id), a.title, a.year || null, a.genre || 'pop', list.map((t) => clean(t.title)).join('\u001f'),
    list.map((t) => t.pop ?? 0), sheet?.cells?.[a.id] ?? -1]);
}
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, JSON.stringify(data));
console.log(`${data.albums.length} albums, ${trackCount} morceaux, ${data.promos.length} promos, ${artists.length} artistes → ${out} (${Math.round(fs.statSync(out).size / 1024)} Ko)`);
