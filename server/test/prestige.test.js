// Raretés par prestige mondial (demande du propriétaire du 2026-10-29) : calcul (shared/prestige.js), collecte
// (server/prestige.js, Wikidata et ListenBrainz simulés) et calibrage de l'import (server/importer.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { openDb } = await import('../db.js');
const { createCatalog } = await import('../catalog.js');
const { createImporter, RANK_TIERS } = await import('../importer.js');
const { createPrestige, matchKey } = await import('../prestige.js');
const { makeFakeDeezer } = await import('./fakeDeezer.js');
const { albumScores, percentiles, trackScores } = await import('../../shared/prestige.js');

const CFG = {
  catalogImport: 'deezer',
  catalogTarget: 60,
  catalogMinArtistFans: 15000,
  catalogMinAlbumFans: 100,
  catalogMaxAlbumsPerArtist: 10,
  deezerApiUrl: 'https://deezer.test',
  covers: 'auto',
};
const quiet = { warn() {}, log() {} };
const json = (data) => ({ ok: true, status: 200, json: async () => data, headers: { get: () => null } });
const ORDER = RANK_TIERS.map((t) => t.rarity);
const rareCount = (db, albumId) => db.prepare("SELECT COUNT(*) AS n FROM cat_tracks WHERE album_id = ? AND rarity IN ('rare', 'super', 'ultra', 'legendary')").get(albumId).n;

async function importedCatalog() {
  const db = openDb(':memory:');
  const catalog = createCatalog(db, { covers: () => true });
  const importer = createImporter(db, catalog, { cfg: CFG, fetchImpl: makeFakeDeezer({ artists: 40 }).fetchImpl, pauseMs: 0, log: quiet });
  await importer.start();
  return { db, catalog, importer };
}

test('calcul : percentiles ex aequo ; un album culte mondial passe devant un album à forte audience locale', () => {
  assert.deepEqual(percentiles([5, 1, 5, 3]), [2 / 3, 0, 2 / 3, 1 / 3]);
  assert.deepEqual(percentiles([7]), [1]);
  const albums = [
    // « Graduation » : article dans 30 langues, 35 000 auditeurs dans le monde, assez peu de fans sur Deezer.
    { id: 'culte', artistId: 'a', links: 30, listeners: 35000, fans: 80000, known: true },
    // Gros succès d'un seul pays : beaucoup de fans Deezer, un seul article, peu d'auditeurs ailleurs.
    { id: 'local', artistId: 'b', links: 1, listeners: 300, fans: 600000, known: true },
    ...Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, artistId: `c${i}`, links: i % 12, listeners: i * 900, fans: 20000 + i * 9000, known: true })),
  ];
  const scores = albumScores(albums);
  assert.ok(scores.get('culte') > 0.9, `culte : ${scores.get('culte')}`);
  assert.ok(scores.get('local') < 0.5, `local : ${scores.get('local')}`);
  // Les tubes de l'album culte et même ses morceaux discrets passent devant les tubes de l'album local.
  const tracks = [
    ...[100, 200, 900].map((rank, i) => ({ id: `culte:${i}`, albumId: 'culte', artistId: 'a', kind: 'album', rank })),
    ...[500000, 800000, 990000].map((rank, i) => ({ id: `local:${i}`, albumId: 'local', artistId: 'b', kind: 'album', rank })),
  ];
  const t = trackScores(tracks, scores);
  assert.ok(Math.min(...t.slice(0, 3)) > Math.max(...t.slice(3)), JSON.stringify(t));
  // Dans un album, le morceau le plus écouté a le meilleur score.
  assert.ok(t[2] > t[1] && t[1] > t[0]);
});

