// Vraies pochettes du grand catalogue pour la démo publiée (claude.ai). La page ne peut charger aucune image d'un autre
// site, et un artefact ne peut pas porter 26 000 fichiers : les pochettes sont copiées en petit (128 px) puis réunies en
// planches de 16 × 16 (256 pochettes par image JPEG), que la démo découpe à l'affichage (CoverArt, art.sprite).
// Le site en ligne, lui, n'en copie aucune : il affiche celles de Deezer.
//
//   DATABASE_FILE=data/albummania.db node scripts/demo-sprites.mjs [dossier]      défaut : data/demo-sprites
//
// Copies gardées dans <dossier>/cache (une relance ne retélécharge rien) ; planches s0.jpg… et index.json (album →
// case) dans <dossier>. scripts/demo-catalog.mjs lit index.json pour attacher sa case à chaque album. Rien de tout
// cela n'entre dans le dépôt (data/ n'est pas versionné) : les pochettes appartiennent à leurs ayants droit.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { config } from '../server/config.js';
import { openDb } from '../server/db.js';

const SIZE = 128;
const COLS = 16;
const PER = COLS * COLS;
const PARALLEL = 16;
const out = path.resolve(process.argv[2] || 'data/demo-sprites');
const cache = path.join(out, 'cache');
fs.mkdirSync(cache, { recursive: true });

const db = openDb(config.dbFile, { log: null });
// Les albums les plus suivis d'abord : une page de la collection touche peu de planches.
const albums = db.prepare(`SELECT id, cover FROM cat_albums WHERE source = 'deezer' AND status = 'active' AND cover LIKE 'https://%'
  ORDER BY fans DESC, id`).all();
const resized = (url) => url.replace(/\/\d+x\d+-([^/]+)$/, `/${SIZE}x${SIZE}-$1`);
const file = (id) => path.join(cache, `${id}.jpg`);

let done = 0;
let failed = 0;
const queue = albums.filter((a) => !fs.existsSync(file(a.id)));
async function worker() {
  for (let a = queue.shift(); a; a = queue.shift()) {
    try {
      const res = await fetch(resized(a.cover), { signal: AbortSignal.timeout(20_000) });
      if (!res.ok || !/^image\/jpe?g/.test(res.headers.get('content-type') || '')) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(file(a.id), Buffer.from(await res.arrayBuffer()));
    } catch {
      failed += 1;
    }
    done += 1;
    if (done % 2000 === 0) console.log(`${done} pochettes téléchargées`);
  }
}
await Promise.all(Array.from({ length: PARALLEL }, worker));

// Planches : seules les pochettes téléchargées y entrent, dans l'ordre ci-dessus.
const ready = albums.filter((a) => fs.existsSync(file(a.id)) && fs.statSync(file(a.id)).size > 500);
const cells = {};
const sprites = Math.ceil(ready.length / PER);
for (let s = 0; s < sprites; s++) {
  const part = ready.slice(s * PER, (s + 1) * PER);
  part.forEach((a, i) => {
    cells[a.id] = s * PER + i;
  });
  const list = path.join(out, `s${s}.txt`);
  fs.writeFileSync(list, part.map((a) => file(a.id)).join('\n'));
  execFileSync('montage', [`@${list}`, '-tile', `${COLS}x${COLS}`, '-geometry', `${SIZE}x${SIZE}+0+0`, '-background', '#1b1623',
    '-quality', '74', '-strip', '-interlace', 'none', path.join(out, `s${s}.jpg`)]);
  fs.rmSync(list);
}
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({ size: SIZE, cols: COLS, sprites, cells }));
const bytes = Array.from({ length: sprites }, (_, s) => fs.statSync(path.join(out, `s${s}.jpg`)).size).reduce((a, b) => a + b, 0);
console.log(`${ready.length}/${albums.length} pochettes (${failed} échecs) en ${sprites} planches, ${Math.round(bytes / 1e6)} Mo → ${out}`);
