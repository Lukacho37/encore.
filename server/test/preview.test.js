import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { openDb } = await import('../db.js');
const { init } = await import('../tracks.js');

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

test('extrait de 30 s : demandé à Deezer à chaque appel, jamais stocké ; 404 pour la graine, 502 si Deezer ne répond pas', async () => {
  const db = openDb(':memory:');
  db.prepare(`INSERT INTO cat_artists (id, name, source, created_at) VALUES ('dzA1', 'Artiste', 'deezer', 0)`).run();
  db.prepare(`INSERT INTO cat_tracks (id, kind, artist_id, n, total, title, source, deezer_id, created_at, rarity, pop)
    VALUES ('dz1:01', 'album', 'dzA1', 1, 1, 'Titre', 'deezer', '3135556', 0, 'common', 1)`).run();
  const t = init({ db, catalog: {}, services: {}, validate: {}, HttpError, lru: () => ({ wrap: (k, f) => f(), delete() {} }) });
  const calls = [];
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      calls.push(url);
      return { ok: true, json: async () => ({ preview: 'https://cdnt-preview.dzcdn.net/x.mp3', link: 'https://www.deezer.com/track/3135556' }) };
    };
    assert.deepEqual(await t.preview('dz1:01'), { url: 'https://cdnt-preview.dzcdn.net/x.mp3', link: 'https://www.deezer.com/track/3135556' });
    await t.preview('dz1:01');
    assert.equal(calls.length, 2);
    assert.match(calls[0], /\/track\/3135556$/);
    await assert.rejects(t.preview('discovery:01'), (e) => e.status === 404);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ error: { code: 800 } }) });
    await assert.rejects(t.preview('dz1:01'), (e) => e.status === 404);
    globalThis.fetch = async () => { throw new Error('réseau'); };
    await assert.rejects(t.preview('dz1:01'), (e) => e.status === 502);
  } finally {
    globalThis.fetch = real;
  }
  db.close();
});
