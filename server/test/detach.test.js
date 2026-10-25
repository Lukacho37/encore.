// Détachement d'un fournisseur (PLAN.md 3.7, 7.1, 8.3 P2.6, chantier P2-C) : simulation sans effet ; détachement par
// l'espace admin (confirmation tapée) puis par scripts/detach-provider.js ; ce qui est confirmé par MusicBrainz reste,
// le reste est archivé (status = 'withdrawn') ; les joueurs gardent cartes, vinyles, notes et listes ; plus aucun appel
// au fournisseur, ni pochette ni lien ; faits propres effacés sur demande ; rejouable ; purge-catalog.js ne détruit
// plus rien par défaut.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'patronne@example.com';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { startApp, signupVerified, api } = await import('./helpers.js');
const { openDb } = await import('../db.js');
const { createCatalog } = await import('../catalog.js');
const { createImporter, providerDetached } = await import('../importer.js');
const { detachProvider } = await import('../enrich.js');
const { makeFakeDeezer } = await import('./fakeDeezer.js');

const NOW = Date.now();
const IMPORT_CFG = {
  catalogImport: 'deezer', catalogTarget: 30, catalogMinArtistFans: 15000, catalogMinAlbumFans: 100, catalogMaxAlbumsPerArtist: 10,
  deezerApiUrl: 'https://deezer.test', covers: 'auto',
};
const quiet = { warn() {}, log() {} };
const mbid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Marque des éléments comme confirmés par MusicBrainz (ce que ferait l'enrichissement). */
function confirm(db, type, id, n) {
  db.prepare(`INSERT INTO external_ids (entity_type, entity_id, source, source_id, url, matched_by, fetched_at)
    VALUES (?, ?, 'musicbrainz', ?, NULL, 'upc', ?)`).run(type, id, mbid(n), NOW);
}

const app = await startApp({ catalog: { artists: 8, target: 30 } });
test.after(() => app.close());
const { db, deps, services } = app;
const owner = await signupVerified(app, { username: 'patronne', email: 'patronne@example.com' });
const player = await signupVerified(app, { username: 'collectionneuse' });
const call = (who, method, p, body) => api(app.base, who?.cookie || '', method, p, body);
const one = (sql, ...a) => db.prepare(sql).get(...a);
const tracksOf = (albumId) => db.prepare('SELECT id FROM cat_tracks WHERE album_id = ? ORDER BY n').all(albumId).map((r) => r.id);

// Catalogue du test : 30 albums importés de Deezer ; les 3 premiers sont confirmés par MusicBrainz, ainsi qu'une promo.
const deezerAlbums = db.prepare("SELECT id, artist_id, title FROM cat_albums WHERE source = 'deezer' ORDER BY rowid").all();
const kept = deezerAlbums.slice(0, 3);
const gone = deezerAlbums.slice(3);
kept.forEach((a, i) => confirm(db, 'album', a.id, i + 1));
const promos = db.prepare("SELECT id, artist_id FROM cat_tracks WHERE kind = 'promo' AND source = 'deezer' ORDER BY rowid").all();
assert.ok(promos.length >= 2, 'le faux Deezer donne des promos');
confirm(db, 'track', promos[0].id, 50);
// Une pochette de la graine venue de Deezer (covers.js), pour vérifier qu'elle est bloquée.
db.prepare(`INSERT OR REPLACE INTO covers (item_key, provider, cover, thumb, url, tracks, fetched_at)
  VALUES ('discovery', 'deezer', 'https://e-cdns-images.dzcdn.net/images/cover/1/1000x1000.jpg', NULL, 'https://www.deezer.com/album/302127', '{}', ?)`).run(NOW);

// La joueuse : un album archivé complété (vinyle), des cartes d'un album gardé, une note avec critique et une liste.
const withdrawnAlbum = gone[0];
const keptAlbum = kept[0];
services.atomic(() => services.addCards(services.getUser(player.user.id), tracksOf(withdrawnAlbum.id).map((trackId) => ({ trackId, variant: 'std' })), 'press'));
services.atomic(() => services.addCards(services.getUser(player.user.id), tracksOf(keptAlbum.id).slice(0, 2).map((trackId) => ({ trackId, variant: 'std' })), 'press'));
assert.equal((await call(player, 'PUT', `/ratings/album/${withdrawnAlbum.id}`, { score: 9, review: 'Un disque que je garde précieusement, même archivé.' })).status, 200);
const list = await call(player, 'POST', '/lists', { title: 'Mes trouvailles', items: [{ type: 'album', id: withdrawnAlbum.id }, { type: 'album', id: keptAlbum.id }] });
assert.equal(list.status, 201);
const snapshot = () => ({
  cards: one('SELECT COUNT(*) AS n, SUM(count) AS c FROM cards WHERE user_id = ?', player.user.id),
  vinyls: one("SELECT COUNT(*) AS n FROM achievements WHERE user_id = ? AND key LIKE 'album:%'", player.user.id).n,
  ratings: one('SELECT COUNT(*) AS n FROM ratings WHERE user_id = ?', player.user.id).n,
  items: one('SELECT COUNT(*) AS n FROM list_items WHERE list_id = ?', list.body.list.id).n,
  unique: one('SELECT unique_cards AS n FROM users WHERE id = ?', player.user.id).n,
});
const before = snapshot();
assert.equal(before.vinyls, 1, 'album complété : son vinyle');

test('simulation : compte rendu exact, rien ne change ; réservé à l’admin, confirmation tapée exigée', async () => {
  assert.equal((await call(player, 'POST', '/admin/providers/deezer/detach', { dryRun: true })).status, 403);
  assert.equal((await call(owner, 'POST', '/admin/providers/spotify/detach', { dryRun: true })).body.error, 'unknown_provider');
  assert.equal((await call(owner, 'POST', '/admin/providers/deezer/detach', { dryRun: false })).body.error, 'confirm_required');
  assert.equal((await call(owner, 'POST', '/admin/providers/deezer/detach', { dryRun: false, confirm: 'Deezer ' })).body.error, 'confirm_required');
  const r = await call(owner, 'POST', '/admin/providers/deezer/detach', {});
  assert.equal(r.status, 200);
  const rep = r.body.report;
  assert.equal(rep.dryRun, true, 'simulation par défaut');
  assert.deepEqual(rep.albums, { total: 30, withdrawn: 27, kept: 3 });
  const goneTracks = one(`SELECT COUNT(*) AS n FROM cat_tracks WHERE album_id IN (SELECT value FROM json_each(?))`, JSON.stringify(gone.map((a) => a.id))).n;
  assert.equal(rep.tracks.withdrawn, goneTracks);
  assert.equal(rep.promos.withdrawn, promos.length - 1);
  assert.ok(rep.artists.withdrawn >= 1 && rep.artists.kept >= 1);
  assert.deepEqual(rep.players, { withCards: 1, cards: tracksOf(withdrawnAlbum.id).length, ratings: 1, listItems: 1 });
  assert.ok(rep.covers >= 31, 'pochettes des albums, des promos et de la graine');
  // Rien n'a bougé.
  assert.equal(one("SELECT COUNT(*) AS n FROM cat_albums WHERE status = 'withdrawn'").n, 0);
  assert.equal(providerDetached(db, 'deezer'), null);
  assert.ok(one('SELECT cover FROM cat_albums WHERE id = ?', withdrawnAlbum.id).cover);
  assert.ok(!db.prepare("SELECT 1 FROM sqlite_temp_master WHERE name = 'detach_items'").get(), 'table temporaire retirée');
});

test('détachement : confirmés gardés, le reste archivé, les joueurs gardent tout, plus de Deezer nulle part', async () => {
  const found = deps.search.search(owner.user.id, withdrawnAlbum.title, 'album', { offset: 0, limit: 10 });
  assert.ok(found.items.some((x) => x.id === withdrawnAlbum.id), 'trouvable avant');
  const r = await call(owner, 'POST', '/admin/providers/deezer/detach', { dryRun: false, confirm: 'deezer' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.report.dryRun, false);
  assert.equal(r.body.status.providers.deezer.detached, true);
  assert.ok(one("SELECT 1 FROM admin_audit WHERE action = 'provider.detach' AND target = 'provider:deezer'"));

  // Statuts : confirmés et graine actifs ; le reste archivé, morceaux compris ; un artiste qui garde un album reste.
  for (const a of kept) assert.equal(one('SELECT status FROM cat_albums WHERE id = ?', a.id).status, 'active', a.id);
  for (const a of gone) assert.equal(one('SELECT status FROM cat_albums WHERE id = ?', a.id).status, 'withdrawn', a.id);
  assert.equal(one(`SELECT COUNT(*) AS n FROM cat_tracks t JOIN cat_albums al ON al.id = t.album_id WHERE al.status <> t.status`).n, 0);
  assert.equal(one('SELECT status FROM cat_tracks WHERE id = ?', promos[0].id).status, 'active', 'promo confirmée');
  assert.equal(one('SELECT status FROM cat_tracks WHERE id = ?', promos[1].id).status, 'withdrawn');
  assert.equal(one("SELECT COUNT(*) AS n FROM cat_albums WHERE source = 'seed' AND status <> 'active'").n, 0);
  for (const a of kept) assert.equal(one('SELECT status FROM cat_artists WHERE id = ?', a.artist_id).status, 'active');
  assert.equal(one(`SELECT COUNT(*) AS n FROM cat_artists ar WHERE ar.status = 'withdrawn'
    AND EXISTS (SELECT 1 FROM cat_albums al WHERE al.artist_id = ar.id AND al.status = 'active')`).n, 0, 'aucun artiste archivé avec un album actif');

  // Les joueurs ne perdent rien : cartes, vinyle, note et critique, liste ; la page de l'album archivé s'ouvre.
  assert.deepEqual(snapshot(), before);
  assert.equal(one('SELECT review FROM ratings WHERE user_id = ? AND item_id = ?', player.user.id, withdrawnAlbum.id).review, 'Un disque que je garde précieusement, même archivé.');
  const state = await call(player, 'GET', '/state');
  assert.ok(state.body.cards.some((c) => c.t === tracksOf(withdrawnAlbum.id)[0]), 'cartes archivées dans l’état');
  assert.equal((await call(player, 'GET', `/catalog/albums/${withdrawnAlbum.id}`)).status, 200);
  const listPage = await call(player, 'GET', `/lists/${list.body.list.id}`);
  assert.equal(listPage.status, 200);
  assert.equal(listPage.body.items.length, 2);

  // Plus de pochettes ni de liens Deezer ; le panneau d'écoute ne propose plus Deezer et signale l'archive.
  assert.equal(one("SELECT COUNT(*) AS n FROM cat_albums WHERE cover IS NOT NULL OR url LIKE 'https://www.deezer.com/%'").n, 0);
  assert.equal(one("SELECT COUNT(*) AS n FROM cat_tracks WHERE cover IS NOT NULL OR url LIKE 'https://www.deezer.com/%'").n, 0);
  assert.equal(one("SELECT COUNT(*) AS n FROM covers WHERE provider = 'deezer'").n, 0);
  const listen = (await call(player, 'GET', `/catalog/listen/album/${withdrawnAlbum.id}`)).body;
  assert.equal(listen.archived, true);
  assert.ok(!listen.links.some((l) => l.provider === 'deezer'));
  assert.deepEqual(listen.embeds, []);
  assert.deepEqual(listen.detached, ['deezer']);
  const keptListen = (await call(player, 'GET', `/catalog/listen/album/${keptAlbum.id}`)).body;
  assert.equal(keptListen.archived, false);
  assert.ok(!keptListen.links.some((l) => l.provider === 'deezer'));
  assert.equal((await call(player, 'GET', `/catalog/listen/track/${encodeURIComponent(tracksOf(withdrawnAlbum.id)[0])}`)).body.archived, true);

  // Recherche : index reconstruit au démarrage suivant (version effacée) ; reconstruit, il n'a plus l'album archivé.
  assert.equal(one("SELECT COUNT(*) AS n FROM kv WHERE key = 'search:version'").n, 0);
  deps.search.rebuild();
  assert.ok(!deps.search.search(owner.user.id, withdrawnAlbum.title, 'album', { offset: 0, limit: 10 }).items.some((x) => x.id === withdrawnAlbum.id));
  assert.ok(deps.search.search(owner.user.id, keptAlbum.title, 'album', { offset: 0, limit: 10 }).items.some((x) => x.id === keptAlbum.id));

  // Plus aucun appel à Deezer : l'import refuse de démarrer, même forcé.
  const fake = makeFakeDeezer({ artists: 3 });
  const importer = createImporter(db, deps.catalog, { cfg: IMPORT_CFG, fetchImpl: fake.fetchImpl, pauseMs: 0, log: quiet });
  assert.equal(importer.start({ force: true }), null);
  assert.equal(fake.calls.length, 0);
  assert.ok(importer.status().detached.at);
  // Faits gardés sans --purge-facts (rang, fans, identifiants).
  assert.ok(one("SELECT COUNT(*) AS n FROM external_ids WHERE source = 'deezer'").n > 0);
  // Une seconde fois : refusé.
  assert.equal((await call(owner, 'POST', '/admin/providers/deezer/detach', { dryRun: false, confirm: 'deezer' })).body.error, 'already_detached');
});

test('rejouable : relancé après une interruption, le détachement termine ce qui reste et ne touche pas au reste', () => {
  // Interruption simulée : deux albums (et leurs morceaux) encore actifs.
  const [a, b] = gone;
  db.prepare("UPDATE cat_albums SET status = 'active' WHERE id IN (?, ?)").run(a.id, b.id);
  db.prepare("UPDATE cat_tracks SET status = 'active' WHERE album_id IN (?, ?)").run(a.id, b.id);
  const rep = detachProvider(db, 'deezer', { dryRun: false, by: 'test' });
  assert.equal(rep.albums.withdrawn, 2);
  assert.equal(one("SELECT COUNT(*) AS n FROM cat_albums WHERE status = 'active' AND id IN (?, ?)", a.id, b.id).n, 0);
  assert.equal(detachProvider(db, 'deezer', { dryRun: true }).albums.withdrawn, 0, 'plus rien à faire');
  assert.deepEqual(snapshot(), before);
});

test('scripts : detach-provider.js (simulation, --yes, --purge-facts) et purge-catalog.js qui ne détruit plus rien', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-detach-'));
  const file = path.join(dir, 'am.db');
  try {
    // Une base sur disque avec un catalogue importé, une joueuse et sa carte.
    const base = openDb(file);
    const importer = createImporter(base, createCatalog(base), { cfg: { ...IMPORT_CFG, catalogTarget: 12 }, fetchImpl: makeFakeDeezer({ artists: 4 }).fetchImpl, pauseMs: 0, log: quiet });
    await importer.start();
    const t = base.prepare("SELECT id FROM cat_tracks WHERE source = 'deezer' LIMIT 1").get().id;
    base.prepare("INSERT INTO users (email, username, password_hash, packs_at, created_at) VALUES ('a@example.com', 'a', 'x', 0, 0)").run();
    base.prepare("INSERT INTO cards (user_id, track_id, variant, count, first_at) VALUES (1, ?, 'std', 2, 0)").run(t);
    base.prepare(`INSERT INTO kv (key, value) VALUES ('search:version', '"2"') ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
    base.close();
    const env = { ...process.env, DATABASE_FILE: file, NODE_ENV: 'test' };
    const run = (script, args) => execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'scripts', script), ...args], { env, encoding: 'utf8' });

    const dry = run('detach-provider.js', ['deezer']);
    assert.match(dry, /Simulation \(rien ne change\)/);
    assert.match(dry, /Relance avec --yes/);
    const check = openDb(file);
    assert.equal(check.prepare("SELECT COUNT(*) AS n FROM cat_albums WHERE status = 'withdrawn'").get().n, 0);
    check.close();
    // L'ancienne commande ne détruit plus rien : sans option, elle simule le détachement.
    assert.match(run('purge-catalog.js', []), /remplacée par le détachement/);

    const out = JSON.parse(run('detach-provider.js', ['deezer', '--yes', '--purge-facts', '--json']).trim().split('\n').pop());
    assert.equal(out.dryRun, false);
    assert.equal(out.purgeFacts, true);
    assert.deepEqual(out.albums, { total: 12, withdrawn: 12, kept: 0 });
    const after = openDb(file);
    const n = (sql) => after.prepare(sql).get().n;
    assert.equal(n("SELECT COUNT(*) AS n FROM cat_albums WHERE source = 'deezer' AND status = 'withdrawn'"), 12);
    assert.equal(n("SELECT COUNT(*) AS n FROM external_ids WHERE source = 'deezer'"), 0, 'identifiants Deezer effacés');
    assert.equal(n("SELECT COUNT(*) AS n FROM cat_albums WHERE deezer_id IS NOT NULL OR (fans <> 0 AND source = 'deezer')"), 0);
    assert.equal(n('SELECT COUNT(*) AS n FROM cat_tracks WHERE deezer_id IS NOT NULL OR rank IS NOT NULL'), 0);
    assert.equal(n('SELECT COUNT(*) AS n FROM cat_artists WHERE deezer_id IS NOT NULL'), 0);
    assert.equal(n('SELECT COUNT(*) AS n FROM import_artists'), 0);
    assert.equal(n("SELECT COUNT(*) AS n FROM kv WHERE key = 'search:version'"), 0, 'index de recherche reconstruit au démarrage');
    assert.equal(n('SELECT COUNT(*) AS n FROM cards WHERE user_id = 1'), 1, 'la carte de la joueuse reste');
    assert.ok(providerDetached(after, 'deezer'));
    after.close();
    assert.match(run('purge-catalog.js', ['--yes']), /déjà détaché/);
    // Sans fournisseur : l'usage, et un code de sortie d'erreur.
    assert.throws(() => run('detach-provider.js', []), (err) => err.status === 2 && /Usage/.test(err.stdout));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