test('calcul : la célébrité propre d’un morceau compte (« Stronger » devant les morceaux discrets d’un album culte)', () => {
  const albums = [
    { id: 'graduation', artistId: 'kanye', links: 30, listeners: 42000, fans: 300000, known: true },
    ...Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, artistId: `c${i}`, links: i % 10, listeners: 300 * i, fans: 10000 * (i + 1), known: true })),
  ];
  const scores = albumScores(albums);
  const song = (id, albumId, rank, songLinks, songUsers) => ({ id, albumId, artistId: albumId === 'graduation' ? 'kanye' : 'c', kind: 'album', rank, songLinks, songUsers });
  const tracks = [
    song('stronger', 'graduation', 900000, 16, 83000),
    song('flashing', 'graduation', 800000, 14, 53000),
    song('drunk', 'graduation', 300000, 0, 3000),
    // Un tube mondial d'un album moins prestigieux, puis des morceaux sans renommée.
    song('tube', 'x20', 950000, 20, 120000),
    ...Array.from({ length: 200 }, (_, i) => song(`f${i}`, `x${i % 30}`, 1000 * i, 0, i * 5)),
  ];
  const t = trackScores(tracks, scores);
  const by = Object.fromEntries(tracks.map((x, i) => [x.id, t[i]]));
  assert.ok(by.stronger > by.drunk && by.flashing > by.drunk, 'les tubes passent devant les morceaux discrets du même album');
  assert.ok(by.tube > by.drunk, 'un tube mondial d’un album moins prestigieux passe devant un morceau discret d’un album culte');
  const p = percentiles(t);
  assert.ok(p[0] >= 0.98 && p[1] >= 0.98, `Stronger et Flashing Lights tout en haut : ${p[0]}, ${p[1]}`);
  // Pas encore évalués : l'ancien calcul (album et place dans l'album).
  const unknown = trackScores([{ ...tracks[0], songLinks: null, songUsers: null }], scores);
  assert.ok(Math.abs(unknown[0] - (0.7 * scores.get('graduation') + 0.3)) < 1e-9);
});

test('calcul : album introuvable sur Wikidata, part de l’artiste selon ses fans (une compilation obscure d’une star reste modeste)', () => {
  const artists = new Map([['star', { links: 90, listeners: 400000 }]]);
  const albums = [
    { id: 'tube', artistId: 'star', links: 0, listeners: 0, fans: 500000, known: true },
    { id: 'obscur', artistId: 'star', links: 0, listeners: 0, fans: 700, known: true },
    { id: 'pas-encore', artistId: 'star', links: 0, listeners: 0, fans: 500000, known: false },
    ...Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, artistId: `c${i}`, links: 2 + i, listeners: 500 + i * 1000, fans: 30000, known: true })),
  ];
  const scores = albumScores(albums, artists);
  assert.ok(scores.get('tube') > 0.8, `tube : ${scores.get('tube')}`);
  assert.ok(scores.get('obscur') < 0.3, `obscur : ${scores.get('obscur')}`);
  // Pas encore évalué : ses fans Deezer seulement, en attendant la collecte.
  assert.ok(scores.get('pas-encore') > 0.9);
  assert.equal(matchKey('The Marshall Mathers LP2 (Deluxe)'), matchKey('The Marshall Mathers LP 2'));
  assert.equal(matchKey('Bad 25th Anniversary'), matchKey('Bad'));
});

test('calibrage : l’album culte devient bien plus rare que l’album le plus écouté sur Deezer ; tout est regelé', async () => {
  const { db, importer } = await importedCatalog();
  const albums = db.prepare("SELECT id FROM cat_albums WHERE source = 'deezer' ORDER BY fans DESC").all().map((r) => r.id);
  const [local, culte] = [albums[0], albums.at(-1)];
  const set = db.prepare('UPDATE cat_albums SET wd_links = ?, lb_users = ?, prestige_at = 1 WHERE id = ?');
  albums.forEach((id, i) => set.run(1 + (i % 8), 200 + i * 50, id));
  set.run(1, 50, local);
  set.run(45, 90000, culte);
  db.exec('UPDATE cat_artists SET wd_links = 5, lb_users = 1000, prestige_at = 1');
  assert.ok(importer.frozen());
  importer.recalibrate();
  assert.ok(importer.frozen(), 'regelé après le recalcul');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM cat_tracks WHERE source = 'deezer' AND (rarity_locked = 0 OR pop_source <> 'prestige')").get().n, 0);
  const total = (id) => db.prepare('SELECT COUNT(*) AS n FROM cat_tracks WHERE album_id = ?').get(id).n;
  assert.equal(rareCount(db, local), 0, 'album à forte audience Deezer mais sans rayonnement : rien de rare');
  assert.ok(rareCount(db, culte) >= total(culte) * 0.75, `album culte : ${rareCount(db, culte)} cartes rares ou mieux sur ${total(culte)}`);
  const top = db.prepare("SELECT rarity FROM cat_tracks WHERE album_id = ? ORDER BY rank DESC LIMIT 1").get(culte).rarity;
  assert.ok(ORDER.indexOf(top) <= ORDER.indexOf('ultra'), `le tube de l'album culte : ${top}`);
  // Mêmes parts qu'avant pour l'ensemble du catalogue (à un morceau près par palier).
  const n = db.prepare("SELECT COUNT(*) AS n FROM cat_tracks WHERE source = 'deezer'").get().n;
  const legendary = db.prepare("SELECT COUNT(*) AS n FROM cat_tracks WHERE source = 'deezer' AND rarity = 'legendary'").get().n;
  assert.ok(legendary <= Math.ceil(n * 0.005) + 2, `${legendary} légendaires sur ${n}`);
  db.close();
});

