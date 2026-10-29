// Raretés des 20 albums de base (shared/catalog.js, ceux de la démo) d'après le même calcul que le catalogue importé
// (shared/prestige.js) : chaque morceau de la graine est classé parmi tous les morceaux d'une base où le prestige a été
// collecté (server/prestige.js), et reçoit la rareté et l'indice de ce classement. « Stronger » est ainsi comparé à
// tout le catalogue, pas seulement aux 19 autres albums de base.
//
//   DATABASE_FILE=data/albummania.db node scripts/seed-prestige.mjs [--write]
//
// Sans --write : affiche la nouvelle répartition par album. Avec --write : réécrit les indices dans shared/catalog.js.
import fs from 'node:fs';
import { config } from '../server/config.js';
import { openDb } from '../server/db.js';
import { ALBUMS } from '../shared/catalog.js';
import { albumScores, percentiles, trackScores } from '../shared/prestige.js';
import { tierOfPercentile } from '../server/importer.js';
import { POP_TIERS } from '../shared/rules.js';

const db = openDb(config.dbFile, { log: null });
const rows = new Map(db.prepare("SELECT id, artist_id, wd_links, lb_users, prestige_at FROM cat_albums WHERE source = 'seed'").all().map((r) => [r.id, r]));
const missing = ALBUMS.filter((a) => !rows.get(a.id)?.prestige_at);
if (missing.length) {
  console.error(`Prestige pas encore collecté pour : ${missing.map((a) => a.id).join(', ')} (scripts/import-catalog.mjs le collecte).`);
  process.exit(1);
}
const artists = new Map(db.prepare('SELECT id, wd_links AS links, lb_users AS listeners FROM cat_artists WHERE prestige_at IS NOT NULL').all()
  .map((a) => [a.id, a]));
// Albums : le catalogue importé et la graine. Les albums de base n'ont pas de fans Deezer en base : ceux du plus suivi
// des albums importés de leur artiste.
const imported = db.prepare(`SELECT id, artist_id AS artistId, wd_links AS links, lb_users AS listeners, fans, prestige_at IS NOT NULL AS known
  FROM cat_albums WHERE source = 'deezer'`).all();
const topFans = new Map();
for (const a of imported) topFans.set(a.artistId, Math.max(topFans.get(a.artistId) || 0, a.fans || 0));
const seedAlbums = ALBUMS.map((a) => ({
  id: a.id, artistId: a.artist, links: rows.get(a.id).wd_links, listeners: rows.get(a.id).lb_users, fans: topFans.get(a.artist) || 0, known: true,
}));
const scores = albumScores([...imported, ...seedAlbums], artists);
// Morceaux : ceux du catalogue importé, puis ceux de la graine (célébrité propre collectée en base ; rang Deezer
// remplacé par l'indice actuel, à la même échelle).
const songs = new Map(db.prepare("SELECT id, wd_links, lb_users FROM cat_tracks WHERE source = 'seed'").all().map((r) => [r.id, r]));
const importedTracks = db.prepare(`SELECT kind, album_id AS albumId, artist_id AS artistId, rank, wd_links AS songLinks, lb_users AS songUsers
  FROM cat_tracks WHERE source = 'deezer'`).all();
const pad = (n) => String(n).padStart(2, '0');
const tracks = ALBUMS.flatMap((a) => a.tracks.map(([title, pop], i) => {
  const id = `${a.id}:${pad(i + 1)}`;
  return { id, albumId: a.id, artistId: a.artist, kind: 'album', rank: pop * 10_000, songLinks: songs.get(id)?.wd_links ?? null, songUsers: songs.get(id)?.lb_users ?? null, title };
}));
const all = [...importedTracks, ...tracks];
const p = percentiles(trackScores(all, scores));
const next = new Map();
tracks.forEach((t, i) => next.set(`${t.albumId}:${t.id.split(':')[1] - 1}`, tierOfPercentile(p[importedTracks.length + i]).pop));

const rarityOfPop = (pop) => POP_TIERS.find((t) => pop >= t.min).rarity;
const short = { legendary: 'L', ultra: 'UR', super: 'SR', rare: 'R', uncommon: 'PC', common: 'C' };
for (const a of [...ALBUMS].sort((x, y) => scores.get(y.id) - scores.get(x.id))) {
  const r = rows.get(a.id);
  const count = {};
  for (let i = 0; i < a.tracks.length; i++) {
    const tier = rarityOfPop(next.get(`${a.id}:${i}`));
    count[tier] = (count[tier] || 0) + 1;
  }
  const mix = Object.keys(short).filter((k) => count[k]).map((k) => `${count[k]} ${short[k]}`).join(' ');
  console.log(`${a.title.padEnd(42)} wiki ${String(r.wd_links).padStart(3)} · LB ${String(r.lb_users).padStart(6)} · ${mix}`);
}

// --album <id> : détail d'un album de base (titre, rareté), par exemple --album graduation.
const detail = process.argv.indexOf('--album');
if (detail > 0) {
  const a = ALBUMS.find((x) => x.id === process.argv[detail + 1]);
  a?.tracks.forEach(([title], i) => console.log(`  ${title.padEnd(32)} ${rarityOfPop(next.get(`${a.id}:${i}`))} (${next.get(`${a.id}:${i}`)})`));
}

if (process.argv.includes('--write')) {
  const file = new URL('../shared/catalog.js', import.meta.url);
  let src = fs.readFileSync(file, 'utf8');
  for (const a of ALBUMS) {
    const start = src.indexOf(`id: '${a.id}', artist: '${a.artist}'`);
    const open = src.indexOf('tracks: [', start);
    const close = src.indexOf('\n    ],', open);
    if (start < 0 || open < 0 || close < 0) throw new Error(`Album introuvable dans shared/catalog.js : ${a.id}`);
    let i = 0;
    const block = src.slice(open, close).replace(/^(\s*\[(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"),\s*)(\d+)/gm, (m, head) => `${head}${next.get(`${a.id}:${i++}`)}`);
    if (i !== a.tracks.length) throw new Error(`${a.id} : ${i} morceaux lus, ${a.tracks.length} attendus`);
    src = src.slice(0, open) + block + src.slice(close);
  }
  fs.writeFileSync(file, src);
  console.log('shared/catalog.js réécrit.');
}
