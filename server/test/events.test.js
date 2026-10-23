// Événements (PLAN.md 6.9, 8.3 P2.3, chantier P2-B) : calendrier dans le code à l'heure de Paris (changements d'heure,
// chevauchements), aperçu hors production, quêtes d'événement (période e:<slug>, progression dans la fenêtre, votes de
// battles marqués de l'événement), réclamation et bonus (badge, cadre, booster thématique), catégorie du jour des
// battles, pages /api/events et /api/events/:slug, refus hors fenêtre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENTS, EVENT_QUEST_REWARD, eventBadgeKey, eventWindow, nextEventSlug, parseEventQuest, previewWindow, resolveCalendar, slugOfKey,
} from '../../shared/events.js';
import { parisMidnight } from '../../shared/periods.js';

// Aperçu : French Touch « en cours » (commencé il y a deux jours) ; à poser avant le démarrage de l'application.
process.env.EVENT_PREVIEW = 'french-touch';
const { startApp, signupVerified, api } = await import('./helpers.js');

const NOW = Date.now();
let catalogNo = 7000;
/** Albums synthétiques d'électro (années 2000), pour les duels et le coffret de l'événement. */
function addElectro(db, count) {
  db.prepare(`INSERT OR IGNORE INTO cat_artists (id, name, genre, fans, source, created_at) VALUES ('ev-artist', 'Artiste électro', 'electro', 0, 'test', ?)`).run(NOW);
  for (let i = 0; i < count; i++) {
    const id = `evel-${i}`;
    db.prepare(`INSERT INTO cat_albums (id, artist_id, title, year, genre, catalog, track_count, fans, source, created_at)
      VALUES (?, 'ev-artist', ?, ?, 'electro', ?, 2, ?, 'test', ?)`).run(id, `Électro ${i}`, 2000 + i, catalogNo++, 50_000 - i, NOW);
    for (let n = 1; n <= 2; n++) {
      db.prepare(`INSERT INTO cat_tracks (id, kind, album_id, artist_id, n, total, title, year, genre, pop, rarity, source, created_at)
        VALUES (?, 'album', ?, 'ev-artist', ?, 2, ?, ?, 'electro', 60, 'common', 'test', ?)`).run(`${id}:${n}`, id, n, `Électro ${i} · ${n}`, 2000 + i, NOW);
    }
  }
}

const app = await startApp({ catalog: async (db) => addElectro(db, 8) });
test.after(() => app.close());
const { db, deps, services } = app;

let n = 0;
const player = (name) => signupVerified(app, { username: name || `ev_${++n}` });
const call = (who, method, path, body) => api(app.base, who?.cookie || '', method, path, body);
const iso = (ms) => new Date(ms).toISOString();
const tracksOf = (albumId) => db.prepare('SELECT id FROM cat_tracks WHERE album_id = ? ORDER BY n').all(albumId).map((r) => r.id);
function addCards(who, trackIds) {
  const user = services.getUser(who.user.id);
  services.atomic(() => services.addCards(user, trackIds.map((trackId) => ({ trackId, variant: 'std' })), 'press'));
}

