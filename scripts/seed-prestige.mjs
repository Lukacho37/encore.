// Raretés des 20 albums de base (shared/catalog.js, ceux de la démo) d'après le prestige mondial, comme le catalogue
// importé (shared/prestige.js) : lit les signaux collectés dans une base (server/prestige.js), puis redistribue les
// indices de popularité existants des morceaux d'albums. Le jeu d'indices reste le même (autant de Légendaires,
// d'Ultra rares… qu'avant, l'équilibre des boosters de la démo ne bouge pas) ; seule leur répartition change : les
// albums les plus prestigieux reçoivent les plus hauts, et dans chaque album l'ordre des morceaux est conservé.
//
//   DATABASE_FILE=data/albummania.db node scripts/seed-prestige.mjs [--write]
//
// Sans --write : affiche la nouvelle répartition par album. Avec --write : réécrit les indices dans shared/catalog.js.
import fs from 'node:fs';
import { config } from '../server/config.js';
import { openDb } from '../server/db.js';
import { ALBUMS } from '../shared/catalog.js';
import { albumScores, trackScores } from '../shared/prestige.js';
import { POP_TIERS } from '../shared/rules.js';

const db = openDb(config.dbFile, { log: null });
const rows = new Map(db.prepare("SELECT id, artist_id, wd_links, lb_users, prestige_at FROM cat_albums WHERE source = 'seed'").all().map((r) => [r.id, r]));
const missing = ALBUMS.filter((a) => !rows.get(a.id)?.prestige_at);
if (missing.length) {
  console.error(`Prestige pas encore collecté pour : ${missing.map((a) => a.id).join(', ')} (scripts/import-catalog.mjs le collecte).`);
  process.exit(1);
}
const artists = new Map(db.prepare("SELECT id, wd_links AS links, lb_users AS listeners FROM cat_artists WHERE source = 'seed'").all().map((a) => [a.id, a]));
// Les albums de base n'ont pas de fans Deezer en base : même valeur pour tous, seuls le culte et les auditeurs comptent.
const scores = albumScores(ALBUMS.map((a) => ({
  id: a.id, artistId: a.artist, links: rows.get(a.id).wd_links, listeners: rows.get(a.id).lb_users, fans: 1, known: true,
})), artists);
const tracks = ALBUMS.flatMap((a) => a.tracks.map(([title, pop], i) => ({ id: `${a.id}:${i}`, albumId: a.id, artistId: a.artist, rank: pop, n: i, title })));
const score = trackScores(tracks, scores);
const pops = tracks.map((t) => t.rank).sort((x, y) => y - x);
const next = new Map();
tracks.map((t, i) => ({ t, s: score[i] })).sort((x, y) => y.s - x.s || y.t.rank - x.t.rank).forEach(({ t }, k) => next.set(t.id, pops[k]));

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
