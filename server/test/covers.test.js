import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { openDb } = await import('../db.js');
const { createCovers, normTitle, mapTracks } = await import('../covers.js');
const { coversMode } = await import('../config.js');
const { ALBUMS, ARTIST_BY_ID, TRACKS_BY_ALBUM, TRACK_BY_ID } = await import('../../shared/catalog.js');

const BASE = {
  covers: 'auto',
  coversMarket: 'FR',
  spotify: { clientId: 'id', clientSecret: 'secret' },
  spotifyApiUrl: 'https://spotify.test',
  spotifyAccountsUrl: 'https://accounts.spotify.test',
  deezerApiUrl: 'https://deezer.test',
};

const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const slug = (s) => normTitle(s).replace(/ /g, '-');
const albumByTitle = (title) => ALBUMS.find((a) => normTitle(a.title) === normTitle(title));

/** Fausse API Spotify : un leurre d'un autre artiste, une compilation, puis le bon album. */
function fakeSpotify({ calls, missing = new Set() }) {
  return async (url, init = {}) => {
    const u = new URL(url);
    calls.push(`${init.method || 'GET'} ${u.host}${u.pathname}`);
    if (u.host === 'accounts.spotify.test') {
      assert.equal(init.headers.Authorization, `Basic ${Buffer.from('id:secret').toString('base64')}`);
      return json({ access_token: 'tok', expires_in: 3600 });
    }
    assert.equal(init.headers?.Authorization, 'Bearer tok');
    if (u.pathname === '/v1/search') {
      const q = u.searchParams.get('q');
      const [, title, artist] = /^(?:album|track):(.*) artist:(.*)$/.exec(q);
      if (missing.has(title)) return json({ albums: { items: [] }, tracks: { items: [] } });
      const img = (id) => [64, 640, 300].map((w) => ({ url: `https://i.scdn.test/${id}-${w}`, width: w, height: w }));
      if (u.searchParams.get('type') === 'album') {
        const id = slug(title);
        return json({
          albums: {
            items: [
              { id: 'decoy', name: title, album_type: 'album', artists: [{ name: 'Someone Else' }], images: img('decoy'), external_urls: { spotify: 'https://open.spotify.test/album/decoy' } },
              { id: `${id}-best-of`, name: `${title} (Best Of)`, album_type: 'compilation', artists: [{ name: artist }], images: img(`${id}-best-of`), external_urls: { spotify: `https://open.spotify.test/album/${id}-best-of` } },
              { id, name: title, album_type: 'album', artists: [{ name: artist }], images: img(id), external_urls: { spotify: `https://open.spotify.test/album/${id}` } },
            ],
          },
        });
      }
      const id = slug(title);
      return json({
        tracks: {
          items: [
            { name: `${title} - Live`, artists: [{ name: 'Cover Band' }], album: { images: img('decoy') }, external_urls: { spotify: 'https://open.spotify.test/track/decoy' } },
            { name: title, artists: [{ name: artist }, { name: 'Guest' }], album: { images: img(`single-${id}`) }, external_urls: { spotify: `https://open.spotify.test/track/${id}` } },
          ],
        },
      });
    }
    const m = /^\/v1\/albums\/([^/]+)\/tracks$/.exec(u.pathname);
    if (m) {
      const album = ALBUMS.find((a) => slug(a.title) === m[1]);
      const items = TRACKS_BY_ALBUM[album.id].map((t, i) => ({
        // Titres façon plateforme : suffixe « - Remastered », mots censurés écrits en entier.
        name: i === 0 ? `${t.title} - Remastered 2011` : t.title.replace(/\*+/g, 'xxxx'),
        track_number: i + 1,
        disc_number: 1,
        external_urls: { spotify: `https://open.spotify.test/track/${t.id}` },
      }));
      return json({ items });
    }
    throw new Error(`URL inattendue ${url}`);
  };
}