test('calendrier : fenêtres en jours civils de Paris, statuts, chevauchements, aperçu', () => {
  const ft = EVENTS.find((e) => e.slug === 'french-touch');
  // 16–29 novembre 2026, heure d'hiver (UTC+1) : du 15 à 23:00 UTC au 29 à 23:00 UTC.
  assert.deepEqual(eventWindow(ft), { start: Date.parse('2026-11-15T23:00:00Z'), end: Date.parse('2026-11-29T23:00:00Z') });
  // Légendes du rock, 15–28 mars 2027 : le passage à l'heure d'été (28 mars) raccourcit le dernier jour.
  const rock = eventWindow(EVENTS.find((e) => e.slug === 'rock-legends'));
  assert.equal(iso(rock.end), '2027-03-28T22:00:00.000Z');
  assert.equal(rock.end - rock.start, 14 * 86_400_000 - 3_600_000);
  const at = (s) => resolveCalendar({ now: Date.parse(s) });
  const status = (cal, slug) => cal.find((e) => e.slug === slug).status;
  assert.equal(status(at('2026-11-15T22:59:59Z'), 'french-touch'), 'upcoming');
  assert.equal(status(at('2026-11-15T23:00:00Z'), 'french-touch'), 'current');
  assert.equal(status(at('2026-11-29T22:59:59Z'), 'french-touch'), 'current');
  assert.equal(status(at('2026-11-29T23:00:00Z'), 'french-touch'), 'past');
  // Fin janvier 2027 : le Rétro et les Années 80 se chevauchent.
  const jan = at('2027-01-20T12:00:00Z');
  assert.deepEqual(jan.filter((e) => e.status === 'current').map((e) => e.slug), ['retro-2026', 'annees-80']);
  // Aperçu : l'événement choisi devient « en cours » (deux jours avant, douze après), les autres ne bougent pas.
  const anchor = Date.parse('2026-10-23T10:00:00Z');
  const prev = resolveCalendar({ now: anchor, preview: 'rock-legends', previewAnchor: anchor });
  const shown = prev.find((e) => e.slug === 'rock-legends');
  assert.equal(shown.status, 'current');
  assert.equal(shown.preview, true);
  assert.deepEqual({ start: shown.start, end: shown.end }, previewWindow(anchor));
  assert.equal(shown.start, parisMidnight(2026, 10, 21));
  assert.equal(prev.find((e) => e.slug === 'french-touch').status, 'upcoming');
  assert.equal(nextEventSlug(anchor), 'french-touch');
  // Clés de période et quêtes.
  assert.equal(slugOfKey('e:french-touch'), 'french-touch');
  assert.equal(slugOfKey('e:inconnu'), null);
  assert.equal(slugOfKey('d:2026-10-06'), null);
  const pq = parseEventQuest('french-touch', 'ft-cards');
  assert.equal(pq.def.scope, 'event');
  assert.deepEqual(pq.def.params, { genre: 'electro' });
  assert.equal(parseEventQuest('french-touch', 'd-open'), null);
  // Chaque événement : 3 quêtes, des slugs sans marque déposée, un badge.
  for (const ev of EVENTS) {
    assert.equal(ev.quests.length, 3, ev.slug);
    assert.ok(!/eurovision/i.test(JSON.stringify(ev)), ev.slug);
    assert.match(eventBadgeKey(ev.slug), /^badge:event:[a-z0-9-]+:gold$/);
  }
});

test('GET /api/events : en cours (aperçu), à venir, passés ; GET /api/events/:slug : quêtes, coffret, battles, récompenses', async () => {
  assert.equal((await call(null, 'GET', '/events')).status, 401);
  const p = await player();
  const r = await call(p, 'GET', '/events');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.current.map((e) => e.slug), ['french-touch']);
  const ft = r.body.current[0];
  assert.equal(ft.preview, true);
  assert.equal(ft.daysLeft, 13);
  assert.deepEqual(ft.quests, { claimed: 0, total: 3 });
  assert.equal(ft.battle, 'genre:electro');
  assert.ok(r.body.upcoming.length >= 5);
  assert.ok(r.body.upcoming.every((e) => e.startsIn >= 0));

  const v = await call(p, 'GET', '/events/french-touch');
  assert.equal(v.status, 200);
  assert.equal(v.body.event.slug, 'french-touch');
  assert.deepEqual(v.body.quests.slots.map((s) => [s.defId, s.target, s.progress, s.claimed]), [
    ['ft-cards', 10, 0, false], ['ft-set', 1, 0, false], ['ft-battles', 15, 0, false],
  ]);
  assert.deepEqual(v.body.quests.slots[0].reward, EVENT_QUEST_REWARD);
  assert.equal(v.body.quests.periodKey, 'e:french-touch');
  // Le coffret de l'événement existe (3 albums de la graine + remplissage électro).
  assert.equal(v.body.set?.id, 'ev-french-touch');
  assert.equal(v.body.set.albumCount, 8);
  assert.deepEqual(v.body.battle, { category: 'genre:electro', featured: true });
  assert.equal(v.body.rewards.badge, 'badge:event:french-touch:gold');
  assert.equal(v.body.rewards.frame, 'frame:french-touch');
  assert.equal(v.body.rewards.theme, 'event:french-touch');
  // À venir : les quêtes sans progression, verrouillées, rien d'écrit.
  const later = await call(p, 'GET', '/events/annees-80');
  assert.equal(later.body.event.status, 'upcoming');
  assert.ok(later.body.quests.slots.every((s) => s.locked && s.progress === 0));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user_quests WHERE user_id = ? AND period_key = 'e:annees-80'").get(p.user.id).n, 0);
  // Inconnu : 404.
  for (const bad of ['inconnu', 'FRENCH', 'french-touch-x', '..']) assert.equal((await call(p, 'GET', `/events/${bad}`)).status, 404, bad);
  // GET /api/quests montre l'événement en cours.
  const qs = await call(p, 'GET', '/quests');
  assert.equal(qs.body.event?.slug, 'french-touch');
  assert.equal(qs.body.events.length, 1);
});