test('collecte : Wikidata (identifiant Deezer, puis nom), albums rapprochés par titre, ListenBrainz ; rien à refaire ensuite', async () => {
  const { db } = await importedCatalog();
  const artists = db.prepare("SELECT id, name, deezer_id FROM cat_artists WHERE source = 'deezer' ORDER BY id").all();
  const [byId, byName] = artists;
  const album = db.prepare('SELECT id, title FROM cat_albums WHERE artist_id = ? LIMIT 1').get(byId.id);
  const queries = [];
  const fetchImpl = async (url, init) => {
    const host = new URL(url).host;
    if (host === 'sparql.test') {
      const query = decodeURIComponent(String(init.body).replace(/^query=/, ''));
      queries.push(query);
      if (query.includes('wdt:P175')) {
        return json({ results: { bindings: [{
          artist: { value: 'http://www.wikidata.org/entity/Q1' }, item: { value: 'http://www.wikidata.org/entity/Q10' },
          links: { value: '27' }, rg: { value: '11111111-2222-3333-4444-555555555555' }, labels: { value: `${album.title} (Deluxe Edition)|||Autre` },
        }] } });
      }
      if (query.includes('wdt:P2722 ?dz')) {
        return json({ results: { bindings: [{ dz: { value: String(byId.deezer_id) }, item: { value: 'http://www.wikidata.org/entity/Q1' },
          links: { value: '60' }, mb: { value: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } }] } });
      }
      if (query.includes('rdfs:label ?name')) {
        return json({ results: { bindings: [{ name: { value: byName.name }, item: { value: 'http://www.wikidata.org/entity/Q2' }, links: { value: '12' },
          mb: { value: 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee' } }] } });
      }
      return json({ results: { bindings: [] } });
    }
    if (host === 'lb.test') {
      const body = JSON.parse(init.body);
      if (body.release_group_mbids) return json(body.release_group_mbids.map((id) => ({ release_group_mbid: id, total_user_count: 4321 })));
      return json(body.artist_mbids.map((id) => ({ artist_mbid: id, total_user_count: 99999 })));
    }
    throw new Error(`URL inattendue ${url}`);
  };
  const settings = { mode: 'on', userAgent: 'test', sparqlUrl: 'https://sparql.test/sparql', lbUrl: 'https://lb.test/1', pauseMs: 0 };
  const prestige = createPrestige(db, { settings, fetchImpl, log: quiet });
  const res = await prestige.collect();
  assert.ok(res.changed);
  assert.equal(res.artistsFound, 2);
  const a1 = db.prepare('SELECT wd_links, lb_users, prestige_at FROM cat_artists WHERE id = ?').get(byId.id);
  assert.deepEqual({ ...a1, prestige_at: !!a1.prestige_at }, { wd_links: 60, lb_users: 99999, prestige_at: true });
  assert.equal(db.prepare('SELECT wd_links FROM cat_artists WHERE id = ?').get(byName.id).wd_links, 12, 'trouvé par son nom');
  assert.equal(db.prepare('SELECT wd_links FROM cat_artists WHERE id = ?').get(artists[2].id).wd_links, 0, 'introuvable : 0, mais évalué');
  const al = db.prepare('SELECT wd_links, lb_users FROM cat_albums WHERE id = ?').get(album.id);
  assert.deepEqual({ ...al }, { wd_links: 27, lb_users: 4321 }, 'rapproché malgré « (Deluxe Edition) »');
  assert.equal(db.prepare("SELECT source_id FROM external_ids WHERE entity_type = 'album' AND entity_id = ? AND source = 'wikidata'").get(album.id).source_id, 'Q10');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cat_albums WHERE prestige_at IS NULL').get().n, 0);
  // Tout est évalué : la collecte suivante ne demande rien.
  const before = queries.length;
  assert.equal((await prestige.collect()).changed, false);
  assert.equal(queries.length, before);
  // Un nouvel album d'un artiste déjà évalué : seule la requête de ses albums part (élément Wikidata déjà connu).
  db.prepare('UPDATE cat_albums SET prestige_at = NULL WHERE id = ?').run(album.id);
  await prestige.collect();
  assert.equal(queries.length, before + 1);
  assert.ok(queries.at(-1).includes('wd:Q1'));
  // PRESTIGE=off : aucune requête.
  assert.equal(await createPrestige(db, { settings: { ...settings, mode: 'off' }, fetchImpl }).collect(), null);
  db.close();
});