function fakeDeezer({ calls, quotaAfter = Infinity }) {
  let n = 0;
  return async (url) => {
    const u = new URL(url);
    calls.push(`GET ${u.host}${u.pathname}`);
    if (++n > quotaAfter) return json({ error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 } });
    if (u.pathname === '/search/album' || u.pathname === '/search/track') {
      const q = u.searchParams.get('q');
      const strict = /^artist:"(.*)" (?:album|track):"(.*)"$/.exec(q);
      if (!strict) return json({ data: [] });
      const [, artist, title] = strict;
      const id = slug(title);
      const covers = { cover_big: `https://cdn.deezer.test/${id}/500.jpg`, cover_xl: `https://cdn.deezer.test/${id}/1000.jpg` };
      if (u.pathname === '/search/album') return json({ data: [{ id, title, link: `https://www.deezer.test/album/${id}`, record_type: 'album', artist: { name: artist }, ...covers }] });
      return json({ data: [{ id, title, link: `https://www.deezer.test/track/${id}`, artist: { name: artist }, album: covers }] });
    }
    const m = /^\/album\/([^/]+)\/tracks$/.exec(u.pathname);
    if (m) {
      const album = ALBUMS.find((a) => slug(a.title) === m[1]);
      return json({ data: TRACKS_BY_ALBUM[album.id].map((t, i) => ({ title: t.title, track_position: i + 1, disk_number: 1, link: `https://www.deezer.test/track/${t.id}` })) });
    }
    throw new Error(`URL inattendue ${url}`);
  };
}

test('titres normalisés : remasters, parenthèses, accents et censure', () => {
  assert.equal(normTitle('Come Together - Remastered 2009'), 'come together');
  assert.equal(normTitle('good kid, m.A.A.d city (Deluxe)'), 'good kid m a a d city');
  assert.equal(normTitle('Racine carrée'), 'racine carree');
  assert.equal(normTitle('B**** Please II'), 'b please ii');
  const ours = [{ id: 'a', title: 'One' }, { id: 'b', title: 'B**** Please' }];
  assert.deepEqual(mapTracks(ours, [{ title: 'One', url: 'https://x/1' }, { title: 'Bitch Please', url: 'https://x/2' }]), { a: 'https://x/1', b: 'https://x/2' });
  assert.deepEqual(mapTracks(ours, [{ title: 'One', url: 'javascript:alert(1)' }, { title: 'Two', disc: 1, position: 2, url: 'https://x/2' }, { title: 'Three', url: 'https://x/3' }]), {});
});

test('Spotify : bon album, liens directs des morceaux, singles, cache', async () => {
  const db = openDb(':memory:');
  const calls = [];
  const covers = createCovers(db, { cfg: BASE, fetchImpl: fakeSpotify({ calls }), pauseMs: 0 });
  assert.deepEqual(covers.order, ['spotify', 'deezer']);
  await covers.warm();
  const snap = covers.snapshot();
  assert.equal(Object.keys(snap.items).length, 34, JSON.stringify(covers.status().missing));

  const discovery = snap.items.discovery;
  assert.equal(discovery.provider, 'spotify');
  assert.equal(discovery.url, 'https://open.spotify.test/album/discovery');
  assert.equal(discovery.cover, 'https://i.scdn.test/discovery-640');
  assert.equal(discovery.thumb, 'https://i.scdn.test/discovery-300');
  assert.equal(discovery.coverW, 640);
  assert.equal(discovery.thumbW, 300);

  // Chaque morceau d'album pointe vers sa propre page, même avec « - Remastered » ou un titre censuré.
  for (const album of ALBUMS) {
    for (const t of TRACKS_BY_ALBUM[album.id]) assert.equal(snap.tracks[t.id]?.url, `https://open.spotify.test/track/${t.id}`, t.id);
  }
  const promo = snap.items['promo:hey-jude'];
  assert.equal(promo.cover, 'https://i.scdn.test/single-hey-jude-640');
  assert.equal(snap.tracks['promo:hey-jude'].url, 'https://open.spotify.test/track/hey-jude');
  // « We Are the World » est crédité à USA for Africa sur les plateformes.
  assert.ok(calls.some((c) => c.includes('/v1/search')));
  assert.ok(snap.items['promo:we-are-the-world']);

  const tokenCalls = calls.filter((c) => c.startsWith('POST accounts')).length;
  assert.equal(tokenCalls, 1, 'le jeton est réutilisé');
  const before = calls.length;
  await covers.warm();
  assert.equal(calls.length, before, 'rien n’est redemandé tant que le cache est frais');
  assert.equal(covers.status().found, 34);
  db.close();
});