test('quêtes d\'événement : progression dans la fenêtre, votes marqués, réclamation, bonus (badge, cadre, booster)', async () => {
  const p = await player();
  const call2 = (method, path, body) => call(p, method, path, body);
  // Trop tôt : rien à réclamer.
  let res = await call2('POST', '/events/french-touch/quests/0/claim');
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'quest_not_done');
  // 10 nouvelles cartes d'électro (5 albums × 2 morceaux).
  const electro = db.prepare("SELECT id FROM cat_albums WHERE id LIKE 'evel-%' ORDER BY id").all().map((r) => r.id);
  addCards(p, electro.slice(0, 5).flatMap(tracksOf));
  // Un album du coffret complété (2 morceaux).
  const setAlbum = db.prepare("SELECT album_id FROM set_albums WHERE set_id = 'ev-french-touch' AND album_id LIKE 'evel-%' LIMIT 1").get().album_id;
  addCards(p, tracksOf(setAlbum));
  // 15 votes de battles électro (catégorie de l'événement) : chaque vote est marqué french-touch.
  let votes = 0;
  for (let guard = 0; votes < 15 && guard < 30; guard++) {
    const next = await call2('GET', '/battles/next?category=genre:electro&n=5');
    assert.equal(next.status, 200, JSON.stringify(next.body));
    assert.equal(next.body.featured, 'genre:electro');
    for (const d of next.body.duels) {
      if (votes >= 15) break;
      const v = await call2('POST', '/battles/vote', { token: d.token, winner: 'a' });
      if (v.status === 200) votes += 1;
    }
  }
  assert.equal(votes, 15);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM battle_votes WHERE user_id = ? AND event_slug = 'french-touch'").get(p.user.id).n, 15);
  const view = await call2('GET', '/events/french-touch');
  assert.deepEqual(view.body.quests.slots.map((s) => s.done), [true, true, true]);
  // Bonus avant les trois réclamations : refusé.
  res = await call2('POST', '/events/french-touch/bonus');
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'bonus_locked');
  // Réclamations (page de l'événement, et la route des quêtes pour la troisième).
  const royalties = services.getUser(p.user.id).royalties;
  res = await call2('POST', '/events/french-touch/quests/0/claim');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.reward, EVENT_QUEST_REWARD);
  assert.ok(res.body.state?.partial);
  assert.equal((await call2('POST', '/events/french-touch/quests/0/claim')).body.error, 'already_claimed');
  assert.equal((await call2('POST', '/events/french-touch/quests/1/claim')).status, 200);
  assert.equal((await call2('POST', `/quests/${encodeURIComponent('e:french-touch')}/2/claim`)).status, 200);
  assert.equal(services.getUser(p.user.id).royalties, royalties + 3 * EVENT_QUEST_REWARD.royalties);
  // Pas de relance pour un événement.
  assert.equal((await call2('POST', `/quests/${encodeURIComponent('e:french-touch')}/0/reroll`)).body.error, 'no_reroll');
  // Bonus : badge or de l'événement, cadre, booster thématique, une seule fois.
  const bonusPacks = services.getUser(p.user.id).bonus_packs;
  res = await call2('POST', '/events/french-touch/bonus');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.reward.badge, 'badge:event:french-touch:gold');
  assert.ok(db.prepare('SELECT 1 FROM achievements WHERE user_id = ? AND key = ?').get(p.user.id, 'badge:event:french-touch:gold'));
  assert.equal(db.prepare('SELECT source FROM user_cosmetics WHERE user_id = ? AND cosmetic_id = ?').get(p.user.id, 'frame:french-touch')?.source, 'event:french-touch');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user_boosters WHERE user_id = ? AND theme = 'event:french-touch' AND opened_at IS NULL").get(p.user.id).n, 1);
  assert.equal(services.getUser(p.user.id).bonus_packs, bonusPacks + 1);
  assert.equal((await call2('POST', '/events/french-touch/bonus')).body.error, 'already_claimed');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'event_reward'").get(p.user.id).n, 1);
  // Résumé : 3/3, badge et cadre gagnés.
  const after = await call2('GET', '/events');
  const ft = after.body.current[0];
  assert.deepEqual(ft.quests, { claimed: 3, total: 3 });
  assert.ok(ft.earned.badgeAt && ft.earned.frameAt);
  const page = await call2('GET', '/events/french-touch');
  assert.equal(page.body.quests.bonus.claimed, true);
  // Le cadre se choisit dans le Studio.
  assert.equal((await call2('PUT', '/me/cosmetics', { frame: 'french-touch' })).status, 200);
});