test('Deezer en secours quand Spotify ne trouve pas, puis seul sans clés', async () => {
  const db = openDb(':memory:');
  const calls = [];
  const spotify = fakeSpotify({ calls, missing: new Set(['Thriller']) });
  const deezer = fakeDeezer({ calls });
  const fetchImpl = (url, init) => (url.includes('deezer.test') ? deezer(url, init) : spotify(url, init));
  const covers = createCovers(db, { cfg: BASE, fetchImpl, pauseMs: 0 });
  await covers.warm();
  const snap = covers.snapshot();
  assert.equal(snap.items.thriller.provider, 'deezer');
  assert.equal(snap.items.thriller.cover, 'https://cdn.deezer.test/thriller/1000.jpg');
  assert.equal(snap.items.thriller.thumb, 'https://cdn.deezer.test/thriller/500.jpg');
  assert.equal(snap.tracks[TRACKS_BY_ALBUM.thriller[0].id].provider, 'deezer');
  assert.equal(snap.items.discovery.provider, 'spotify');
  db.close();

  const db2 = openDb(':memory:');
  const calls2 = [];
  const onlyDeezer = createCovers(db2, { cfg: { ...BASE, spotify: null }, fetchImpl: fakeDeezer({ calls: calls2 }), pauseMs: 0 });
  assert.deepEqual(onlyDeezer.order, ['deezer']);
  await onlyDeezer.warm();
  assert.equal(onlyDeezer.status().found, 34);
  assert.ok(calls2.every((c) => c.includes('deezer.test')));
  db2.close();
});

test('quota dépassé : la tournée s’arrête sans rien effacer, les pochettes trouvées restent', async () => {
  const db = openDb(':memory:');
  const calls = [];
  const covers = createCovers(db, { cfg: { ...BASE, spotify: null }, fetchImpl: fakeDeezer({ calls, quotaAfter: 5 }), pauseMs: 0 });
  await covers.warm();
  const status = covers.status();
  assert.ok(status.found >= 1 && status.found < 34, `trouvées : ${status.found}`);
  assert.match(status.lastError, /quota/);
  // Les éléments non atteints n'ont pas été enregistrés comme introuvables : ils seront retentés.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM covers WHERE cover IS NULL').get().n, 0);
  db.close();
});

test('réponses refusées : adresse non https, artiste différent ; COVERS=off ne contacte personne', async () => {
  const db = openDb(':memory:');
  const evil = async (url) => {
    const u = new URL(url);
    if (u.pathname === '/search/album') {
      return json({ data: [{ id: 1, title: 'Discovery', link: 'javascript:alert(1)', record_type: 'album', artist: { name: 'Daft Punk' }, cover_xl: 'https://cdn.deezer.test/x.jpg' }] });
    }
    return json({ data: [{ id: 2, title: 'Hey Jude', link: 'https://www.deezer.test/track/2', artist: { name: 'Tribute Band' }, album: { cover_xl: 'https://cdn.deezer.test/y.jpg' } }] });
  };
  const covers = createCovers(db, { cfg: { ...BASE, spotify: null }, fetchImpl: evil, pauseMs: 0 });
  await covers.warm();
  assert.equal(covers.status().found, 0);
  // Introuvable : noté, puis retenté seulement le lendemain.
  assert.equal(covers.entry('discovery').cover, null);
  db.close();

  const db2 = openDb(':memory:');
  let called = false;
  const off = createCovers(db2, { cfg: { ...BASE, covers: 'off' }, fetchImpl: async () => { called = true; return json({}); }, pauseMs: 0 });
  await off.warm();
  assert.deepEqual(off.snapshot(), { providers: [], items: {}, tracks: {} });
  assert.equal(called, false);
  db2.close();
});