test('hors fenêtre et entrées invalides : 410 avant et après, 400 / 404 pour un événement inconnu', async () => {
  const p = await player();
  assert.equal((await call(p, 'POST', '/events/annees-80/quests/0/claim')).status, 410);
  assert.equal((await call(p, 'POST', '/events/annees-80/bonus')).status, 410);
  assert.equal((await call(p, 'POST', '/events/inconnu/quests/0/claim')).status, 404);
  assert.equal((await call(p, 'POST', `/quests/${encodeURIComponent('e:inconnu')}/0/claim`)).status, 400);
  assert.equal((await call(p, 'POST', '/events/french-touch/quests/7/claim')).status, 404);
  assert.equal((await call(p, 'POST', '/events/french-touch/quests/x/claim')).status, 404);
  // Sans l'en-tête anti-CSRF : refusé.
  const res = await fetch(`${app.base}/api/events/french-touch/bonus`, { method: 'POST', headers: { Cookie: p.cookie } });
  assert.equal(res.status, 403);
});

test('votes hors catégorie ou hors événement : pas marqués ; catégorie du jour écrite à l\'avance pendant l\'événement', async () => {
  const p = await player();
  // Un vote dans une autre catégorie (rock) n'est pas marqué.
  const next = await call(p, 'GET', '/battles/next?category=global:album&n=5');
  assert.equal(next.status, 200);
  const duel = next.body.duels.find((d) => !(d.a.genre === 'electro' && d.b.genre === 'electro'));
  if (duel) {
    const v = await call(p, 'POST', '/battles/vote', { token: duel.token, winner: 'b' });
    assert.equal(v.status, 200);
    const row = db.prepare('SELECT event_slug, categories FROM battle_votes WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(p.user.id);
    assert.equal(row.event_slug, JSON.parse(row.categories).includes('genre:electro') ? 'french-touch' : null);
  }
  // Catégorie du jour : aujourd'hui et les deux jours suivants (dans la fenêtre de l'aperçu).
  const days = [0, 1, 2].map((i) => deps.periods.dayKey(deps.periods.dayStart(Date.now()) + i * 86_400_000 + 43_200_000).slice(2));
  for (const day of days) {
    assert.equal(db.prepare('SELECT value FROM kv WHERE key = ?').get(`battle:featured:${day}`)?.value, 'genre:electro', day);
  }
  assert.ok(app.jobs.names().includes('events-calendar'));
});