test('les pochettes ne couvrent que le catalogue actuel', () => {
  const db = openDb(':memory:');
  db.prepare('INSERT INTO covers (item_key, provider, cover, url, tracks, fetched_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('album-retire', 'deezer', 'https://cdn.deezer.test/old.jpg', 'https://www.deezer.test/album/old', '{}', Date.now());
  const covers = createCovers(db, { cfg: { ...BASE, spotify: null }, fetchImpl: async () => json({ data: [] }), pauseMs: 0 });
  assert.equal(covers.snapshot().items['album-retire'], undefined);
  assert.ok(TRACK_BY_ID['discovery:01'] && ARTIST_BY_ID['daft-punk']);
  assert.ok(albumByTitle('Discovery'));
  db.close();
});

test('crédits des plateformes : U.S.A. for Africa, duo Mark Ronson, état « introuvable » ou « en attente »', async () => {
  const db = openDb(':memory:');
  const deezer = async (url) => {
    const u = new URL(url);
    const q = u.searchParams.get('q') || '';
    if (u.pathname === '/search/track' && q.includes('We Are the World')) {
      return json({ data: [{ id: 1, title: 'We Are The World', link: 'https://www.deezer.test/track/1', artist: { name: 'U.S.A. for Africa' }, album: { cover_xl: 'https://cdn.deezer.test/usa.jpg', cover_big: 'https://cdn.deezer.test/usa-500.jpg' } }] });
    }
    if (u.pathname === '/search/track' && q.includes('Valerie')) {
      assert.match(q, /artist:"Mark Ronson"/);
      return json({ data: [
        { id: 2, title: "Valerie ('68 Version)", link: 'https://www.deezer.test/track/2', artist: { name: 'Amy Winehouse' }, album: { cover_xl: 'https://cdn.deezer.test/lioness.jpg' } },
        { id: 3, title: 'Valerie (feat. Amy Winehouse) (Version Revisited)', link: 'https://www.deezer.test/track/3', artist: { name: 'Mark Ronson' }, album: { cover_xl: 'https://cdn.deezer.test/version.jpg' } },
      ] });
    }
    if (u.pathname === '/search/album' && q.includes('Thriller')) throw new Error('réseau coupé');
    return json({ data: [] });
  };
  const covers = createCovers(db, { cfg: { ...BASE, spotify: null }, fetchImpl: deezer, pauseMs: 0 });
  await covers.warm();
  const snap = covers.snapshot();
  assert.equal(snap.items['promo:we-are-the-world'].cover, 'https://cdn.deezer.test/usa.jpg');
  assert.equal(snap.tracks['promo:valerie'].url, 'https://www.deezer.test/track/3');
  const status = covers.status();
  assert.deepEqual(status.served, { deezer: 2 });
  // Thriller : Deezer injoignable, donc « en attente » et non « introuvable ».
  assert.ok(!status.missing.some((m) => m.key === 'thriller'));
  assert.equal(status.pending, 1);
  assert.equal(status.missing.length, 34 - 2 - 1);
  assert.match(status.lastError, /^deezer: réseau coupé$/);
  db.close();
});

test('interrupteur COVERS : toutes les façons de dire « off » coupent', () => {
  for (const v of ['off', 'OFF', ' Off ', 'false', '0', 'no', 'none', 'disable', 'désactivé', 'of', 'n’importe quoi']) assert.equal(coversMode(v), 'off', v);
  assert.equal(coversMode(undefined), 'auto');
  assert.equal(coversMode(''), 'auto');
  assert.equal(coversMode(' AUTO '), 'auto');
  assert.equal(coversMode('Spotify'), 'spotify');
});

test('Spotify 403 reste visible même si Deezer échoue ; un fournisseur abandonné ne laisse pas de faux « en attente »', async () => {
  const db = openDb(':memory:');
  const fetchImpl = async (url) => {
    if (url.includes('accounts.spotify.test')) return json({ access_token: 'tok', expires_in: 3600 });
    if (url.includes('spotify.test')) return json({ error: { status: 403 } }, 403);
    throw new Error('fetch failed');
  };
  const covers = createCovers(db, { cfg: BASE, fetchImpl, pauseMs: 0 });
  await covers.warm();
  const status = covers.status();
  assert.equal(status.spotifyPremium, true);
  assert.equal(status.lastError, 'spotify: HTTP 403 · deezer: fetch failed');
  assert.equal(status.found, 0);

  // Des pochettes Spotify déjà en base, puis plus de clés : Deezer répond sans résultat.
  const at = Date.now();
  for (const item of ['discovery', 'thriller']) {
    db.prepare('INSERT INTO covers (item_key, provider, cover, url, tracks, fetched_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(item, 'spotify', `https://i.scdn.test/${item}`, `https://open.spotify.test/album/${item}`, '{}', at);
  }
  const deezerOnly = createCovers(db, { cfg: { ...BASE, spotify: null }, fetchImpl: async () => json({ data: [] }), pauseMs: 0 });
  await deezerOnly.warm();
  const after = deezerOnly.status();
  assert.equal(after.found, 0);
  assert.equal(after.pending, 0, 'tout a été cherché');
  assert.equal(after.missing.length, 34);
  db.close();
});

test('indication Premium conservée si une autre erreur Spotify suit le 403', async () => {
  const db = openDb(':memory:');
  let n = 0;
  const fetchImpl = async (url) => {
    if (url.includes('accounts.spotify.test')) return json({ access_token: 'tok', expires_in: 3600 });
    if (url.includes('spotify.test')) return (++n < 30 ? json({}, 403) : json({}, 503));
    return json({ data: [] });
  };
  const covers = createCovers(db, { cfg: BASE, fetchImpl, pauseMs: 0 });
  await covers.warm();
  const status = covers.status();
  assert.equal(status.spotifyPremium, true);
  assert.match(status.lastError, /^spotify: HTTP 503/);
  assert.equal(status.modeInvalid, null);
  db.close();
});
